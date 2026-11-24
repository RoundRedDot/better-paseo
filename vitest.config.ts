import { configDefaults, defineConfig } from "vitest/config";

/**
 * Character-by-character sweeps of every stream fixture through the Markdown
 * splitter and lexer. They take minutes, so `npm test` leaves them out; run
 * them with `npm test markdown` after changing Markdown rendering. CI runs both.
 */
export const markdownSweeps = [
  "test/unit/markdown-blocks-exhaustive.test.ts",
  "test/unit/markdown-streaming-height-exhaustive.test.ts",
];

export const unitTestOptions = {
  environment: "node",
  // Several render tests reset the module registry and import the client
  // graph again (`tool-callouts`, `live-renderers`) for every case. That
  // costs about a second on an idle machine, but on a shared one at load
  // 250 a single case took up to 23 s, and the 5 s default timed them out.
  // A timed-out case keeps running and breaks the next one in its file, so
  // the failures spread. 30 s still reports a test that hangs.
  testTimeout: 30_000,
  hookTimeout: 30_000,
  setupFiles: ["test/unit/helpers/forget-carried.ts"],
};

export default defineConfig({
  test: {
    ...unitTestOptions,
    include: ["test/unit/**/*.test.ts", "test/unit/**/*.test.tsx"],
    exclude: [...configDefaults.exclude, ...markdownSweeps],
  },
});
