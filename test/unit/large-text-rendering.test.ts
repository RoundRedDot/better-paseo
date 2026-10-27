import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

const rpc = vi.hoisted(() => ({ call: vi.fn(async () => null) }));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}) }));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpc.call }));
vi.mock("@getpaseo/plugin/client/react-native", async () => ({
  Icon: (await import("./helpers/rn-mock")).View,
  copyText: clipboard.copyText, useToast: () => ({ show: vi.fn(), error: vi.fn() }),
}));

import { buildThemeTokens } from "../../client/components/theme-tokens";
import { SyntaxHighlightBlock, TerminalOutput } from "../../client/components/syntax-highlight";
import { DiffPreview } from "../../client/components/tool-output";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { HoverPreviewBody } from "../../client/ui/hover-preview";
import { PreviewLines } from "../../client/ui/preview-lines";
import { TextZoomContext } from "../../client/ui/text-zoom";
import { DIFF_TEXT_CHUNK_LINES, TEXT_CHUNK_CHARS, TEXT_CHUNK_LINES } from "../../client/ui/text-chunks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#06c", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
const mounted: ReactTestRenderer[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  resetEnhancerPreferences();
  rpc.call.mockClear();
  clipboard.copyText.mockClear();
});
afterEach(() => {
  act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "children" in value) return textOf(value.children);
  return "";
}

function render(element: React.ReactElement) {
  let offset = 0;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element, { createNodeMock: (node) => ({
      measure: (done: (...box: number[]) => void) => done(0, 0, 390, 600, 0, node.type === "ScrollView" ? 0 : -offset),
    }) });
  });
  mounted.push(renderer);
  const flush = () => act(() => { vi.advanceTimersByTime(16); });
  const scroll = (to: number) => {
    offset = to;
    const body = renderer.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "hover-preview-body");
    act(() => body.props.onScroll({ nativeEvent: { contentOffset: { y: to }, layoutMeasurement: { height: 600 }, contentSize: { height: 1_000_000 } } }));
    flush();
  };
  return { renderer, flush, scroll };
}

