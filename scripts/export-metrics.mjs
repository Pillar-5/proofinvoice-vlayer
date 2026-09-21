#!/usr/bin/env node
/**
 * Exports the application-generated KPI counters as JSON.
 *
 * Reads the live metrics endpoint when the server is running, otherwise falls
 * back to zeros (metrics are in-memory and reset on restart). Values are never
 * fabricated: they reflect only what actually happened in this process.
 *
 * Usage: node scripts/export-metrics.mjs [--out metrics.json]
 */
import { writeFileSync } from "node:fs";

const port = process.env.PORT ?? "3000";
const url = `http://127.0.0.1:${port}/api/metrics`;

const fallback = {
  proof_attempts: 0,
  proofs_generated: 0,
  proofs_failed: 0,
  onchain_verifications: 0,
  invoices_verified: 0,
  issuer_domains: 0,
  avg_proof_ms: null,
};

try {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const metrics = await res.json();
  const outArg = process.argv.indexOf("--out");
  if (outArg !== -1 && process.argv[outArg + 1]) {
    writeFileSync(process.argv[outArg + 1], JSON.stringify(metrics, null, 2) + "\n");
    process.stdout.write(`metrics written to ${process.argv[outArg + 1]}\n`);
  } else {
    process.stdout.write(JSON.stringify(metrics, null, 2) + "\n");
  }
} catch (error) {
  process.stdout.write(
    `server not reachable at ${url} (${error instanceof Error ? error.message : error}); ` +
      `reporting zero counters — metrics are in-memory and reset on restart\n`,
  );
  process.stdout.write(JSON.stringify(fallback, null, 2) + "\n");
  process.exitCode = 0;
}
