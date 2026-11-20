import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", () => ({ copyText: copy }));
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null, useRpc: () => vi.fn() }));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { useSelectionActions, createMessageTranslationBar } = await import("../../client/components/selection-actions");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { resetEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
const {
  DEFAULT_TIMELINE_TRANSLATION_SETTINGS, publishTranslationSettings, resetTranslationSettingsStoreForTests,
} = await import("../../client/translation/settings-store");
const { resetTranslationStoreForTests } = await import("../../client/translation/store");
const { clearTranslationSettingsTarget, registerTranslationSettingsOpener, translationSettingsTarget } = await import("../../client/translation/navigation");
const { bindSelectionScopeElement, selectionScopeDataSet } = await import("../../client/translation/selection");

/**
 * Only the DOM boundary is simulated, as in selection-bar-scroll: enough of
 * an element tree for the bar's shadow root, its panel, and `closest`.
 */
class ElementMock extends EventTarget {
  static ELEMENT_NODE = 1;
  nodeType = 1;
  dataset: Record<string, string> = {};
  children: ElementMock[] = [];
  parentElement: ElementMock | null = null;
  className = "";
  hidden = false;
  offsetWidth = 180;
  offsetHeight = 30;
  html = "";
  private ownText = "";
  private classes = new Set<string>();
  private attributes = new Map<string, string>();
  classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  };
  private properties = new Map<string, string>();
  style = {
    setProperty: (key: string, value: string) => this.properties.set(key, value),
    getPropertyValue: (key: string) => this.properties.get(key) ?? "",
    removeProperty: (key: string) => this.properties.delete(key),
  } as Record<string, unknown> & { setProperty(key: string, value: string): void; getPropertyValue(key: string): string };
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) { this.children = []; this.ownText = value; }
  set innerHTML(value: string) { this.children = []; this.ownText = ""; this.html = value; }
  get innerHTML() { return this.html; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  toggleAttribute(name: string, on: boolean) { if (on) this.attributes.set(name, ""); else this.attributes.delete(name); }
  attachShadow() { const root = new ElementMock(); root.parentElement = this; this.children.push(root); return root; }
  appendChild(child: ElementMock) { child.parentElement = this; this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1); }
  contains(node: ElementMock | null): boolean {
    for (let at = node; at; at = at.parentElement) if (at === this) return true;
    return false;
  }
  matches(selector: string): boolean {
    if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
    const data = /^\[data-([a-z]+)\]$/.exec(selector);
    return data ? data[1]! in this.dataset : false;
  }
  closest(selector: string): ElementMock | null {
    for (let at: ElementMock | null = this; at; at = at.parentElement) if (at.matches(selector)) return at;
    return null;
  }
  all(predicate: (node: ElementMock) => boolean): ElementMock[] {
    return this.children.flatMap((child) => [...(predicate(child) ? [child] : []), ...child.all(predicate)]);
  }
  querySelector(selector: string) { return this.all((node) => node.matches(selector))[0] ?? null; }
  click() { this.dispatchEvent(new Event("click")); }
}

const tokens = buildThemeTokens({
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0",
  accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d23c3c",
});
function Actions() { useSelectionActions(tokens, true); return null; }

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let page: EventTarget & { innerWidth: number; innerHeight: number };
let doc: EventTarget;
let body: ElementMock;
/**
 * `text` is what `Selection.toString()` returns (line breaks between blocks);
 * `rangeText` what `Range.toString()` returns for the part inside the surface
 * (no breaks, as in Chromium); `outsideText` the selected text beyond it.
 */
let selected: { text: string; node: ElementMock; focus?: ElementMock; rangeText?: string; outsideText?: string } | null;
const call = vi.fn();

type Scope = { agentId: string; kind: "assistant_message" | "user_message" | "reasoning" | "tool_output"; streaming: boolean };
const hosts = new Map<typeof call, object>();
/** One API object per translator: each stands for a host. */
const lent = (fn: typeof call) => {
  if (!hosts.has(fn)) hosts.set(fn, {});
  return { translator: { call: fn, watch: () => () => {} }, paseo: hosts.get(fn) as never };
};

