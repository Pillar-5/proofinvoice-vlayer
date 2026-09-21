/**
 * LIVE END-TO-END INTEGRATION TEST.
 *
 * email fixture → vlayer proof (real prover) → on-chain verifier → registry
 *
 * This test is excluded from the normal `npm test` suite because it requires
 * the full vlayer environment:
 *
 *   1. the vlayer local devnet running (call_server on :3000 and vdns_server
 *      on :3002), or a hosted prover plus VLAYER_API_TOKEN;
 *   2. deployed contracts (Prover, Verifier, Registry) on the settlement chain;
 *   3. PROOFINVOICE_MODE=live with VLAYER_URL, VERIFIER_ADDRESS,
 *      REGISTRY_ADDRESS and a funded PRIVATE_KEY.
 *
 * Run with: npm run test:integration
 *
 * The test SKIPS (it does not fake) when any prerequisite is missing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "..", "fixtures", "invoice-sample.eml");

const env = process.env;
const prerequisites =
  (env.PROOFINVOICE_MODE ?? "").toLowerCase() === "live" &&
  !!env.VLAYER_URL &&
  !!env.VERIFIER_ADDRESS &&
  !!env.REGISTRY_ADDRESS &&
  !!env.PRIVATE_KEY;

describe.skipIf(!prerequisites)("live vlayer Email Proof end-to-end", () => {
  it("proves the fixture email and registers the claim on-chain", { timeout: 300_000 }, async () => {
    const mimeEmail = readFileSync(fixturePath, "utf8");

    const proveRes = await fetch(`${apiBase()}/api/proof`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mimeEmail, proverAddress: env.PROVER_ADDRESS }),
    });
    expect(proveRes.status).toBe(202);
    const { sessionId } = (await proveRes.json()) as { sessionId: number };

    // Poll until proving completes (real zk proving takes tens of seconds).
    let session: { state: string; proof?: unknown; error?: string } = { state: "proving" };
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const res = await fetch(`${apiBase()}/api/proof/${sessionId}`);
      session = (await res.json()) as typeof session;
      if (session.state === "proved" || session.state === "failed") break;
    }
    expect(session.state).toBe("proved");
    expect(session.error).toBeUndefined();

    const verifyRes = await fetch(`${apiBase()}/api/verify/${sessionId}`, { method: "POST" });
    expect(verifyRes.status).toBe(202);

    let settled: { state: string; settlement?: { txHash: string; claimHash: string }; error?: string } = {
      state: "settling",
    };
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(`${apiBase()}/api/proof/${sessionId}`);
      settled = (await res.json()) as typeof settled;
      if (settled.state === "settled" || settled.state === "failed") break;
    }
    expect(settled.state).toBe("settled");
    expect(settled.settlement?.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    // The registry must now report the claim as verified.
    const { createPublicClient, http } = await import("viem");
    const { invoiceRegistryAbi } = await import("../src/vlayer/abi.js");
    const { createChain, resolveChainName } = await import("../src/vlayer/chains.js");
    const publicClient = createPublicClient({
      chain: createChain(resolveChainName(env.CHAIN_NAME ?? "anvil")),
      transport: http(env.JSON_RPC_URL),
    });
    const verified = await publicClient.readContract({
      address: env.REGISTRY_ADDRESS as `0x${string}`,
      abi: invoiceRegistryAbi,
      functionName: "isClaimVerified",
      args: [settled.settlement?.claimHash as `0x${string}`],
    });
    expect(verified).toBe(true);
  });
});

function apiBase(): string {
  return `http://127.0.0.1:${env.PORT ?? "3000"}`;
}
