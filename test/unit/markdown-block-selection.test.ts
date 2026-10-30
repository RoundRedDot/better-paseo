import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copy = vi.hoisted(() => vi.fn(async (_text: string, _options?: object) => true));
const list = React.createContext<{ getScrollMetrics(): { offset: number } } | null>(null);
vi.mock("react-native", async () => ({ ...await import("./helpers/rn-mock"), VirtualizedList: { get contextType() { return list; } } }));
vi.mock("../../client/ui/use-copy", () => ({ useCopy: () => ({ copy }) }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: (props: object) => React.createElement("Icon", props), ScrollView: rn.ScrollView,
    Modal: rn.View, TextInput: rn.TextInput, useRevealedText: (text: string) => text };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ data: undefined }),
  useRpc: () => async () => ({ dataUri: null, mime: null, width: null, height: null, bytes: null, error: "File not found" }),
}));
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { blockSelectionText } = await import("../../client/components/markdown/render/block-selection");
const { Lexer } = await import("../../client/vendor/marked");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { Linking } = await import("react-native");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const os = globalThis as { __rnMockOS?: string };
const tokens = buildThemeTokens({ surface0: "#181818", surface1: "#222222", surface2: "#333333", border: "#444444",
  foreground: "#eeeeee", foregroundMuted: "#999999", accent: "#6688ff", accentForeground: "#ffffff",
  statusSuccess: "#00aa00", statusWarning: "#ffaa00", statusDanger: "#ff0000" });
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let offset = 0;
const view = (text: string, streaming = false) => React.createElement(list.Provider,
  { value: { getScrollMetrics: () => ({ offset }) } }, React.createElement(MarkdownView, { text, tokens, variant: "document", streaming }));
