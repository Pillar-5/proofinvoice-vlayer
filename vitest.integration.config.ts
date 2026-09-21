import { defineConfig } from "vitest/config";

/**
 * Integration test configuration: real vlayer Email Proof end-to-end.
 *
 * These tests hit the network and the vlayer prover, so they are deliberately
 * kept out of the default `npm test` run. They require the environment
 * documented in `.env.example` and `tests/integration/live-proof.test.ts`;
 * when prerequisites are absent the suite skips rather than faking a proof.
 *
 * Run with: npm run test:integration
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // Real zk proving plus on-chain settlement takes minutes, not seconds.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // Never run these in parallel: each one spends real proving time and
    // consumes a claim that must not be double-registered.
    fileParallelism: false,
  },
});