/** A scoped Markdown root as `MarkdownView` binds it, translator included (`via`, null for none). */
function surface(scope: Scope | null, via: typeof call | null = call) {
  const root = new ElementMock();
  root.dataset = { bcselection: "true", ...(selectionScopeDataSet(scope) ?? {}) };
  if (scope) bindSelectionScopeElement(root, { ...scope, ...(via ? { lent: lent(via) } : null) });
  const text = new ElementMock();
  root.appendChild(text);
  body.appendChild(root);
  return text;
}
function select(text: string, node: ElementMock) {
  selected = { text, node };
  doc.dispatchEvent(new Event("selectionchange"));
  vi.advanceTimersByTime(0);
}
const host = () => body.children.find((child) => "bcselectionbar" in child.dataset || child.getAttribute("data-bcselectionbar") !== null)!;
const bar = () => host().all((node) => node.className === "bar")[0]!;
const panel = () => host().all((node) => node.className === "panel")[0]!;
const button = (label: string) => host().all((node) => node.className.split(" ").includes("btn") && node.getAttribute("aria-label") === label)[0];
const display = () => host().style.getPropertyValue("display");
async function flush() {
  await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
}
function done(translation: string) {
  return { state: "done", translation, targetLanguageCode: "zh-CN", provider: "codex", model: "gpt-5",
    thinkingMode: "custom", thinkingOptionId: null };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("__rnMockOS", "web");
  vi.stubGlobal("Node", ElementMock);
  page = Object.assign(new EventTarget(), { innerWidth: 1024, innerHeight: 768 });
  doc = new EventTarget();
  body = new ElementMock();
  vi.stubGlobal("window", Object.assign(page, {
    setTimeout, clearTimeout,
    getSelection: () => {
      const current = selected;
      return current && {
        isCollapsed: false, toString: () => current.text, rangeCount: 1,
        anchorNode: current.node, focusNode: current.focus ?? current.node,
        getRangeAt: () => ({ commonAncestorContainer: current.node, startContainer: current.node,
          getClientRects: () => [{ left: 120, top: 200, bottom: 220, width: 100, height: 20 }],
          cloneRange: () => {
            let part = current.rangeText ?? current.text;
            const beyond = () => { part = current.outsideText ?? ""; };
            const inside = () => { part = current.rangeText ?? current.text; };
            return { commonAncestorContainer: current.node,
              setStartBefore: inside, setEndAfter: inside, setStartAfter: beyond, setEndBefore: beyond, toString: () => part,
              getClientRects: () => [{ left: 120, top: 200, bottom: 220, width: 100, height: 20 }] };
          } }),
      };
    },
  }));
  vi.stubGlobal("document", Object.assign(doc, { body, createElement: () => new ElementMock() }));
  resetEnhancerPreferences();
  updateEnhancerPreferences({ language: "en" });
  resetTranslationSettingsStoreForTests();
  // A custom model: the bar needs no conversation model read.
  publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true, customModel: true, provider: "codex", model: "gpt-5" }, "custom");
  resetTranslationStoreForTests();
  call.mockReset();
  copy.mockClear();
  act(() => { renderer = TestRenderer.create(React.createElement(Actions)); });
});

