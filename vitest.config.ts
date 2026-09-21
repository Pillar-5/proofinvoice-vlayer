import { configDefaults, defineConfig } from "vitest/config";

/**
 * Default (unit) test configuration.
 *
 * The integration suite lives under `tests/integration/` and is excluded here
 * rather than on the command line: a CLI `--exclude "tests/integration/**"`
 * argument is not portable (npm runs scripts through cmd.exe on Windows, which
 * does not strip single quotes, so the glob reaches vitest verbatim and is
 * treated as a positional filter instead of an exclusion).
 *
 * Run the integration suite explicitly with:
 *   npm run test:integration
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/tests/integration/**"],
    environment: "node",
    testTimeout: 30_000,
  },
});
