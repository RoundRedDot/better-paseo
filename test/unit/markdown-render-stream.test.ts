/**
 * The Markdown streaming guarantees at render level (plan §3.1, S7 §5 P5):
 * every assistant reply and thought of the stream fixtures is fed to a real
 * `MarkdownView` delta by delta, over the host-element react-native stand-in,
 * with the perf probes on. A block that finished never renders again
 * (`md.finalRerender`), and no block changes kind while it streams
 * (format flips). Both are counted by the same probes the replay reports.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput,
    ScrollView: rn.ScrollView,
    Modal: rn.View,
    copyText: () => Promise.resolve(true),
    useToast: () => ({ show() {}, error() {}, success() {} }),
    useRevealedText: (text: string) => text,
  };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => ({}),
  useSettings: () => ({ data: undefined, status: "loading" }),
}));

await import("./helpers/quiet-renderer");
const TestRenderer = (await import("react-test-renderer")).default;
const { act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { enablePerf, perfSnapshot, resetPerf, disablePerf } = await import("../../client/debug/perf");
const { fixtureNames, streamTexts } = await import("./helpers/stream-texts");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = buildThemeTokens({
  surface0: "#ffffff",
  surface1: "#f6f6f7",
  surface2: "#ececee",
  border: "#e2e2e6",
  foreground: "#1b1b1f",
  foregroundMuted: "#6b6b75",
  accent: "#3b6fe0",
  accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b",
  statusWarning: "#a36a00",
  statusDanger: "#d23c3c",
});

describe("MarkdownView while a reply streams", () => {
  for (const variant of ["document", "compact"] as const) {
    it(`${variant}: finished blocks never re-render and no block flips`, () => {
      enablePerf();
      resetPerf();
      let replies = 0;
      for (const fixture of fixtureNames()) {
        for (const item of streamTexts(fixture)) {
          if (item.text.trim() === "") continue;
          replies += 1;
          const probeId = `${fixture}:${item.index}`;
          const view = (text: string, streaming: boolean) =>
            React.createElement(MarkdownView, { text, tokens, variant, streaming, probeId, compact: true });
          let renderer: ReturnType<typeof TestRenderer.create> | undefined;
          let text = "";
          for (const delta of item.deltas) {
            text += delta;
            act(() => {
              if (renderer) renderer.update(view(text, true));
              else renderer = TestRenderer.create(view(text, true));
            });
          }
          act(() => renderer!.update(view(item.text, false)));
          act(() => renderer!.unmount());
        }
      }
      const snapshot = perfSnapshot();
      disablePerf();
      expect(replies).toBeGreaterThan(5);
      // The probes ran: every streamed state rendered at least its tail.
      expect(snapshot.counters["md.blockRender"] ?? 0).toBeGreaterThan(replies);
      expect(snapshot.counters["md.finalRerender"] ?? 0).toBe(0);
      expect(snapshot.markdown.formatFlips).toBe(0);
    }, 120_000);
  }
});
