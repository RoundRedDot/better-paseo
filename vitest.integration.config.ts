import { defineConfig } from "vitest/config";

// Integration tests run against private Paseo daemons (`test/integration/README.md`),
// so they stay out of `npm test` and CI, which have no Paseo installed.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    setupFiles: ["test/unit/helpers/forget-carried.ts"],
  },
});
