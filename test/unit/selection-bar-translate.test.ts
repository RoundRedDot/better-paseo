import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", () => ({ copyText: copy }));
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null, useRpc: () => vi.fn() }));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { useSelectionActions } = await import("../../client/components/selection-actions");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { resetEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
const {
  DEFAULT_TIMELINE_TRANSLATION_SETTINGS, publishTranslationSettings, resetTranslationSettingsStoreForTests,
} = await import("../../client/translation/settings-store");
const { resetTranslationStoreForTests } = await import("../../client/translation/store");
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
let selected: { text: string; node: ElementMock };
const call = vi.fn();

type Scope = { agentId: string; kind: "assistant_message" | "reasoning"; streaming: boolean };
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
const button = (label: string) => host().all((node) => node.className === "btn" && node.getAttribute("aria-label") === label)[0];
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
    getSelection: () => selected && {
      isCollapsed: false, toString: () => selected.text, rangeCount: 1,
      anchorNode: selected.node, focusNode: selected.node,
      getRangeAt: () => ({ commonAncestorContainer: selected.node,
        getClientRects: () => [{ left: 120, top: 200, bottom: 220, width: 100, height: 20 }] }),
    },
  }));
  vi.stubGlobal("document", Object.assign(doc, { body, createElement: () => new ElementMock() }));
  resetEnhancerPreferences();
  updateEnhancerPreferences({ language: "en" });
  resetTranslationSettingsStoreForTests();
  // A custom model: the bar needs no conversation model read.
  publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, customModel: true, provider: "codex", model: "gpt-5" }, "custom");
  resetTranslationStoreForTests();
  call.mockReset();
  copy.mockClear();
  act(() => { renderer = TestRenderer.create(React.createElement(Actions)); });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("selection bar Translate", () => {
  it("offers Translate only for a reply or thought selection while translation is on", () => {
    select("tool output", surface(null));
    expect(display()).toBe("block");
    expect(button("Translate")!.hidden).toBe(true);
    select("reply words", surface({ agentId: "agent-1", kind: "assistant_message", streaming: false }));
    expect(button("Translate")!.hidden).toBe(false);
    publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, "off");
    select("reply words again", surface({ agentId: "agent-1", kind: "reasoning", streaming: false }));
    expect(button("Translate")!.hidden).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it("translates exactly the selection into a text-only panel bounded to the viewport", async () => {
    let finish!: (value: unknown) => void;
    call.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    page.innerWidth = 300;
    page.innerHeight = 200;
    select("  the selected words  ", surface({ agentId: "agent-1", kind: "reasoning", streaming: false }));
    button("Translate")!.click();
    await flush();
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]![0]).toMatchObject({ action: "start", agentId: "agent-1", text: "the selected words", sourceKind: "reasoning" });
    expect(bar().classList.contains("translating")).toBe(true);
    expect(panel().textContent).toContain("Translating...");

    const markup = '<img src=x onerror="alert(1)">';
    await act(async () => finish(done(markup)));
    await flush();
    const text = panel().querySelector(".panel-body")!;
    expect(text.textContent).toBe(markup);
    expect(panel().all((node) => node.html.includes("img"))).toEqual([]);
    expect(button("Copy translation")).toBeDefined();
    button("Copy translation")!.click();
    expect(copy).toHaveBeenCalledWith(markup);
    // Still up after copying the translation.
    expect(display()).toBe("block");

    // Width and body height fit a small window; the bar stays on screen.
    expect(bar().style.getPropertyValue("--bc-panel-width")).toBe("284px");
    const max = Number.parseInt(bar().style.getPropertyValue("--bc-panel-max"), 10);
    expect(max).toBeLessThanOrEqual(200 - 16);
    expect(Number.parseInt(host().style.getPropertyValue("top"), 10)).toBeGreaterThanOrEqual(8);
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
    const scope = { agentId: "agent-1", kind: "assistant_message" as const, streaming: false };
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
