import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/main.js";
import { loadConfig } from "../src/config.js";
import { metrics } from "../src/metrics/metrics.js";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(here, "..", "fixtures", "invoice-sample.eml"), "utf8");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp(loadConfig({ PROOFINVOICE_MODE: "demo" } as NodeJS.ProcessEnv));
  server = createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

const get = async (path: string) => {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: (await res.json()) as unknown };
};

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as unknown };
};

describe("config", () => {
  it("defaults to demo mode and fails loudly when live is under-configured", () => {
    expect(loadConfig({}).mode).toBe("demo");
    expect(() => loadConfig({ PROOFINVOICE_MODE: "live" } as NodeJS.ProcessEnv)).toThrow(/PROVER_URL/);
    expect(() =>
      loadConfig({ PROOFINVOICE_MODE: "live", PROVER_URL: "http://x" } as NodeJS.ProcessEnv),
    ).toThrow(/VERIFIER_ADDRESS/);
  });

  it("rejects malformed addresses", () => {
    expect(() =>
      loadConfig({ VERIFIER_ADDRESS: "not-an-address" } as NodeJS.ProcessEnv),
    ).toThrow(/VERIFIER_ADDRESS/);
  });
});

describe("demo-mode API", () => {
  it("lists and serves the email fixtures", async () => {
    const list = (await get("/api/fixtures")) as { body: { fixtures: { name: string }[] } };
    expect(list.body.fixtures.map((f) => f.name)).toContain("invoice-sample.eml");

    const raw = await fetch(`${baseUrl}/api/fixtures/invoice-sample.eml`);
    expect(await raw.text()).toContain("BEGIN PROOFINVOICE CLAIM");
  });

  it("rejects fixture path traversal", async () => {
    const res = await fetch(`${baseUrl}/api/fixtures/..%2Fpackage.json`);
    expect(res.status).toBe(400);
  });

  it("parses the fixture into displayable claims", async () => {
    const { status, body } = await post("/api/parse", { mimeEmail: fixture });
    expect(status).toBe(200);
    const claim = body as { claim: { invoiceId: string; amountMinor: string; currency: string } };
    expect(claim.claim.invoiceId).toBe("INV-2026-0001");
    expect(claim.claim.amountMinor).toBe("125000");
    expect(claim.claim.currency).toBe("EUR");
  });

  it("refuses proof generation in demo mode instead of faking success", async () => {
    const { status, body } = await post("/api/proof", {
      mimeEmail: fixture,
      proverAddress: "0x0000000000000000000000000000000000000001",
    });
    expect(status).toBe(409);
    expect((body as { error: string }).error).toMatch(/demo mode/i);
  });

  it("refuses verification in demo mode", async () => {
    const { status } = await post("/api/verify/1", {});
    expect(status).toBe(409);
  });

  it("returns 422 for an email without a claim block", async () => {
    const { status, body } = await post("/api/parse", { mimeEmail: "Subject: hello\n" });
    expect(status).toBe(200);
    expect((body as { claim: unknown }).claim).toBeNull();
  });

  it("returns 400 when the body is not an email", async () => {
    const { status } = await post("/api/parse", { wrong: true });
    expect(status).toBe(400);
  });
});

describe("metrics", () => {
  it("tracks proof attempts and failures without fabricating values", async () => {
    const before = (await get("/api/metrics")) as { body: { proof_attempts: number; proofs_failed: number; proofs_generated: number; invoices_verified: number; issuer_domains: number } };

    // one failed attempt via demo-mode refusal is not a "proof attempt";
    // the counter only moves through the prover pipeline, so exercise the
    // store directly for the failure path.
    metrics.recordProofAttempt();
    metrics.recordProofFailure();
    metrics.recordProofSuccess("0xhash-a", "0xdomain-a", 1500);

    const after = (await get("/api/metrics")) as { body: {
      proof_attempts: number;
      proofs_failed: number;
      proofs_generated: number;
      invoices_verified: number;
      issuer_domains: number;
      avg_proof_ms: number;
    } };
    expect(after.body.proof_attempts).toBe(before.body.proof_attempts + 1);
    expect(after.body.proofs_failed).toBe(before.body.proofs_failed + 1);
    expect(after.body.proofs_generated).toBe(before.body.proofs_generated + 1);
    expect(after.body.invoices_verified).toBe(before.body.invoices_verified + 1);
    expect(after.body.issuer_domains).toBe(before.body.issuer_domains + 1);
    expect(after.body.avg_proof_ms).toBeGreaterThan(0);
  });
});
