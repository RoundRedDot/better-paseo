import { defineConfig } from "vitest/config";
import { markdownSweeps, unitTestOptions } from "./vitest.config";

/** `npm test markdown`: only the exhaustive Markdown sweeps. */
export default defineConfig({
  test: {
    ...unitTestOptions,
    include: markdownSweeps,
  },
});
