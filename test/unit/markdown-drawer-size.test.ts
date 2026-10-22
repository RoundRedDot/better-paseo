/**
 * The phone's details drawer reads block prose (a thought, tool text) at the
 * timeline's body size, not the block size; the timeline row keeps the block
 * size.
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
const { DEFAULT_PREFERENCES } = await import("../../client/preferences");
const { MarkdownView, TimelineProseContext } = await import("../../client/components/markdown/markdown-view");
const { blockProseBase } = await import("../../client/ui/tokens/typography");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const colors = {
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
};

function sizes(node: ReturnType<typeof TestRenderer.create>): number[] {
  const found = new Set<number>();
  for (const element of node.root.findAll(() => true)) {
    const style = [element.props?.style].flat(Infinity) as Array<Record<string, unknown> | null | undefined>;
    for (const entry of style) {
      if (entry && typeof entry.fontSize === "number") found.add(entry.fontSize);
    }
  }
  return [...found];
}

function render(drawer: boolean, blockFontSize: number) {
  const tokens = buildThemeTokens(colors, { ...DEFAULT_PREFERENCES, blockFontSize }, { platform: "ios", theme: { colors } });
  let node!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    node = TestRenderer.create(
      React.createElement(TimelineProseContext.Provider, { value: drawer },
        React.createElement(MarkdownView, { text: "A plain thought.", tokens, variant: "compact", quiet: true, size: blockProseBase(tokens.typography) })),
    );
  });
  return { tokens, sizes: sizes(node) };
}

describe("block prose in the details drawer", () => {
  it("reads at the timeline's body size whatever the block size", () => {
    for (const blockFontSize of [11, 13, 16]) {
      const { tokens, sizes: drawn } = render(true, blockFontSize);
      expect(drawn).toEqual([tokens.typography.content.size]);
    }
  });

  it("keeps the block size, a step down, in the timeline", () => {
    const { tokens, sizes: drawn } = render(false, 11);
    expect(drawn).toEqual([blockProseBase(tokens.typography) - 1]);
  });
});