afterEach(() => {
  doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("selection bar Translate", () => {
  it("shows the toolbar when a whole paragraph ends at the next element boundary", () => {
    const node = surface({ agentId: "session-1", kind: "assistant_message", streaming: false });
    selected = { text: "Fix version update checks.\n", node, focus: new ElementMock(), rangeText: "Fix version update checks." };
    doc.dispatchEvent(new Event("selectionchange"));
    vi.advanceTimersByTime(0);
    expect(display()).toBe("block");
    expect(button("Translate")).toBeDefined();
  });

  it("keeps the toolbar and the block breaks for several whole paragraphs ending at the next element", async () => {
    // Chromium (checked headless): Selection gives "A\n\nB", Range gives "AB".
    call.mockResolvedValue(done("译文"));
    const node = surface({ agentId: "session-1", kind: "assistant_message", streaming: false });
    selected = { text: "First paragraph.\n\nSecond paragraph.\n\n", node, focus: new ElementMock(),
      rangeText: "First paragraph.Second paragraph." };
    doc.dispatchEvent(new Event("selectionchange"));
    vi.advanceTimersByTime(0);
    expect(display()).toBe("block");
    button("Translate")!.click();
    await flush();
    expect(call.mock.calls[0]![0]).toMatchObject({ text: "First paragraph.\n\nSecond paragraph." });
  });

  it("does not show the toolbar when a selection includes text outside the surface", () => {
    const node = surface({ agentId: "session-1", kind: "assistant_message", streaming: false });
    selected = { text: "Reply outside text", node, focus: new ElementMock(), rangeText: "Reply", outsideText: "outside text" };
    doc.dispatchEvent(new Event("selectionchange"));
    vi.advanceTimersByTime(0);
    expect(display()).toBe("none");
  });

  it("resizes from either side and the bottom while keeping the opposite edge fixed", () => {
    act(() => renderer?.unmount());
    renderer = undefined;
    const anchor = Object.assign(new ElementMock(), {
      getBoundingClientRect: () => ({ left: 400, top: 200, bottom: 220, width: 100, height: 20 }),
    });
    body.appendChild(anchor);
    const popup = createMessageTranslationBar(anchor as unknown as HTMLElement, tokens, { close() {}, retry() {}, settings() {} }, "Original");
    popup.setView({ status: "running", targetCode: "zh-CN", text: "译文" });
    bar().offsetWidth = 500;
    const pointer = (type: string, x: number, y: number) => Object.assign(new Event(type, { cancelable: true }), { button: 0, clientX: x, clientY: y });
    const drag = (edge: string, x: number, y: number) => {
      host().querySelector(`.resize-${edge}`)!.dispatchEvent(pointer("pointerdown", 100, 100));
      page.dispatchEvent(pointer("pointermove", x, y));
      page.dispatchEvent(pointer("pointerup", x, y));
    };
    const left = parseFloat(host().style.getPropertyValue("left"));
    drag("left", 50, 100);
    expect(parseFloat(host().style.getPropertyValue("left"))).toBe(left - 50);
    expect(bar().style.getPropertyValue("--bc-panel-width")).toBe("550px");
    bar().offsetWidth = 550;
    drag("right", 140, 100);
    expect(parseFloat(host().style.getPropertyValue("left"))).toBe(left - 50);
    expect(bar().style.getPropertyValue("--bc-panel-width")).toBe("590px");
    const top = host().style.getPropertyValue("top");
    drag("bottom", 100, 140);
    expect(host().style.getPropertyValue("top")).toBe(top);
    expect(bar().style.getPropertyValue("--bc-panel-height")).toBe("70px");
    popup.dispose();
  });
  it("uses the same movable panel for whole messages and cleans it up", () => {
    act(() => renderer?.unmount());
    renderer = undefined;
    const anchor = Object.assign(new ElementMock(), {
      getBoundingClientRect: () => ({ left: 120, top: 200, bottom: 220, width: 100, height: 20 }),
    });
    body.appendChild(anchor);
    const close = vi.fn();
    const retry = vi.fn();
    const settings = vi.fn();
    const popup = createMessageTranslationBar(anchor as unknown as HTMLElement, tokens, { close, retry, settings }, "Original message");
    popup.setView({ status: "done", result: done("完整译文") as never, disableThinking: false });
    expect(bar().classList.contains("standalone")).toBe(true);
    expect(host().querySelector(".panel-heading")?.textContent).toBe("Translate");
    button("Show original")!.click();
    expect(panel().querySelector(".panel-body")?.textContent).toBe("Original message");
    button("Copy original")!.click();
    expect(copy).toHaveBeenCalledWith("Original message");
    button("Show translation")!.click();
    expect(panel().querySelector(".panel-body")?.textContent).toBe("完整译文");
    updateEnhancerPreferences({ language: "zh" });
    popup.setView({ status: "running", targetCode: "zh-CN", text: "译文" });
    expect(host().querySelector(".panel-heading")?.textContent).toBe("翻译");
    popup.setView({ status: "done", result: done("完整译文") as never, disableThinking: false });
    expect(panel().textContent).toContain("完整译文");
    const bodyPress = new Event("mousedown", { cancelable: true });
    Object.defineProperty(bodyPress, "target", { value: panel().querySelector(".panel-body") });
    bar().dispatchEvent(bodyPress);
    expect(bodyPress.defaultPrevented).toBe(false);
    const headerPress = new Event("mousedown", { cancelable: true });
    Object.defineProperty(headerPress, "target", { value: button("Translate") });
    bar().dispatchEvent(headerPress);
    expect(headerPress.defaultPrevented).toBe(true);
    button("Retry")!.click();
    button("Copy translation")!.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledWith("完整译文");
    const pointer = (type: string, x: number, y: number) => Object.assign(new Event(type, { cancelable: true }), { button: 0, clientX: x, clientY: y });
    const left = parseFloat(host().style.getPropertyValue("left"));
    host().all((node) => node.className === "drag-handle")[0]!.dispatchEvent(pointer("pointerdown", 100, 100));
    page.dispatchEvent(pointer("pointermove", 160, 140));
    page.dispatchEvent(pointer("pointerup", 160, 140));
    host().all((node) => node.className === "resize-handle")[0]!.dispatchEvent(pointer("pointerdown", 100, 100));
    page.dispatchEvent(pointer("pointermove", 200, 170));
    page.dispatchEvent(pointer("pointerup", 200, 170));
    popup.setView({ status: "running", targetCode: "zh-CN", text: "新译文" });
    expect(parseFloat(host().style.getPropertyValue("left"))).toBe(left + 60);
    expect(bar().style.getPropertyValue("--bc-panel-width")).toBe("360px");
    expect(panel().textContent).toContain("新译文");
    button("Translation settings")!.click();
    expect(settings).toHaveBeenCalledOnce();
    doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(close).toHaveBeenCalledOnce();
    popup.dispose();
    expect(body.children.some((child) => child.getAttribute("data-bcselectionbar") !== null)).toBe(false);
  });
  it("keeps the translation visible when the page scrolls", async () => {
    call.mockResolvedValue(done("译文"));
    select("selected text", surface({ agentId: "agent-1", kind: "assistant_message", streaming: false }));
    button("Translate")!.click();
    await flush();
    const position = [host().style.getPropertyValue("left"), host().style.getPropertyValue("top")];
    page.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(150);
    expect(display()).toBe("block");
    expect(panel().textContent).toContain("译文");
    expect([host().style.getPropertyValue("left"), host().style.getPropertyValue("top")]).toEqual(position);
  });

  it("keeps the translation after the selected content is replaced and its renderer unmounts", async () => {
    call.mockResolvedValue(done("译文"));
    select("selected text", surface({ agentId: "agent-1", kind: "assistant_message", streaming: false }));
    button("Translate")!.click();
    await flush();
    selected = null;
    doc.dispatchEvent(new Event("selectionchange"));
    vi.advanceTimersByTime(150);
    expect(display()).toBe("block");
    expect(button("Copy")!.hidden).toBe(true);
    expect(button("Add to chat")!.hidden).toBe(true);
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(display()).toBe("block");
    expect(panel().textContent).toContain("译文");
    doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    vi.advanceTimersByTime(150);
    expect(body.children.some((child) => child.getAttribute("data-bcselectionbar") !== null)).toBe(false);
  });

  it("moves and resizes the translation while preserving its text and selection", async () => {
    call.mockResolvedValue(done("译文"));
    select("selected text", surface({ agentId: "agent-1", kind: "assistant_message", streaming: false }));
    button("Translate")!.click();
    await flush();
    expect(button("Translate")!.textContent).toBe("Translate");
    expect(host().querySelector(".drag-handle")?.textContent).toBe("");
    const pointer = (type: string, x: number, y: number) => Object.assign(new Event(type, { cancelable: true }), { button: 0, clientX: x, clientY: y });
    const startLeft = parseFloat(host().style.getPropertyValue("left"));
    const startTop = parseFloat(host().style.getPropertyValue("top"));
    host().all((node) => node.className === "drag-handle")[0]!.dispatchEvent(pointer("pointerdown", 100, 100));
    page.dispatchEvent(pointer("pointermove", 160, 140));
    page.dispatchEvent(pointer("pointerup", 160, 140));
    expect(parseFloat(host().style.getPropertyValue("left"))).toBe(startLeft + 60);
    expect(parseFloat(host().style.getPropertyValue("top"))).toBe(startTop + 40);
    host().all((node) => node.className === "resize-handle")[0]!.dispatchEvent(pointer("pointerdown", 100, 100));
    page.dispatchEvent(pointer("pointermove", 200, 170));
    page.dispatchEvent(pointer("pointerup", 200, 170));
    expect(bar().style.getPropertyValue("--bc-panel-width")).toBe("360px");
    expect(bar().style.getPropertyValue("--bc-panel-height")).toBe("100px");
    expect(panel().textContent).toContain("译文");
    expect(selected!.text).toBe("selected text");
    expect(display()).toBe("block");
  });
  it("translates only the selected tool error on its own host and agent", async () => {
    call.mockResolvedValue(done("执行超时"));
    const node = surface({ agentId: "tool-agent", kind: "tool_output", streaming: false });
    select("js execution timed out; kernel reset", node);
    expect(button("Translate")!.hidden).toBe(false);
    button("Translate")!.click();
    await flush();
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]![0]).toMatchObject({
      action: "start", agentId: "tool-agent", sourceKind: "tool_output",
      text: "js execution timed out; kernel reset",
    });
    expect(panel().textContent).toContain("执行超时");
    publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, "tool-off");
    select("other output", node);
    expect(button("Translate")!.hidden).toBe(true);
  });
  it("translates a selected user message through its own session", async () => {
    call.mockResolvedValue(done("请检查日志"));
    select("check logs", surface({ agentId: "session-1", kind: "user_message", streaming: false }));
    expect(button("Translate")!.hidden).toBe(false);
    button("Translate")!.click();
    await flush();
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]![0]).toMatchObject({ agentId: "session-1", sourceKind: "user_message", text: "check logs" });
    expect(panel().textContent).toContain("请检查日志");
  });

  it("offers Translate only for a reply or thought selection while translation is on", () => {
    select("tool output", surface(null));
    expect(display()).toBe("block");
    expect(button("Translate")!.hidden).toBe(true);
    expect(button("Translation settings")!.hidden).toBe(true);
    expect(host().all((node) => node.className === "row-separator").map((node) => node.hidden)).toEqual([false, true]);
    select("reply words", surface({ agentId: "agent-1", kind: "assistant_message", streaming: false }));
    expect(button("Translate")!.hidden).toBe(false);
    expect(host().all((node) => node.className === "row-separator").map((node) => node.hidden)).toEqual([false, false]);
    expect(host().all((node) => node.textContent.includes(".row-separator { width: 0.5px"))).not.toHaveLength(0);
    publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, "off");
    select("reply words again", surface({ agentId: "agent-1", kind: "reasoning", streaming: false }));
    expect(button("Translate")!.hidden).toBe(true);
    expect(host().all((node) => node.className === "row-separator").map((node) => node.hidden)).toEqual([false, true]);
    expect(call).not.toHaveBeenCalled();
  });

  it("translates exactly the selection into a text-only panel bounded to the viewport", async () => {
    let firstToken!: (value: unknown) => void;
    let finish!: (value: unknown) => void;
    call.mockImplementationOnce(() => new Promise((resolve) => { firstToken = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    page.innerWidth = 300;
    page.innerHeight = 200;
    select("  the selected words  ", surface({ agentId: "agent-1", kind: "reasoning", streaming: false }));
    button("Translate")!.click();
    await flush();
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]![0]).toMatchObject({ action: "start", agentId: "agent-1", text: "the selected words", sourceKind: "reasoning" });
    expect(bar().classList.contains("translating")).toBe(true);
    expect(button("Copy")!.hidden).toBe(true);
    expect(button("Add to chat")!.hidden).toBe(true);
    expect(host().all((node) => node.className === "row-separator").every((node) => node.hidden)).toBe(true);
    expect(panel().textContent).toContain("Translating...");
    const loading = panel().querySelector(".activity-grid")!;
    expect(loading.children).toHaveLength(6);
    expect(loading.parentElement?.className).toBe("panel-message");
    const head = panel().querySelector(".panel-head")!;
    expect(head.querySelector(".activity-grid")).toBeNull();
    expect(head.querySelector(".panel-model")?.textContent).toBe("gpt-5");
    expect(head.querySelector(".panel-title")?.textContent).toBe("English");
    expect(head.textContent).not.toContain("Translation ·");
    expect(button("Translation settings")?.parentElement?.className).toBe("row");
    expect(button("Translation settings")?.hidden).toBe(false);
    expect(panel().textContent).toContain("gpt-5");
    expect(panel().textContent).not.toContain("Codex");

    await act(async () => firstToken({ state: "running", text: "第" }));
    await flush();
    expect(panel().querySelector(".panel-body")?.textContent).toBe("第");
    expect(panel().querySelector(".panel-message")).toBeNull();
    expect(button("Copy translation")).toBeUndefined();

    const markup = '<img src=x onerror="alert(1)">';
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2), { timeout: 2500 });
    await act(async () => finish({ ...done(markup), thinkingMode: "unsupported_off", thinkingOptionId: "low" }));
    await flush();
    const text = panel().querySelector(".panel-body")!;
    expect(text.textContent).toBe(markup);
    expect(panel().textContent).not.toContain("Thinking was NOT disabled");
    expect(panel().all((node) => node.html.includes("img"))).toEqual([]);
    button("Show original")!.click();
    expect(panel().querySelector(".panel-body")?.textContent).toBe("the selected words");
    button("Copy original")!.click();
    expect(copy).toHaveBeenCalledWith("the selected words");
    button("Show translation")!.click();
    expect(panel().querySelector(".panel-body")?.textContent).toBe(markup);
    expect(button("Copy translation")?.dataset.tip).toBe("Copy translation");
    expect(button("Retry")?.dataset.tip).toBe("Retry");
    expect(button("Retry")?.dataset.icon).toBe("retry");
    button("Copy translation")!.click();
    expect(button("Copy translation")?.dataset.tip).toBe("Copied");
    expect(copy).toHaveBeenCalledWith(markup);
    // Still up after copying the translation.
    expect(display()).toBe("block");

    // Width and body height fit a small window; the bar stays on screen.
    expect(bar().style.getPropertyValue("--bc-panel-width")).toBe("284px");
    const max = Number.parseInt(bar().style.getPropertyValue("--bc-panel-max"), 10);
    expect(max).toBeLessThanOrEqual(200 - 16);
    expect(Number.parseInt(host().style.getPropertyValue("top"), 10)).toBeGreaterThanOrEqual(8);
  });

  it("redraws a fading panel that showed the original after its selection is gone", async () => {
    const { seedMarkBitmaps } = await import("../../client/components/marks");
    call.mockResolvedValue(done("译文"));
    select("the selected words", surface({ agentId: "agent-1", kind: "assistant_message", streaming: false }));
    button("Translate")!.click();
    await flush();
    button("Show original")!.click();
    expect(panel().querySelector(".panel-body")?.textContent).toBe("the selected words");
    // A press elsewhere clears the selection and starts the fade out; the model's
    // mark answers within it and redraws the panel.
    selected = null;
    doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(() => seedMarkBitmaps({ "lobe:codex": "data:image/png;base64,AA==" })).not.toThrow();
    expect(panel().querySelector(".panel-body")?.textContent).toBe("译文");
    vi.advanceTimersByTime(200);
    expect(display()).toBe("none");
  });

  it("opens settings on the selected host", async () => {
    const open = vi.fn();
    const release = registerTranslationSettingsOpener(lent(call).paseo, open);
    call.mockResolvedValue(done("好"));
    select("words", surface({ agentId: "agent-1", kind: "assistant_message", streaming: false }));
    button("Translate")!.click();
    await flush();
    expect(panel().textContent).toContain("gpt-5");
    expect(panel().textContent).not.toContain("Codex");
    button("Translation settings")!.click();
    expect(open).toHaveBeenCalledWith("chat-presentation");
    expect(translationSettingsTarget()).toBe(true);
    clearTranslationSettingsTarget();
    release();
  });

  it("never shows one selection's result on another, and leaves with the bar", async () => {
    let finish!: (value: unknown) => void;
    call.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(done("其他"));
    const node = surface({ agentId: "agent-1", kind: "assistant_message", streaming: false });
    select("first", node);
    button("Translate")!.click();
    await flush();
    select("second", node);
    expect(bar().classList.contains("translating")).toBe(false);
    expect(button("Copy")!.hidden).toBe(false);
    expect(button("Add to chat")!.hidden).toBe(false);
    await act(async () => finish(done("第一")));
    await flush();
    expect(panel().textContent).not.toContain("第一");
    expect(bar().classList.contains("translating")).toBe(false);

    // Back to the first selection: no panel until pressed, then its cached result.
    select("first", node);
    expect(panel().textContent).toBe("");
    button("Translate")!.click();
    await flush();
    expect(panel().textContent).toContain("第一");
    expect(call).toHaveBeenCalledOnce();

    // Escape dismisses the bar and its panel together.
    doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    vi.advanceTimersByTime(150);
    expect(display()).toBe("none");
    expect(panel().textContent).toBe("");
  });

  it("sends through the pane the text was selected in, also for one agent id on two hosts", async () => {
    const other = vi.fn(async () => done("另一台"));
    call.mockResolvedValue(done("本机"));
    const scope = { agentId: "agent-1", kind: "tool_output" as const, streaming: false };
    const here = surface(scope, call);
    const there = surface(scope, other);
    select("same words", there);
    button("Translate")!.click();
    await flush();
    expect(other).toHaveBeenCalledOnce();
    expect(call).not.toHaveBeenCalled();
    expect(panel().textContent).toContain("另一台");
    select("same words", here);
    // A different surface is a different selection: no panel until pressed.
    expect(panel().textContent).toBe("");
    button("Translate")!.click();
    await flush();
    // Another host is another cache entry: its own request, its own result.
    expect(call).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce();
    expect(panel().textContent).toContain("本机");
    expect(panel().textContent).not.toContain("另一台");

    // A marked element nobody bound (the attributes alone) routes nowhere.
    const forged = new ElementMock();
    forged.dataset = { bcselection: "true", ...selectionScopeDataSet(scope)! };
    const text = new ElementMock();
    forged.appendChild(text);
    body.appendChild(forged);
    select("forged", text);
    expect(button("Translate")!.hidden).toBe(true);
  });

  it("sends once the selected reply settles, from the binding alone with no selection event", async () => {
    call.mockResolvedValue(done("好了"));
    const scope = { agentId: "agent-1", kind: "assistant_message" as const, streaming: true };
    const text = surface(scope);
    const root = text.parentElement!;
    select("settling words", text);
    button("Translate")!.click();
    await flush();
    expect(panel().textContent).toContain("Wait until the reply finishes streaming");
    // What MarkdownView's ref does when the reply completes: rebind the same
    // element (cleanup, then the new scope). No selectionchange follows.
    bindSelectionScopeElement(root, null);
    bindSelectionScopeElement(root, { ...scope, streaming: false, lent: lent(call) });
    await flush();
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]![0]).toMatchObject({ text: "settling words" });
    expect(panel().textContent).toContain("好了");
  });

  it("waits for streaming, explains a missing translator, and retries errors", async () => {
    call.mockRejectedValueOnce(new Error("quota")).mockResolvedValue(done("好"));
    select("still streaming", surface({ agentId: "agent-1", kind: "assistant_message", streaming: true }));
    button("Translate")!.click();
    await flush();
    expect(panel().textContent).toContain("Wait until the reply finishes streaming");
    expect(call).not.toHaveBeenCalled();

    select("no translator", surface({ agentId: "agent-1", kind: "assistant_message", streaming: false }, null));
    button("Translate")!.click();
    await flush();
    expect(panel().textContent).toContain("Translation is unavailable for this conversation");

    select("fails once", surface({ agentId: "agent-1", kind: "assistant_message", streaming: false }));
    button("Translate")!.click();
    await flush();
    expect(panel().textContent).toContain("Translation failed: quota");
    button("Retry")!.click();
    await flush();
    expect(panel().textContent).toContain("好");
    expect(call).toHaveBeenCalledTimes(2);
  });
});
