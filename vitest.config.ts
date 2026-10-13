import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
    // Several render tests reset the module registry and import the client
    // graph again (`tool-callouts`, `live-renderers`) for every case. That
    // costs about a second on an idle machine, but on a shared one at load
    // 250 a single case took up to 23 s, and the 5 s default timed them out.
    // A timed-out case keeps running and breaks the next one in its file, so
    // the failures spread. 30 s still reports a test that hangs.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
