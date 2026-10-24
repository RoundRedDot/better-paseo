import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const clipboard = vi.hoisted(() => vi.fn(async (_text: string) => {}));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: object) => React.createElement("Icon", props),
  useRevealedText: (text: string) => text,
  copyText: clipboard,
  useToast: () => ({ show() {}, error() {} }),
}));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => ({ data: undefined }) }));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { DEFAULT_PREFERENCES } = await import("../../client/preferences");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { StyleSheet } = await import("react-native");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = undefined; });

const header = "`★ Insight ─────────────────────────────────────`\n";
const body = "- **集合不变**，`id` 可能变化。\n- 第二条内容。\n";
const footer = "`─────────────────────────────────────────────────`";

describe("Insight rendering", () => {
  it("matches a fresh render at every streaming prefix, including the closing rule", () => {
    const tokens = buildThemeTokens({
      surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
      foreground: "#1b1b1f", foregroundMuted: "#888891", accent: "#3b6fe0",
      accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d23c3c",
    });
    const source = `${header}${body}${footer}\n\nAfter`;
    const view = (text: string) => React.createElement(MarkdownView, { text, tokens, variant: "document", streaming: true });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(view("")); });
    try {
      for (let end = 1; end <= source.length; end++) {
        let fresh!: ReturnType<typeof TestRenderer.create>;
        act(() => { renderer.update(view(source.slice(0, end))); fresh = TestRenderer.create(view(source.slice(0, end))); });
        expect(JSON.stringify(renderer.toJSON()), `prefix ${end}`).toBe(JSON.stringify(fresh.toJSON()));
        act(() => fresh.unmount());
      }
    } finally { act(() => renderer.unmount()); }
  });

  for (const platform of ["web", "ios", "android"] as const) {
    for (const dark of [false, true]) {
      it(`${platform}, ${dark ? "dark" : "light"}: draws a flat card and copies its Markdown body`, async () => {
        (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
        const colors = {
          surface0: dark ? "#18181b" : "#ffffff", surface1: dark ? "#27272a" : "#f6f6f7",
          surface2: dark ? "#303034" : "#ececee", border: dark ? "#444449" : "#e2e2e6",
          foreground: dark ? "#fafafa" : "#1b1b1f", foregroundMuted: "#888891",
          accent: "#3b6fe0", accentForeground: "#ffffff", statusSuccess: "#1f8a5b",
          statusWarning: "#a36a00", statusDanger: "#d23c3c",
        };
        const tokens = buildThemeTokens(colors, DEFAULT_PREFERENCES, { platform, theme: { colors } });
        for (const variant of ["document", "compact", "terminal"] as const) {
          const view = (text: string, streaming: boolean) => React.createElement(MarkdownView, {
            text, tokens, variant, compact: true, streaming,
          });
          let renderer!: ReturnType<typeof TestRenderer.create>;
          act(() => { renderer = TestRenderer.create(view(header + body, true)); });
          try {
            const card = () => renderer.root.findAll((node) =>
              (node.type as unknown) === "View" &&
              StyleSheet.flatten(node.props.style)?.borderWidth === 1,
            );
            expect(card()).toHaveLength(1);
            const style = StyleSheet.flatten(card()[0]!.props.style);
            expect(style.backgroundColor).toBe(tokens.v2.surface1);
            expect(style.borderColor).toBe(tokens.v2.border);
            expect(style.borderLeftWidth).toBeUndefined();
            expect(style.boxShadow).toBeUndefined();
            expect(style.shadowOpacity).toBeUndefined();
            expect(style.elevation).toBeUndefined();
            expect(style.width).toBeUndefined();
            const button = () => card()[0]!.find((node) =>
              (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "button",
            );
            expect(button().props.accessibilityLabel).toBe("Copy section");
            // Header actions stay in one row, with the copy control at the end.
            const headerRow = card()[0]!.find((node) => (node.type as unknown) === "View" &&
              StyleSheet.flatten(node.props.style)?.justifyContent === "space-between");
            expect(StyleSheet.flatten(headerRow.props.style).flexDirection).toBe("row");
            expect(headerRow.findAll((node) => node === button())).toHaveLength(1);
            await act(async () => { button().props.onPress(); });
            expect(clipboard).toHaveBeenLastCalledWith(body.trim());
            expect(button().props.accessibilityLabel).toBe("Copied");
            act(() => renderer.update(view(header + body + footer + "\n\nAfter", false)));
            expect(card()).toHaveLength(1);
            const texts = renderer.root.findAll((node) => (node.type as unknown) === "Text");
            if (platform === "ios") {
              const prose = renderer.root.findAll((node) => String(node.type) === "EnrichedMarkdownText" || String(node.type) === "EnrichedMarkdown");
              expect(prose.some((node) => node.props.markdown === "✦ Insight" && node.props.selectable)).toBe(true);
              expect(prose.some((node) => node.props.markdown.includes("`id`"))).toBe(true);
            } else {
              expect(texts.some((node) => node.props.children === "✦ Insight" && node.props.selectable)).toBe(true);
              expect(texts.some((node) => node.props.children === "id")).toBe(true);
            }
            expect(JSON.stringify(renderer.toJSON())).not.toContain("────");
            // The next paragraph stays outside the Insight container.
            expect(card()[0]!.findAll((node) => node.props.children === "After")).toHaveLength(0);
            const lists = card()[0]!.findAll((node) =>
              (node.type as unknown) === "View" && StyleSheet.flatten(node.props.style)?.gap === 8,
            );
            expect(lists.length).toBeGreaterThan(0);
            await act(async () => { button().props.onPress(); });
            expect(clipboard).toHaveBeenLastCalledWith(body.trim());
          } finally { act(() => renderer.unmount()); }
        }
      });
    }
  }
});
