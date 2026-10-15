import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
const state = vi.hoisted(() => ({ layers: [] as Array<{ maximized?: boolean }>, copy: vi.fn(async (_text: string) => {}) }));
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
  openPreviewLayer: (_node: unknown, _anchor: unknown, _close: unknown, options: { maximized?: boolean }) => {
    state.layers.push(options);
    return () => {};
  },
}));
import { MarkdownView } from "../../client/components/markdown/markdown-view";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { updateEnhancerPreferences, resetEnhancerPreferences } from "../../client/preferences";
import { StyleSheet } from "./helpers/rn-mock";

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
      .toEqual(["Show raw text"]);
    expect(buttons("Show raw text")[0]!.find((node) => String(node.type) === "Icon").props.name).toBe("Code");
    const body = hosts("hover-preview")[0]!;
    expect(body.findByType(MarkdownView).props.text).toBe(source);
    expect(buttons("Open Markdown in a window")).toHaveLength(1);
    press("Show raw text");
    const raw = renderer.root.findAll((node) => String(node.type) === "Text" && node.props.testID === "markdown-preview-source")[0]!;
    expect(raw.children).toEqual([source]);
    expect(buttons("Show raw text")).toHaveLength(0);
    expect(buttons("Render Markdown")).toHaveLength(1);
    expect(buttons("Render Markdown")[0]!.find((node) => String(node.type) === "Icon").props.name).toBe("FileText");
    await act(async () => {
      body.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Copy code")[0]!.props.onPress();
    });
    expect(state.copy).toHaveBeenCalledWith(source);
    press("Render Markdown");
    expect(body.findByType(MarkdownView).props.text).toBe(source);
    expect(buttons("Render Markdown")).toHaveLength(0);
    expect(buttons("Show raw text")).toHaveLength(1);
    press("Close preview");
    expect(hosts("hover-preview")).toHaveLength(0);
  });

  it.each(["", "md", "markdown", "text", "txt", "plaintext"])("offers the window for %s fences", (language) => {
    platform.__rnMockOS = "web";
    render(language);
    expect(buttons("Open Markdown in a window")).toHaveLength(1);
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
