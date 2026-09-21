import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig } from "../config.js";
import { metrics } from "../metrics/metrics.js";
import { parseInvoiceEmail, previewHashes, type ParsedEmail, type InvoiceClaimPreview } from "../email/claims.js";
import { generateEmailProof, type EmailProofResult, type VlayerConfig } from "../vlayer/client.js";
import { settleProofOnChain, type ChainConfig, type SettlementResult } from "../vlayer/settle.js";
import { createChain, resolveChainName } from "../vlayer/chains.js";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Minimal express server exposing the ProofInvoice flow as JSON endpoints.
 * The static frontend (frontend/) is served for interactive demos; every
 * endpoint is also callable directly, which is what the integration test does.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const fixturesDir = join(repoRoot, "fixtures");

export interface ProofSession {
  id: number;
  parsed: ParsedEmail;
  claim: InvoiceClaimPreview;
  startedAt: number;
  state: "proving" | "proved" | "settling" | "settled" | "failed";
  proof?: EmailProofResult;
  settlement?: SettlementResult;
  error?: string;
}

export function createApp(config: AppConfig): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const sessions = new Map<number, ProofSession>();
  let nextSessionId = 1;

  const requireLive = (): void => {
    if (config.mode !== "live") {
      throw Object.assign(
        new Error(
          "Server is in demo mode (PROOFINVOICE_MODE=demo): real proof generation and on-chain settlement are disabled. " +
            "Set PROOFINVOICE_MODE=live with VLAYER_URL and deployed contract addresses to enable them.",
        ),
        { status: 409 },
      );
    }
  };

  app.get("/api/fixtures", (_req: Request, res: Response) => {
    if (!existsSync(fixturesDir)) {
      res.json({ fixtures: [] });
      return;
    }
    const fixtures = readdirSync(fixturesDir)
      .filter((f) => f.endsWith(".eml"))
      .map((f) => ({ name: f }));
    res.json({ fixtures });
  });

  app.get("/api/fixtures/:name", (req: Request, res: Response) => {
    const name = req.params.name as string;
    if (!/^[A-Za-z0-9._-]+\.eml$/.test(name)) {
      res.status(400).json({ error: "invalid fixture name" });
      return;
    }
    const path = join(fixturesDir, name);
    if (!existsSync(path)) {
      res.status(404).json({ error: `fixture ${name} not found` });
      return;
    }
    res.type("message/rfc822").send(readFileSync(path, "utf8"));
  });

  app.post("/api/parse", (req: Request, res: Response) => {
    const mime = typeof req.body?.mimeEmail === "string" ? req.body.mimeEmail : null;
    if (!mime) {
      res.status(400).json({ error: "body must be { mimeEmail: string } with the raw .eml source" });
      return;
    }
    const parsed = parseInvoiceEmail(mime);
    res.json({
      claim: parsed.claim
        ? {
            ...parsed.claim,
            amountMinor: parsed.claim.amountMinor.toString(),
            dueDateDays: parsed.claim.dueDateDays.toString(),
            ...previewHashes(parsed.claim),
          }
        : null,
      diagnostics: parsed.diagnostics,
      headerBlock: parsed.headerBlock,
    });
  });

  // --- proof + settle (real vlayer flow; disabled in demo mode) ------------

  app.post("/api/proof", (req: Request, res: Response, next: NextFunction) => {
    try {
      requireLive();
    } catch (err) {
      next(err);
      return;
    }

    const mime = typeof req.body?.mimeEmail === "string" ? req.body.mimeEmail : null;
    const proverAddress = req.body?.proverAddress as `0x${string}` | undefined;
    if (!mime || !proverAddress) {
      res.status(400).json({ error: "body must be { mimeEmail: string, proverAddress: address }" });
      return;
    }

    const parsed = parseInvoiceEmail(mime);
    if (!parsed.claim) {
      res.status(422).json({ error: "email has no extractable invoice claim", diagnostics: parsed.diagnostics });
      return;
    }

    const session: ProofSession = {
      id: nextSessionId++,
      parsed,
      claim: parsed.claim,
      startedAt: Date.now(),
      state: "proving",
    };
    sessions.set(session.id, session);
    metrics.recordProofAttempt();

    const vlayerConfig: VlayerConfig = {
      proverUrl: config.vlayer.url,
      dnsResolverUrl: config.vlayer.dnsResolverUrl,
      token: config.vlayer.token,
      chainId: config.vlayer.chainId,
    };

    // Kick off proving; the client polls GET /api/proof/:id for the outcome.
    generateEmailProof(vlayerConfig, { mimeEmail: mime, proverAddress })
      .then((proof) => {
        session.proof = proof;
        session.state = "proved";
        const hashes = previewHashes(session.claim);
        metrics.recordProofSuccess(hashes.invoiceIdHash, hashes.issuerDomainHash, Date.now() - session.startedAt);
      })
      .catch((err: unknown) => {
        session.state = "failed";
        session.error = err instanceof Error ? err.message : String(err);
        metrics.recordProofFailure();
      });

    res.status(202).json({ sessionId: session.id, state: session.state });
  });

  app.get("/api/proof/:id", (req: Request, res: Response) => {
    const session = sessions.get(Number(req.params.id));
    if (!session) {
      res.status(404).json({ error: "unknown session" });
      return;
    }
    res.json({
      sessionId: session.id,
      state: session.state,
      error: session.error ?? null,
      proof: session.proof
        ? {
            seal: session.proof.proof.seal,
            callGuestId: session.proof.proof.callGuestId,
            callAssumptions: session.proof.proof.callAssumptions,
            invoiceIdHash: session.proof.invoiceIdHash,
            issuerDomainHash: session.proof.issuerDomainHash,
            amountMinor: session.proof.amountMinor.toString(),
            currency: session.proof.currency,
            dueDateDays: session.proof.dueDateDays.toString(),
          }
        : null,
    });
  });

  app.post("/api/verify/:id", (req: Request, res: Response, next: NextFunction) => {
    try {
      requireLive();
      const session = sessions.get(Number(req.params.id));
      if (!session) {
        res.status(404).json({ error: "unknown session" });
        return;
      }
      if (session.state !== "proved" || !session.proof) {
        res.status(409).json({ error: `cannot settle a session in state '${session.state}'` });
        return;
      }
      if (!config.chain.verifierAddress || !config.chain.registryAddress || !config.wallet.privateKey) {
        res.status(409).json({ error: "chain settlement is not configured (see .env.example)" });
        return;
      }

      session.state = "settling";
      const chainConfig: ChainConfig = {
        viemChain: createChain(resolveChainName(process.env.CHAIN_NAME ?? "anvil")),
        rpcUrl: config.chain.rpcUrl,
        verifierAddress: config.chain.verifierAddress,
        registryAddress: config.chain.registryAddress,
        account: privateKeyToAccount(config.wallet.privateKey),
      };

      // Only the claim + proof go on-chain; the MIME source never leaves this
      // process (settleProofOnChain does not accept it as an input).
      settleProofOnChain(chainConfig, session.proof, session.claim)
        .then((settlement) => {
          session.settlement = settlement;
          session.state = "settled";
          metrics.recordOnchainVerification();
        })
        .catch((err: unknown) => {
          session.state = "failed";
          session.error = err instanceof Error ? err.message : String(err);
        });

      res.status(202).json({ sessionId: session.id, state: session.state });
    } catch (err) {
      next(err);
    }
  });

  // --- metrics --------------------------------------------------------------

  app.get("/api/metrics", (_req: Request, res: Response) => {
    res.json(metrics.snapshot());
  });

  // --- static frontend ------------------------------------------------------

  app.use(express.static(join(repoRoot, "frontend")));

  // --- error handling -------------------------------------------------------

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number })?.status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  });

  return app;
}

export function main(): void {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    process.stdout.write(
      `ProofInvoice listening on :${config.port} (mode=${config.mode}, prover=${config.vlayer.url || "not configured"})\n`,
    );
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