function render(text: string, streaming = false) {
  act(() => {
    if (renderer) renderer.update(view(text, streaming));
    else renderer = TestRenderer.create(view(text, streaming));
  });
}
const frames = () => renderer!.root.findAll((node) => String(node.type) === "View" && node.props.testID === "markdown-block-selection");
const highlights = () => renderer!.root.findAll((node) => String(node.type) === "View" && node.props.testID === "markdown-block-highlight");
const menus = () => renderer!.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Copy selected block");
const native = () => renderer!.root.findAll((node) => ["EnrichedMarkdown", "EnrichedMarkdownText"].includes(String(node.type)));
function touch(timestamp: number, x = 10, y = 10, fingers = 1) {
  return { stopPropagation: vi.fn(), nativeEvent: { timestamp, pageX: x, pageY: y, touches: Array(fingers).fill({}) } };
}
function tap(index: number, time: number) {
  act(() => frames()[index]!.props.onTouchStart(touch(time)));
  act(() => frames()[index]!.props.onTouchEnd(touch(time + 30)));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  os.__rnMockOS = undefined; offset = 0;
  copy.mockReset().mockResolvedValue(true);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("iOS single Markdown block selection", () => {
  it.each([
    ["**first** and `code`", "first and code"],
    ["## Heading words", "Heading words"],
    ["- first **item**\n- second item", "first item\nsecond item"],
    ["> first line\n>\n> second paragraph", "first line\n\nsecond paragraph"],
  ])("selects only the double-tapped block: %s", async (source, plain) => {
    render(`Before.\n\n${source}\n\nAfter.`);
    tap(1, 100); expect(menus()).toHaveLength(0);
    tap(1, 230); expect(highlights()).toHaveLength(1);
    expect(native()[0]!.props.selectable).toBe(true);
    expect(native()[1]!.props.selectable).toBe(false);
    expect(native().at(-1)!.props.selectable).toBe(true);
    await act(async () => menus()[0]!.props.onPress());
    expect(copy).toHaveBeenCalledExactlyOnceWith(plain, { feedback: "toast" });
    expect(highlights()).toHaveLength(0);
    expect(native()[1]!.props.selectable).toBe(true);
  });
  it("preserves formatted text, entities, explicit breaks and link labels", () => {
    expect(blockSelectionText(Lexer.lex("**Bold** &amp; `code` [docs](https://example.com)  \n下一行")))
      .toBe("Bold & code docs\n下一行");
  });
  it("does not combine taps across blocks, and only one block stays selected", () => {
    render("First.\n\nSecond.");
    tap(0, 100); tap(1, 150); tap(0, 200);
    expect(menus()).toHaveLength(0);
    tap(0, 300); expect(highlights()).toHaveLength(1);
    tap(1, 400); expect(highlights()).toHaveLength(0);
    tap(1, 500); expect(highlights()).toHaveLength(1);
    expect(native().map((node) => node.props.selectable)).toEqual([true, false]);
  });
  it.each(["scroll", "hold", "multitouch", "cancel", "distant", "late"])("rejects %s instead of selecting", (kind) => {
    render("Paragraph."); tap(0, 100);
    const start = kind === "late" ? 700 : 230;
    act(() => frames()[0]!.props.onTouchStart(touch(start, 10, 10, kind === "multitouch" ? 2 : 1)));
    if (kind === "scroll") act(() => frames()[0]!.props.onTouchMove(touch(250, 10, 40)));
    if (kind === "cancel") act(() => frames()[0]!.props.onTouchCancel());
    act(() => frames()[0]!.props.onTouchEnd(touch(kind === "hold" ? 800 : start + 30,
      kind === "distant" ? 80 : 10)));
    expect(menus()).toHaveLength(0);
  });
  it("clears selection on source changes and scrolling", () => {
    render("Paragraph."); tap(0, 100); tap(0, 230);
    offset = 50; act(() => { vi.advanceTimersByTime(16); });
    expect(highlights()).toHaveLength(0);
    tap(0, 400); tap(0, 530); expect(highlights()).toHaveLength(1);
    render("New paragraph."); expect(highlights()).toHaveLength(0);
  });
  it("preserves selection after a failed copy so it can be retried", async () => {
    copy.mockResolvedValueOnce(false);
    render("Paragraph."); tap(0, 100); tap(0, 230);
    await act(async () => menus()[0]!.props.onPress()); expect(highlights()).toHaveLength(1);
    await act(async () => menus()[0]!.props.onPress()); expect(highlights()).toHaveLength(0);
  });
  it("does not dismiss a newer selection when an earlier copy completes", async () => {
    let finish!: (ok: boolean) => void;
    copy.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render("Paragraph."); tap(0, 100); tap(0, 230);
    act(() => menus()[0]!.props.onPress());
    tap(0, 400); tap(0, 530);
    await act(async () => finish(true));
    expect(highlights()).toHaveLength(1);
  });
  it("keeps links on their native action and cancels pending block taps", () => {
    const open = vi.spyOn(Linking, "openURL");
    render("See [docs](https://example.com)."); tap(0, 100);
    act(() => frames()[0]!.props.onTouchStart(touch(230)));
    act(() => native()[0]!.props.onLinkPress({ nativeEvent: { url: "bc-prose://0" } }));
    act(() => frames()[0]!.props.onTouchEnd(touch(260)));
    expect(open).toHaveBeenCalledExactlyOnceWith("https://example.com");
    expect(menus()).toHaveLength(0);
  });
  it("keeps table, code and image controls on their existing gestures", async () => {
    await act(async () => { render("Paragraph.\n\n```txt\ncode\n```\n\n| a |\n| --- |\n| b |\n\n![image](file:///tmp/a.png)"); });
    expect(frames()).toHaveLength(1);
    tap(0, 100); tap(0, 230);
    const root = renderer!.root.findAll((node) => String(node.type) === "View" && node.props.dataSet?.bcselection)[0]!;
    act(() => root.props.onTouchStart()); expect(menus()).toHaveLength(0);
  });
  it.each(["web", "android"])("leaves %s selection unchanged", (platform) => {
    os.__rnMockOS = platform; render("First.\n\nSecond.");
    expect(frames()).toHaveLength(0); expect(menus()).toHaveLength(0);
  });
});
