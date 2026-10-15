import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
const state = vi.hoisted(() => ({ layers: [] as Array<{ maximized?: boolean; onLinesFit?(fits: boolean): void }>, copy: vi.fn(async (_text: string) => {}) }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: "Icon", TextInput: rn.TextInput, ScrollView: rn.ScrollView,
    copyText: state.copy, useToast: () => ({ show() {}, error() {}, success() {} }),
    useRevealedText: (text: string) => text };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined, useRpc: () => () => Promise.resolve(null),
  usePaseo: () => ({}), useSettings: () => ({ status: "loading" }),
}));
vi.mock("../../client/web", async (original) => ({
  ...await original<typeof import("../../client/web")>(),
  bindRowHover: () => () => {},
  openPreviewLayer: (_node: unknown, _anchor: unknown, _close: unknown, options: { maximized?: boolean; onLinesFit?(fits: boolean): void }) => {
    state.layers.push(options);
    return () => {};
  },
}));
import { MarkdownView } from "../../client/components/markdown/markdown-view";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { updateEnhancerPreferences, resetEnhancerPreferences } from "../../client/preferences";
import { StyleSheet } from "./helpers/rn-mock";
import { PreviewLines } from "../../client/ui/preview-lines";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const platform = globalThis as { __rnMockOS?: string };
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
let renderer: ReturnType<typeof TestRenderer.create>;
const source = "# Title\n\n**bold**\n\n" + Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n");
const view = (text: string, streaming = false) => React.createElement(MarkdownView, { text, tokens, variant: "document", streaming });
function render(language = "", text = source, closed = true) {
  act(() => {
    renderer = TestRenderer.create(view(`\`\`\`${language}\n${text}${closed ? "\n```" : ""}`, !closed), {
      createNodeMock: () => ({
        measureInWindow: (done: (...args: number[]) => void) => done(0, 100, 300, 30),
        addEventListener() {}, removeEventListener() {},
      }),
    });
  });
}
const hosts = (id: string) => renderer.root.findAll((node) => String(node.type) === "View" && node.props.testID === id);
const buttons = (label: string) => renderer.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === label);
const press = (label: string) => act(() => buttons(label)[0]!.props.onPress());
afterEach(() => {
  act(() => renderer?.unmount());
  delete platform.__rnMockOS;
  state.layers = [];
  state.copy.mockClear();
  resetEnhancerPreferences();
});