describe.each(["ios", "android"])("large native previews on %s", (os) => {
  it.each([1_000, 5_000, 20_000])("opens %i lines with bounded text, gutter and stripe work, then loads a distant scroll position", (count) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const lines = Array.from({ length: count }, (_, index) => `source-${index}`);
    const renderLine = vi.fn((line: string) => line);
    const { renderer, flush, scroll } = render(React.createElement(HoverPreviewBody, null,
      React.createElement(PreviewLines, { text: lines.join("\n"), lines, tokens, style: {}, renderLine })));
    flush();
    expect(renderLine).toHaveBeenCalledTimes(TEXT_CHUNK_LINES);
    const gutterText = () => renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "preview-line-numbers")
      .flatMap((gutter) => gutter.children).map(textOf);
    expect(gutterText()).toHaveLength(TEXT_CHUNK_LINES);
    expect(renderer.root.findAllByProps({ testID: "preview-text-placeholder" }).length).toBeGreaterThan(0);
    const target = Math.floor(count / 2 / TEXT_CHUNK_LINES) * TEXT_CHUNK_LINES;
    scroll(target * tokens.typography.mono.lineHeight);
    expect(renderLine.mock.calls.some(([line]) => line === `source-${target}`)).toBe(true);
    expect(renderLine.mock.calls.length).toBeLessThan(TEXT_CHUNK_LINES * 5);
    expect(gutterText()).toContain(String(target + 1));
    expect(textOf(renderer.toJSON())).toContain("source-0");
    const calls = renderLine.mock.calls.length;
    scroll(0);
    expect(renderLine).toHaveBeenCalledTimes(calls);
  });

  it("keeps diff file numbers and semantic fills across chunk boundaries", () => {
    updateEnhancerPreferences({ previewStripes: false });
    const lines = ["@@ -900,400 +1000,400 @@", ...Array.from({ length: 400 }, (_, index) => index === 80 ? "-old" : index === 81 ? "+new" : ` context-${index}`)];
    const { renderer, scroll } = render(React.createElement(HoverPreviewBody, null,
      React.createElement(DiffPreview, { text: lines.join("\n"), filename: "x.ts", tokens, style: {}, running: true })));
    const firstGutter = renderer.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "preview-line-numbers");
    expect(firstGutter.children).toHaveLength(DIFF_TEXT_CHUNK_LINES);
    scroll(64 * tokens.typography.mono.lineHeight);
    const gutters = renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "preview-line-numbers");
    const numbers = gutters.flatMap((gutter) => gutter.children.map(textOf));
    expect(numbers).toContain("1063");
    const removed = numbers.indexOf("980");
    expect(removed).toBeGreaterThanOrEqual(0);
    expect(numbers.slice(removed, removed + 2)).toEqual(["980", "1080"]);
    const fills = renderer.root.findAll((node) => (node.type as unknown) === "View" && Array.isArray(node.props.style)
      && node.props.style.some((part: { backgroundColor?: string } | null) => part?.backgroundColor === tokens.syntax.diffAddBg || part?.backgroundColor === tokens.syntax.diffRemoveBg));
    expect(fills).toHaveLength(2);
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it("bounds a minified line, retains its source number only once, and loads its end", () => {
    const text = `${"a".repeat(TEXT_CHUNK_CHARS * 20)}END`;
    const lines = [text];
    const renderLine = vi.fn((line: string) => line);
    const { renderer, scroll } = render(React.createElement(HoverPreviewBody, null,
      React.createElement(PreviewLines, { text, lines, tokens, style: {}, renderLine, firstLine: 40 })));
    expect(renderLine).not.toHaveBeenCalled();
    const texts = () => renderer.root.findAll((node) => (node.type as unknown) === "Text" && node.props.onTextLayout);
    expect(texts()).toHaveLength(1);
    expect(textOf(texts()[0]!)).toHaveLength(TEXT_CHUNK_CHARS);
    const chunkHeight = Math.ceil(TEXT_CHUNK_CHARS / (Math.floor(320 / (tokens.typography.mono.size * 0.62)) - 8)) * tokens.typography.mono.lineHeight;
    scroll(20 * chunkHeight);
    expect(textOf(renderer.toJSON())).toContain("END");
    expect(texts().every((node) => textOf(node).length <= TEXT_CHUNK_CHARS)).toBe(true);
    const gutters = renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "preview-line-numbers");
    expect(gutters[0]!.children.map(textOf)).toEqual(["40"]);
    expect(gutters.at(-1)!.children.map(textOf)).toEqual([""]);
  });

  it("keeps finished chunks mounted when streaming changes only the tail", () => {
    const lines = Array.from({ length: 1_000 }, (_, index) => `line-${index}`);
    const renderLine = vi.fn((line: string) => line);
    const style = {};
    const draw = (source: string[]) => React.createElement(HoverPreviewBody, { streaming: true,
      children: React.createElement(PreviewLines, { text: source.join("\n"), lines: source, tokens, style, renderLine }) });
    const { renderer, flush, scroll } = render(draw(lines));
    scroll(960 * tokens.typography.mono.lineHeight);
    renderLine.mockClear();
    const appended = [...lines, ...Array.from({ length: 50 }, (_, index) => `line-${index + 1_000}`)];
    act(() => renderer.update(draw(appended)));
    flush();
    expect(renderLine.mock.calls.map(([line]) => line)).toEqual(appended.slice(999, 1024));
    expect(textOf(renderer.toJSON())).toContain("line-0");
  });

  it("copies the current complete source line when streaming crosses the long-line boundary", async () => {
    const style = {};
    const renderLine = (line: string) => line;
    const draw = (first: string) => {
      const lines = [first, ...Array.from({ length: 300 }, (_, index) => `line-${index}`)];
      return React.createElement(HoverPreviewBody, null,
        React.createElement(PreviewLines, { text: lines.join("\n"), lines, style, renderLine, tokens }));
    };
    const { renderer, flush } = render(draw("x".repeat(TEXT_CHUNK_CHARS)));
    const complete = `${"x".repeat(TEXT_CHUNK_CHARS)}NEW`;
    act(() => renderer.update(draw(complete)));
    flush();
    const gutter = renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "preview-line-numbers")[0]!;
    act(() => gutter.props.onResponderGrant({ nativeEvent: { locationY: 0, pageY: 0 } }));
    act(() => { vi.advanceTimersByTime(400); });
    act(() => gutter.props.onResponderRelease());
    const copy = renderer.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Copy selected lines");
    await act(async () => copy.props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith(complete);
  });
});

