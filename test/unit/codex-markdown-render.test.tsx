import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  Icon: (props: object) => React.createElement("Icon", props),
  copyText: vi.fn(async () => {}),
  useToast: () => ({ show() {}, error() {} }),
}));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => ({ data: undefined }) }));
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { lexBlock } = await import("../../client/components/markdown/lex");
const { blockSelectionText } = await import("../../client/components/markdown/render/block-selection");
const { rangeText } = await import("../../client/components/markdown/render/table-range");
const { firstLineCenter, firstLineSource } = await import("../../client/components/markdown/render/first-line");
const { variantMetrics } = await import("../../client/components/markdown/render/styles");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = undefined; });
const colors = { surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#888891", accent: "#3b6fe0", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d23c3c" };
const source = [
  '::browser-complete{title="Checked translation"}',
  'See :codex-file-citation{path="/repo/report.pdf" purpose="source" page_number="4"} now.',
  ':codex-file-citation{path="/repo/result.pdf" purpose="output"}',
  '::code-comment{title="[P1] Fix cache" body="Stale value" file="/repo/file.ts" start=10 end=12 priority=1}',
  '::artifact-template{skill_name="artifact-template-report" display_name="Report" artifact_kind="document"}',
  '<oai-mem-citation>\n<citation_entries>\nMEMORY.md:10-12|note=[Previous decision]\n</citation_entries>\n<rollout_ids>\nid\n</rollout_ids>\n</oai-mem-citation>',
].join("\n\n");

describe("Codex messages", () => {
  it("keeps quoted directives literal and preserves ordinary surrounding text", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const tokens = buildThemeTokens(colors);
    const quote = '> ::browser-complete{title="Example"}\n>\n> :codex-file-citation{path="/repo/a.pdf" purpose="source"}';
    let tree!: ReturnType<typeof TestRenderer.create>;
    act(() => { tree = TestRenderer.create(<MarkdownView codexDirectives text={quote} tokens={tokens} variant="document" />); });
    try {
      const rendered = JSON.stringify(tree.toJSON());
      expect(rendered).toContain("::browser-complete");
      expect(rendered).toContain(":codex-file-citation");
      const copied = blockSelectionText(lexBlock(quote));
      expect(copied).toContain("::browser-complete");
      expect(copied).toContain(":codex-file-citation");
      expect(tree.root.findAll((node) => node.props.testID === "codex-browser")).toHaveLength(0);
    } finally { act(() => tree.unmount()); }
  });
  it("matches a fresh render across a streamed directive", () => {
    const tokens = buildThemeTokens(colors);
    const text = 'Before\n\n::browser-complete{title="Finished"}\n\nAfter';
    let current!: ReturnType<typeof TestRenderer.create>;
    act(() => { current = TestRenderer.create(<MarkdownView codexDirectives text="" tokens={tokens} variant="document" streaming />); });
    try {
      for (let end = 1; end <= text.length; end++) {
        let fresh!: ReturnType<typeof TestRenderer.create>;
        const view = <MarkdownView codexDirectives text={text.slice(0, end)} tokens={tokens} variant="document" streaming />;
        act(() => { current.update(view); fresh = TestRenderer.create(view); });
        expect(JSON.stringify(current.toJSON()), `prefix ${end}`).toBe(JSON.stringify(fresh.toJSON()));
        act(() => fresh.unmount());
      }
    } finally { act(() => current.unmount()); }
  });

  it("leaves directives in ordinary Markdown previews as source", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const tokens = buildThemeTokens(colors);
    let tree!: ReturnType<typeof TestRenderer.create>;
    act(() => { tree = TestRenderer.create(<MarkdownView text={source} tokens={tokens} variant="document" />); });
    try {
      expect(tree.root.findAll((node) => node.props.testID === "codex-browser")).toHaveLength(0);
      expect(JSON.stringify(tree.toJSON())).toContain("::browser-complete");
      expect(JSON.stringify(tree.toJSON())).toContain(":codex-file-citation");
    } finally { act(() => tree.unmount()); }
  });

  it.each(["web", "ios", "android"])("renders Markdown inside a review body on %s", (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    const tokens = buildThemeTokens(colors);
    const text = '::code-comment{title="Fix" body="Use `safe` value." file="/repo/a.ts"}';
    let tree!: ReturnType<typeof TestRenderer.create>;
    act(() => { tree = TestRenderer.create(<MarkdownView codexDirectives text={text} tokens={tokens} variant="document" />); });
    try {
      const rendered = JSON.stringify(tree.toJSON());
      expect(rendered).toContain("safe");
      if (platform === "ios") expect(rendered).toContain("`safe`"); // Passed to the native Markdown view.
      else expect(rendered).not.toContain("`safe`");
    } finally { act(() => tree.unmount()); }
  });

  it("copies directive source from a quoted table", () => {
    const citation = ':codex-file-citation{path="/repo/a.pdf" purpose="source"}';
    const quote = `> | Header |\n> | --- |\n> | ${citation} |`;
    const tokens = lexBlock(quote);
    expect(blockSelectionText(tokens)).toContain(citation);
    const table = (tokens[0] as import("../../client/vendor/marked").Tokens.Blockquote).tokens[0] as import("../../client/vendor/marked").Tokens.Table;
    expect(rangeText(table, [{ top: 1, left: 0, bottom: 1, right: 0 }], true)).toBe(citation);
  });

  it("aligns a translation control with a review card's first line", () => {
    const tokens = buildThemeTokens(colors);
    const metrics = variantMetrics("document", tokens.typography.content.size);
    const review = '::code-comment{title="Fix" body="Details" file="/repo/a.ts"}';
    expect(firstLineCenter(review, { metrics, ruleHeight: 1, monoLineHeight: 20 })).toBe(13 + metrics.bodyLineHeight / 2);
    expect(firstLineCenter(`${review}\r\nAfter`, { metrics, ruleHeight: 1, monoLineHeight: 20 })).toBe(13 + metrics.bodyLineHeight / 2);
    const longReview = `::code-comment{title="Fix" body="${'long '.repeat(300)}" file="/repo/a.ts"}`;
    expect(firstLineCenter(longReview, { metrics, ruleHeight: 1, monoLineHeight: 20 })).toBe(13 + metrics.bodyLineHeight / 2);
    const quote = `> ${review}`;
    const plainQuote = '> Ordinary text';
    expect(firstLineCenter(quote, { metrics, ruleHeight: 1, monoLineHeight: 20 })).toBe(firstLineCenter(plainQuote, { metrics, ruleHeight: 1, monoLineHeight: 20 }));
    const longTail = `${review}\n\n${'text '.repeat(10000)}`;
    expect(firstLineSource(longTail).length).toBeLessThan(1024);
    expect(firstLineSource(longTail, false).length).toBe(1024);
    const memory = `<oai-mem-citation>\n<citation_entries>\nMEMORY.md:1-2|note=[${'note '.repeat(300)}]\n</citation_entries>\n</oai-mem-citation>`;
    expect(firstLineCenter(memory, { metrics, ruleHeight: 1, monoLineHeight: 20 })).toBe(Math.max(32, metrics.bodyLineHeight) / 2);
  });

  for (const platform of ["web", "ios", "android"] as const) {
    it(`renders structured content and expands memory on ${platform}`, () => {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
      const tokens = buildThemeTokens(colors);
      let tree!: ReturnType<typeof TestRenderer.create>;
      act(() => { tree = TestRenderer.create(<MarkdownView codexDirectives text={source} tokens={tokens} variant="document" />); });
      try {
        for (const id of ["codex-browser", "codex-file-output", "codex-review", "codex-template", "codex-memory"]) {
          expect(tree.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === id)).toHaveLength(1);
        }
        expect(JSON.stringify(tree.toJSON())).toContain("report.pdf");
        expect(JSON.stringify(tree.toJSON())).not.toContain(":codex-file-citation");
        const memory = tree.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "codex-memory");
        const button = memory.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "button");
        expect(button.props.accessibilityState.expanded).toBe(false);
        act(() => button.props.onPress());
        expect(JSON.stringify(tree.toJSON())).toContain("Previous decision");
        expect(button.props.accessibilityState.expanded).toBe(true);
      } finally { act(() => tree.unmount()); }
    });
  }
});
