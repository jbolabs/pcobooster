import { defineConfig } from "vitest/config";

/**
 * Run every test in UTC, the zone Cloudflare Workers and CI use, whatever the developer's
 * machine zone is. Set before any test worker starts so the workers inherit it; code that
 * formats in the host zone instead of the org zone then fails the same way everywhere.
 */
process.env.TZ = "UTC";

const rootDir = import.meta.dirname;

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/server/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "apps/marketing/src/**/*.test.ts",
      "apps/mobile/src/**/*.test.ts",
      "lint/**/*.test.ts",
      "scripts/**/*.test.ts",
      "stacks/**/*.test.ts",
    ],
    // Turborepo runs packages in parallel. Bound each package's workers so auth and workerd
    // fixtures keep CPU time while other suites start, without serializing the package gate.
    maxWorkers: 4,
    environment: "node",
    globals: true,
    clearMocks: true,
  },
  resolve: {
    alias: [
      {
        find: "cloudflare:workers",
        replacement: `${rootDir}/scripts/testing/cloudflare-workers.ts`,
      },
      {
        find: "@",
        replacement: `${rootDir}/apps/web/src`,
      },
    ],
  },
});