describe("bounded timeline expansion", () => {
  it("limits initial code by characters and keeps full copying", async () => {
    const code = Array.from({ length: 100 }, (_, index) => `${index}: ${"x".repeat(3_000)}`).join("\n");
    const { renderer } = render(React.createElement(SyntaxHighlightBlock, { code, tokens, language: "plaintext", showLineNumbers: true, highlight: false }));
    const drawn = renderer.root.findAll((node) => (node.type as unknown) === "Text" && node.props.selectable);
    expect(drawn.map(textOf).join("").length).toBeLessThanOrEqual(TEXT_CHUNK_CHARS);
    // The header owns the original text independently of how many rows mount.
    await act(async () => renderer.update(React.createElement(SyntaxHighlightBlock, { code, tokens, language: "plaintext", highlight: true })));
    const copy = renderer.root.findByProps({ accessibilityLabel: "Copy code" });
    await act(async () => copy.props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith(code);
  });

  it("lays a huge single code line out in bounded parts and can fold it again", () => {
    const code = `${"x".repeat(TEXT_CHUNK_CHARS * 3)}END`;
    const { renderer, flush } = render(React.createElement(SyntaxHighlightBlock, { code, tokens, language: "plaintext", highlight: false }));
    const texts = () => renderer.root.findAll((node) => (node.type as unknown) === "Text" && node.props.selectable);
    expect(texts().map(textOf)).toEqual([code.slice(0, TEXT_CHUNK_CHARS)]);
    const show = renderer.root.find((node) => (node.type as unknown) === "Pressable" && textOf(node) === "Show 3 more parts");
    act(() => show.props.onPress());
    expect(texts()).toHaveLength(2);
    flush();
    flush();
    expect(texts().map(textOf).join("")).toBe(code);
    const less = renderer.root.find((node) => (node.type as unknown) === "Pressable" && textOf(node) === "Show less");
    act(() => less.props.onPress());
    expect(texts()).toHaveLength(1);
  });

  it("keeps expanded native logs in bounded text roots and folds to the newest lines", () => {
    const text = Array.from({ length: 600 }, (_, index) => `line-${index} ${"word ".repeat(30)}`).join("\n");
    const { renderer, flush } = render(React.createElement(TerminalOutput, { text, tokens }));
    expect(textOf(renderer.toJSON())).toContain("line-599");
    expect(textOf(renderer.toJSON())).not.toContain("line-0 ");
    const more = renderer.root.find((node) => (node.type as unknown) === "Pressable" && textOf(node).includes("earlier lines"));
    act(() => more.props.onPress());
    for (let frame = 0; frame < 20; frame++) flush();
    const roots = renderer.root.findAll((node) => (node.type as unknown) === "Text" && node.props.selectable === true && node.props.style === undefined);
    expect(roots.length).toBeGreaterThan(1);
    expect(roots.every((node) => textOf(node).length <= TEXT_CHUNK_CHARS)).toBe(true);
    expect(textOf(renderer.toJSON())).toContain("line-0 ");
  });

  it("keeps a minified command's newest text visible first", () => {
    const text = `${"x".repeat(TEXT_CHUNK_CHARS * 3)}LATEST`;
    const { renderer } = render(React.createElement(TerminalOutput, { text, tokens }));
    expect(textOf(renderer.toJSON())).toContain("LATEST");
    const roots = renderer.root.findAll((node) => (node.type as unknown) === "Text" && node.props.selectable === true);
    expect(roots.map(textOf).join("")).toBe(text.slice(-TEXT_CHUNK_CHARS));
  });

  it("preserves empty lines and trailing indentation at native text boundaries", () => {
    const lines = Array.from({ length: 140 }, (_, index) => index === 63 || index === 127 ? "" : index === 62 || index === 128 ? "  " : `line-${index}`);
    const text = lines.join("\n");
    const style = { fontSize: 13 };
    const { renderer, flush } = render(React.createElement(TerminalOutput, { text, tokens, style }));
    const more = renderer.root.find((node) => (node.type as unknown) === "Pressable" && textOf(node).includes("earlier lines"));
    act(() => more.props.onPress());
    flush();
    const roots = renderer.root.findAll((node) => (node.type as unknown) === "Text" && node.props.selectable === true && node.props.style === style);
    expect(roots.map(textOf).join("\n")).toBe(text);
  });
});

it("preserves desktop full rendering and small native text selection", () => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  const lines = Array.from({ length: 1_000 }, (_, index) => String(index));
  const renderLine = vi.fn((line: string) => line);
  const { renderer } = render(React.createElement(PreviewLines, { text: lines.join("\n"), lines, tokens, style: {}, renderLine }));
  expect(renderLine).toHaveBeenCalledTimes(1_000);
  expect(renderer.root.findAllByProps({ testID: "preview-text-chunks" })).toHaveLength(0);
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  const small = render(React.createElement(TextZoomContext.Provider, { value: 20 },
    React.createElement(PreviewLines, { text: "a\nb", lines: ["a", "b"], tokens, style: { fontSize: 12, lineHeight: 18 } })));
  const text = small.renderer.root.find((node) => (node.type as unknown) === "Text" && node.props.onTextLayout);
  expect(textOf(text)).toBe("a\nb");
  expect(text.props.style.flat(Infinity)).toContainEqual({ fontSize: 20, lineHeight: 30 });
});
