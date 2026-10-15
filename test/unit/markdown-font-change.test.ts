/**
 * Plan D10: a change of Paseo's Appearance mono font reaches plugin cards as
 * new tokens. That must restyle a reply without parsing its Markdown again:
 * only styles and the render context change.
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
const { Lexer } = await import("../../client/vendor/marked");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { DEFAULT_PREFERENCES } = await import("../../client/preferences");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");

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

const REPLY = [
  "Run it with `npm test` first.",
  "",
  "```ts",
  "export const add = (a: number, b: number) => a + b;",
  "```",
  "",
  "Then check `src/add.ts`.",
].join("\n");

function families(node: ReturnType<typeof TestRenderer.create>): string[] {
  const found = new Set<string>();
  for (const element of node.root.findAll(() => true)) {
    const style = [element.props?.style].flat(Infinity) as Array<Record<string, unknown> | null | undefined>;
    for (const entry of style) {
      if (entry && typeof entry.fontFamily === "string") found.add(entry.fontFamily);
    }
  }
  return [...found];
}

describe("a Paseo appearance font change", () => {
  it("restyles code without lexing the reply again", () => {
    const options = { platform: "web" as const, theme: { colors } };
    const before = buildThemeTokens(colors, DEFAULT_PREFERENCES, options);
    const after = buildThemeTokens(colors, DEFAULT_PREFERENCES, {
      ...options,
      appearance: { monoFontFamily: "Courier New", codeFontSize: 16 },
    });
    const view = (tokens: typeof before) =>
      React.createElement(MarkdownView, { text: REPLY, tokens, variant: "document", streaming: false, compact: false });

    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(view(before));
    });
    expect(families(renderer).some((family) => family.startsWith('"Courier New"'))).toBe(false);

    const lex = vi.spyOn(Lexer, "lex");
    const blockTokens = vi.spyOn(Lexer.prototype, "blockTokens");
    act(() => renderer.update(view(after)));
    expect(lex).not.toHaveBeenCalled();
    expect(blockTokens).not.toHaveBeenCalled();
    expect(families(renderer).some((family) => family.startsWith('"Courier New"'))).toBe(true);
    // The spies do see parsing: new text is lexed.
    act(() =>
      renderer.update(
        React.createElement(MarkdownView, {
          text: `${REPLY}\n\nOne more paragraph.`,
          tokens: after,
          variant: "document",
          streaming: false,
          compact: false,
        }),
      ),
    );
    expect(lex.mock.calls.length + blockTokens.mock.calls.length).toBeGreaterThan(0);
    act(() => renderer.unmount());
  });
});

describe("virtualized Markdown row spacing", () => {
  it("restores the block gap between rows and uses the item gap within a continued list", () => {
    const tokens = buildThemeTokens(colors, DEFAULT_PREFERENCES, { platform: "ios", theme: { colors } });
    const view = (firstBlock: boolean, listContinuation = false) => React.createElement(MarkdownView, {
      text: "- Item\n", tokens, variant: "document", compact: true, firstBlock, listContinuation,
    });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    const topPadding = () => {
      const root = renderer.root.findAll((node) => (node.type as unknown) === "View")[0]!;
      return Object.assign({}, ...[root.props.style].flat(Infinity).filter(Boolean)).paddingTop;
    };
    act(() => { renderer = TestRenderer.create(view(true)); });
    try {
      expect(topPadding()).toBeUndefined();
      act(() => renderer.update(view(false)));
      expect(topPadding()).toBe(16);
      act(() => renderer.update(view(false, true)));
      expect(topPadding()).toBeGreaterThan(0);
      expect(topPadding()).toBeLessThan(16);
    } finally { act(() => renderer.unmount()); }
  });
});
