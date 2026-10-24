import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lexer } from "../../client/vendor/marked";
import { nativeProseSource, escapeProse, groupNativeParagraphs, nativeBlockSource, nativeList } from "../../client/components/markdown/render/native-prose-source";

const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("../../client/ui/use-copy", () => ({ useCopy: () => ({ copy }) }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: (props: object) => React.createElement("Icon", props), ScrollView: rn.ScrollView,
    Modal: rn.View, TextInput: rn.TextInput, useRevealedText: (text: string) => text };
});
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => ({ data: undefined }), useRpc: () => async () => null }));
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { MarkdownProse } = await import("../../client/components/markdown/render/prose");
const { buildStyles, variantMetrics } = await import("../../client/components/markdown/render/styles");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { PathContext } = await import("../../client/ui/path-text");
const { Linking } = await import("react-native");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const os = globalThis as { __rnMockOS?: string };
afterEach(() => { os.__rnMockOS = undefined; vi.clearAllMocks(); });
const colors = { surface0: "#181818", surface1: "#222222", surface2: "#333333", border: "#444444",
  foreground: "#eeeeee", foregroundMuted: "#999999", accent: "#6688ff", accentForeground: "#ffffff",
  statusSuccess: "#00aa00", statusWarning: "#ffaa00", statusDanger: "#ff0000" };
const tokens = buildThemeTokens(colors);
const metrics = variantMetrics("document", 16);
const context = { tokens, metrics, styles: buildStyles(tokens, "document", metrics), variant: "document" as const, collapseCode: false };
const inline = (source: string) => Lexer.lexInline(source, { gfm: true });

describe("native prose source", () => {
  it("preserves inline formatting and CommonMark soft/hard breaks", () => {
    expect(nativeProseSource(inline("plain\n**bold** *italic* ~~gone~~ `value`  \nnext")).markdown)
      .toBe("plain **bold** _italic_ ~~gone~~ `value`\nnext");
  });
  it("escapes literal HTML, entities and block-looking text instead of reparsing it", () => {
    const source = nativeProseSource(inline("&lt;b&gt;literal&lt;/b&gt; &amp; &#35; title <b>x</b>"));
    expect(source.markdown).toBe("\\<b\\>literal\\</b\\> \\& \\# title \\<b\\>x\\</b\\>");
    expect(escapeProse("# heading\n- item\n```code\n[link](x)")).toBe("\\# heading\n\\- item\n\\`\\`\\`code\n\\[link\\]\\(x\\)");
  });
  it("retains backticks and boundary spaces in code spans", () => {
    expect(nativeProseSource([{ type: "codespan", raw: "", text: "`x`" }]).markdown).toBe("`` `x` ``");
    expect(nativeProseSource([{ type: "codespan", raw: "", text: " x " }]).markdown).toBe("`  x  `");
  });
  it("routes every link through our allowlist/path action and keeps remote images as labels", () => {
    const source = nativeProseSource(inline("[**docs**](https://example.com) `src/a.ts:42` [file](file:///tmp/a%20b.md) ![alt](https://example.com/a.png) [bad](javascript:alert)"));
    expect(source.links).toEqual([
      { kind: "url", target: "https://example.com" }, { kind: "path", target: "src/a.ts:42" },
      { kind: "path", target: "/tmp/a b.md" }, { kind: "url", target: "https://example.com/a.png" },
      { kind: "url", target: "javascript:alert" },
    ]);
    expect(source.markdown).toContain("[**docs**](bc-prose://0)");
    expect(source.markdown).toContain("[`src/a.ts:42`](bc-prose://1)");
    expect(source.markdown).not.toContain("![");
  });
  it("bounds paragraph grouping and leaves code fences, tables and local images separate", () => {
    const paragraphs = Array.from({ length: 9 }, (_, index) => `Paragraph ${index}\n\n`);
    expect(groupNativeParagraphs(paragraphs)).toEqual([paragraphs.slice(0, 8).join(""), paragraphs[8]]);
    for (const boundary of ["```txt\ncode\n```\n\n", "| a |\n| --- |\n| b |\n\n", "![image](file:///tmp/a.png)\n\n"]) {
      expect(groupNativeParagraphs([paragraphs[0]!, boundary, paragraphs[1]!])).toHaveLength(3);
    }
    expect(groupNativeParagraphs(["a".repeat(5000) + "\n\n", "b".repeat(5000)])).toHaveLength(2);
  });
  it("preserves ordered starts, nesting and link indices across grouped paragraphs", () => {
    const source = nativeBlockSource(Lexer.lex("3. [first](https://example.com)\n4. second\n   - nested\n\nAfter [last](https://example.org)", { gfm: true }));
    expect(source.markdown).toContain("3. [first](bc-prose://0)\n4. second");
    expect(source.markdown).toContain("   - nested");
    expect(source.markdown).toContain("After [last](bc-prose://1)");
  });
  it("retains the existing renderer for custom list markers, loose items and checkboxes", () => {
    for (const source of ["- outer\n  - inner", "- first\n\n- second", "- [x] done", "- item\n  ```txt\n  code\n  ```"]) {
      expect(nativeList(Lexer.lex(source, { gfm: true })[0]!)).toBe(false);
    }
  });
});