describe("Markdown code window", () => {
  it("keeps raw text wrapping available after the desktop layer reports fitting lines", () => {
    platform.__rnMockOS = "web";
    render("markdown");
    press("Open Markdown in a window");
    act(() => state.layers.at(-1)!.onLinesFit!(true));
    expect(buttons("Do not wrap lines")[0]!.props.disabled).toBe(true);
    press("Show raw text");
    const header = hosts("hover-preview-start")[0]!;
    const wrap = header.find((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Do not wrap lines");
    expect(wrap.props.disabled).toBe(false);
    act(() => wrap.props.onPress());
    expect(header.find((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Wrap lines").props.disabled).toBe(false);
    press("Render Markdown");
    expect(buttons("Do not wrap lines")[0]!.props.disabled).toBe(true);
  });
  it.each(["web", "ios", "android"])("opens maximized, switches the complete source and closes on %s", async (os) => {
    platform.__rnMockOS = os;
    updateEnhancerPreferences({ hoverPreview: false });
    render("markdown");
    expect(hosts("hover-preview")).toHaveLength(0);
    press("Open Markdown in a window");
    expect(hosts("hover-preview")).toHaveLength(1);
    if (os === "web") expect(state.layers.at(-1)?.maximized).toBe(true);
    else {
      act(() => hosts("hover-preview-stage")[0]!.props.onLayout({ nativeEvent: { layout: { width: 390, height: 844 } } }));
      expect(StyleSheet.flatten(hosts("hover-preview")[0]!.props.style)).toMatchObject({ width: 374, height: os === "ios" ? 660 : 644 });
    }
    const header = hosts("hover-preview-start")[0]!;
    expect(header.findAll((node) => String(node.type) === "Pressable").map((node) => node.props.accessibilityLabel))
      .toEqual(["Do not wrap lines", "Show raw text"]);
    const wrapButton = buttons("Do not wrap lines")[0]!;
    expect(wrapButton.props.disabled).toBe(true);
    expect(StyleSheet.flatten(wrapButton.props.style).opacity).toBeLessThan(1);
    expect(buttons("Show raw text")[0]!.find((node) => String(node.type) === "Icon").props.name).toBe("Code");
    const body = hosts("hover-preview")[0]!;
    expect(body.findByType(MarkdownView).props.text).toBe(source);
    expect(buttons("Open Markdown in a window")).toHaveLength(1);
    press("Show raw text");
    expect(buttons("Do not wrap lines")[0]!.props.disabled).toBe(false);
    press("Do not wrap lines");
    expect(header.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Wrap lines")).toHaveLength(1);
    expect(body.findByType(PreviewLines).props.text).toBe(source);
    expect(body.findAll((node) => String(node.type) === "Text" && node.children.length === 1 && node.children[0] === source)).toHaveLength(1);
    expect(buttons("Show raw text")).toHaveLength(0);
    expect(buttons("Render Markdown")).toHaveLength(1);
    expect(buttons("Render Markdown")[0]!.find((node) => String(node.type) === "Icon").props.name).toBe("FileText");
    await act(async () => {
      body.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Copy code")[0]!.props.onPress();
    });
    expect(state.copy).toHaveBeenCalledWith(source);
    press("Render Markdown");
    expect(buttons("Do not wrap lines")[0]!.props.disabled).toBe(true);
    expect(header.findAll((node) => String(node.type) === "Pressable").map((node) => node.props.accessibilityLabel))
      .toEqual(["Do not wrap lines", "Show raw text"]);
    expect(body.findByType(MarkdownView).props.text).toBe(source);
    expect(buttons("Render Markdown")).toHaveLength(0);
    expect(buttons("Show raw text")).toHaveLength(1);
    press("Show raw text");
    expect(header.find((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Wrap lines").props.disabled).toBe(false);
    expect(header.findAll((node) => String(node.type) === "Pressable").map((node) => node.props.accessibilityLabel))
      .toEqual(["Wrap lines", "Render Markdown"]);
    press("Close preview");
    expect(hosts("hover-preview")).toHaveLength(0);
  });

  it.each(["", "md", "markdown", "text", "txt", "plaintext"])("offers the window for %s fences", (language) => {
    platform.__rnMockOS = "web";
    render(language);
    expect(buttons("Open Markdown in a window")).toHaveLength(1);
  });

  it.each([
    [false, false], [true, false], [false, true], [true, true],
  ])("uses preview settings for raw text (numbers: %s, stripes: %s)", (previewLineNumbers, previewStripes) => {
    platform.__rnMockOS = "web";
    updateEnhancerPreferences({ previewLineNumbers, previewStripes, previewWrap: false });
    const text = "# Heading\n\n**raw** &amp;\n";
    render("markdown", text);
    press("Open Markdown in a window");
    press("Show raw text");
    expect(hosts("preview-line-numbers")).toHaveLength(previewLineNumbers ? 1 : 0);
    expect(hosts("preview-line-stripes")).toHaveLength(previewStripes ? 1 : 0);
    const body = hosts("hover-preview")[0]!;
    const raw = body.findByType(PreviewLines);
    expect(raw.props.text).toBe(text);
    expect(raw.props.lines).toEqual(["# Heading", "", "**raw** &amp;", ""]);
    expect(body.findAll((node) => String(node.type) === "Text" && node.children.length === 1 && node.children[0] === text)).toHaveLength(1);
    const header = hosts("hover-preview-start")[0]!;
    const wrap = header.find((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Wrap lines");
    expect(wrap.props.disabled).toBe(false);
    act(() => wrap.props.onPress());
    expect(header.find((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Do not wrap lines").props.disabled).toBe(false);
    act(() => updateEnhancerPreferences({ previewLineNumbers: !previewLineNumbers, previewStripes: !previewStripes }));
    expect(hosts("preview-line-numbers")).toHaveLength(previewLineNumbers ? 0 : 1);
    expect(hosts("preview-line-stripes")).toHaveLength(previewStripes ? 0 : 1);
  });

  it("keeps other languages and unfinished fences without the window button", () => {
    render("ts");
    expect(buttons("Open Markdown in a window")).toHaveLength(0);
    act(() => renderer.update(view("```markdown\n# Still writing", true)));
    expect(buttons("Open Markdown in a window")).toHaveLength(0);
  });

  it("does not offer another window for a fence rendered inside the preview", () => {
    platform.__rnMockOS = "web";
    render("markdown", "# Outer\n\n~~~md\n# Inner\n~~~");
    press("Open Markdown in a window");
    expect(buttons("Open Markdown in a window")).toHaveLength(1);
  });
});