async function render(source: string) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => { renderer = TestRenderer.create(React.createElement(MarkdownView, {
    text: source, tokens, variant: "document", streaming: true,
  })); });
  return renderer;
}
const native = (renderer: ReturnType<typeof TestRenderer.create>) => renderer.root.findAll((node) =>
  String(node.type) === "EnrichedMarkdownText" || String(node.type) === "EnrichedMarkdown");

describe("iOS Markdown prose", () => {
  it("uses one selectable native view across all inline runs, with existing reading styles", async () => {
    const renderer = await render("See **bold** and *italic* with `value`.");
    expect(native(renderer)).toHaveLength(1);
    expect(native(renderer)[0]!.props).toMatchObject({ selectable: true, enableLinkPreview: false,
      enableBlockContextMenu: false, streamingAnimation: false, allowTrailingMargin: false,
      markdownStyle: { paragraph: { color: tokens.foreground, marginBottom: variantMetrics("document", tokens.typography.content.size).blockGap },
        strong: { fontWeight: "600" }, code: { fontFamily: tokens.fontMono } } });
    expect(renderer.root.findAll((node) => String(node.type) === "Text")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
  it("covers headings, lists and quotes without replacing the table's cell renderer", async () => {
    const renderer = await render("# Heading\n\n- list **body**\n\n> quoted body\n\n| col |\n| --- |\n| cell |");
    expect(native(renderer).map((node) => node.props.markdown)).toEqual(["Heading", "- list **body**", "quoted body"]);
    expect(String(native(renderer)[1]!.type)).toBe("EnrichedMarkdown");
    expect(renderer.root.findAll((node) => String(node.type) === "Text" && node.props.testID === "markdown-table-cell")).toHaveLength(2);
    await act(async () => renderer.unmount());
  });
  it("reuses completed paragraph groups and their native styles while the tail grows", async () => {
    const finished = Array.from({ length: 8 }, (_, index) => `Finished **paragraph ${index}**.\n\n`).join("");
    const renderer = await render(finished + "Tail");
    const first = native(renderer)[0]!.props;
    await act(async () => renderer.update(React.createElement(MarkdownView, {
      text: finished + "Tail grows", tokens, variant: "document", streaming: true,
    })));
    expect(native(renderer)[0]!.props).toBe(first);
    expect(native(renderer)[1]!.props.markdown).toBe("Tail grows");
    await act(async () => renderer.unmount());
  });
  for (const variant of ["document", "compact", "terminal"] as const) it(`${variant}: streamed groups match fresh renders across block boundaries`, async () => {
    const source = "First **paragraph**.\n\nSecond *paragraph*.\n\n# Heading\n\n- first\n- second\n\n> quote\n>\n> next\n\n| col |\n| --- |\n| cell |\n\n```txt\ncode\n```\n\nLast paragraph.";
    const view = (text: string, streaming: boolean) => React.createElement(MarkdownView, { text, tokens, variant, streaming });
    let streamed!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { streamed = TestRenderer.create(view("", true)); });
    for (let end = 5; end < source.length + 5; end += 5) {
      const prefix = source.slice(0, end);
      let fresh!: ReturnType<typeof TestRenderer.create>;
      await act(async () => { streamed.update(view(prefix, true)); fresh = TestRenderer.create(view(prefix, true)); });
      expect(JSON.stringify(streamed.toJSON()), `prefix ${end}`).toBe(JSON.stringify(fresh.toJSON()));
      await act(async () => fresh.unmount());
    }
    let complete!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { streamed.update(view(source, false)); complete = TestRenderer.create(view(source, false)); });
    expect(JSON.stringify(streamed.toJSON())).toBe(JSON.stringify(complete.toJSON()));
    await act(async () => { streamed.unmount(); complete.unmount(); });
  });
  it("copies the resolved path on touch and refuses unsafe URL schemes", async () => {
    const open = vi.spyOn(Linking, "openURL");
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(PathContext.Provider,
      { value: { roots: [], mode: "relative", cwd: "/project" } },
      React.createElement(MarkdownProse, { context, style: context.styles.paragraph,
        tokens: inline("`src/a.ts:42` [bad](javascript:alert) [docs](https://example.com)") })));
    });
    const press = native(renderer)[0]!.props.onLinkPress;
    await act(async () => { press({ nativeEvent: { url: "bc-prose://0" } }); });
    expect(copy).toHaveBeenCalledWith("/project/src/a.ts", expect.objectContaining({ label: "Copy path" }));
    press({ nativeEvent: { url: "bc-prose://1" } });
    expect(open).not.toHaveBeenCalled();
    press({ nativeEvent: { url: "bc-prose://2" } });
    expect(open).toHaveBeenCalledWith("https://example.com");
    press({ nativeEvent: { url: "bc-prose://999" } });
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });
  for (const platform of ["web", "android"]) it(`keeps ${platform} on the existing inline renderer`, async () => {
    os.__rnMockOS = platform;
    const renderer = await render("See **bold**.");
    expect(native(renderer)).toHaveLength(0);
    expect(renderer.root.findAll((node) => String(node.type) === "Text").length).toBeGreaterThan(1);
    await act(async () => renderer.unmount());
  });
});
