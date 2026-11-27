import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", () => ({ copyText: copy }));
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null, useRpc: () => vi.fn() }));

const { installSelectionActions } = await import("../../client/components/selection-actions");
const { resetEnhancerPreferences } = await import("../../client/preferences");

class ElementMock extends EventTarget {
  static ELEMENT_NODE = 1;
  nodeType = 1;
  tagName = "DIV";
  dataset: Record<string, string> = {};
  children: ElementMock[] = [];
  parentElement: ElementMock | null = null;
  className = "";
  hidden = false;
  offsetWidth = 180;
  offsetHeight = 30;
  box = { left: 0, top: 0, right: 1024, bottom: 768 };
  overflow = "visible";
  position = "static";
  display = "block";
  backgroundColor = "transparent";
  color = "";
  offsetParent: ElementMock | null = null;
  private ownText = "";
  private classes = new Set<string>();
  private attributes = new Map<string, string>();
  private properties = new Map<string, string>();
  classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  };
  style = {
    setProperty: (key: string, value: string) => this.properties.set(key, value),
    getPropertyValue: (key: string) => this.properties.get(key) ?? "",
    removeProperty: (key: string) => this.properties.delete(key),
  };
  constructor(tag = "DIV") {
    super();
    this.tagName = tag.toUpperCase();
  }
  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.children = [];
    this.ownText = value;
  }
  set innerHTML(_value: string) {
    this.children = [];
    this.ownText = "";
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  toggleAttribute(name: string, on: boolean) {
    if (on) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }
  attachShadow() {
    const root = new ElementMock("DIV");
    root.parentElement = this;
    this.children.push(root);
    return root;
  }
  appendChild(child: ElementMock) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  remove() {
    const siblings = this.parentElement?.children;
    if (!siblings) return;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
  }
  contains(node: ElementMock | null): boolean {
    for (let at = node; at; at = at.parentElement) if (at === this) return true;
    return false;
  }
  matches(selector: string): boolean {
    for (const part of selector.split(",").map((item) => item.trim()).filter(Boolean)) {
      if (part.startsWith(".")) {
        if (this.className.split(" ").includes(part.slice(1))) return true;
        continue;
      }
      const eq = /^\[([^=\]]+)="([^"]*)"\]$/.exec(part);
      if (eq) {
        if (this.getAttribute(eq[1]!) === eq[2]) return true;
        continue;
      }
      const attr = /^\[([^\]]+)\]$/.exec(part);
      if (attr) {
        const key = attr[1]!;
        if (this.getAttribute(key) !== null) return true;
        if (key.startsWith("data-") && key.slice(5) in this.dataset) return true;
        continue;
      }
      if (/^[a-z]+$/i.test(part) && this.tagName === part.toUpperCase()) return true;
    }
    return false;
  }
  closest(selector: string): ElementMock | null {
    for (let at: ElementMock | null = this; at; at = at.parentElement) {
      if (at.matches(selector)) return at;
    }
    return null;
  }
  all(predicate: (node: ElementMock) => boolean): ElementMock[] {
    return this.children.flatMap((child) => [...(predicate(child) ? [child] : []), ...child.all(predicate)]);
  }
  querySelectorAll(selector: string): ElementMock[] {
    return this.all((node) => node.matches(selector));
  }
  querySelector(selector: string): ElementMock | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  getBoundingClientRect() {
    return this.box;
  }
  getClientRects() {
    return [this.box];
  }
  click() {
    this.dispatchEvent(new Event("click"));
  }
  override dispatchEvent(event: Event): boolean {
    let result = super.dispatchEvent(event);
    if (event.bubbles && this.parentElement) {
      result = this.parentElement.dispatchEvent(event) && result;
    }
    return result;
  }
}

class TextAreaMock extends ElementMock {
  private _value = "";
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
  focused = false;
  constructor() {
    super("TEXTAREA");
  }
  get value() {
    return this._value;
  }
  set value(next: string) {
    this._value = next;
  }
  focus() {
    this.focused = true;
  }
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

class InputMock extends ElementMock {}

class DataTransferMock {
  private data = new Map<string, string>();
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
  getData(type: string) {
    return this.data.get(type) ?? "";
  }
}

class ClipboardEventMock extends Event {
  clipboardData: DataTransferMock;
  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean; clipboardData: DataTransferMock }) {
    super(type, init);
    this.clipboardData = init.clipboardData;
  }
}

let doc: EventTarget;
let body: ElementMock;
let selected: { text: string; node: ElementMock; focus?: ElementMock; outsideText?: string } | null;
let uninstall: (() => void) | null = null;
const line = { left: 120, right: 240, top: 200, bottom: 220, width: 120, height: 20 };

const host = () =>
  body.children.find((child) => "bcselectionbar" in child.dataset || child.getAttribute("data-bcselectionbar") !== null);
const display = () => host()?.style.getPropertyValue("display") ?? "none";
const button = (label: string) =>
  host()?.all((node) => node.className.split(" ").includes("btn") && node.getAttribute("aria-label") === label)[0];

function select(text: string, node: ElementMock, focus = node, outsideText = "") {
  selected = { text, node, focus, outsideText };
  doc.dispatchEvent(new Event("selectionchange"));
  vi.advanceTimersByTime(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("__rnMockOS", "web");
  vi.stubGlobal("Node", ElementMock);
  vi.stubGlobal("HTMLElement", ElementMock);
  vi.stubGlobal("HTMLTextAreaElement", TextAreaMock);
  vi.stubGlobal("HTMLInputElement", InputMock);
  vi.stubGlobal("DataTransfer", DataTransferMock);
  vi.stubGlobal("ClipboardEvent", ClipboardEventMock);
  copy.mockClear();
  resetEnhancerPreferences();

  const page = new EventTarget();
  doc = new EventTarget();
  body = new ElementMock("BODY");
  body.backgroundColor = "rgb(24, 24, 27)";
  selected = null;

  vi.stubGlobal(
    "window",
    Object.assign(page, {
      setTimeout,
      clearTimeout,
      innerWidth: 1024,
      innerHeight: 768,
      getSelection: () => {
        if (!selected) return { isCollapsed: true, rangeCount: 0, toString: () => "" };
        const current = selected;
        return {
          isCollapsed: false,
          rangeCount: 1,
          toString: () => current.text,
          anchorNode: current.node,
          focusNode: current.focus ?? current.node,
          getRangeAt: () => ({
            startContainer: current.node,
            endContainer: current.focus ?? current.node,
            commonAncestorContainer:
              current.focus && current.focus !== current.node
                ? (current.node.parentElement ?? current.node)
                : current.node,
            getClientRects: () => [line],
            getBoundingClientRect: () => line,
            cloneRange() {
              return {
                setStartAfter() {},
                setEndBefore() {},
                setEndAfter() {},
                setStartBefore() {},
                getClientRects: () => [line],
                getBoundingClientRect: () => line,
                toString: () => current.outsideText ?? "",
              };
            },
          }),
        };
      },
      getComputedStyle: (el: ElementMock) => ({
        overflowX: el.overflow,
        overflowY: el.overflow,
        position: el.position,
        display: el.display,
        backgroundColor: el.backgroundColor,
        color: el.color,
      }),
    }),
  );
  vi.stubGlobal(
    "document",
    Object.assign(doc, {
      body,
      documentElement: body,
      createElement: (tag: string) => new ElementMock(tag),
      execCommand: () => false,
    }),
  );
  uninstall = installSelectionActions();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createNativePane() {
  const pane = new ElementMock("DIV");
  const chat = new ElementMock("DIV");
  chat.setAttribute("data-testid", "agent-chat-scroll");
  chat.backgroundColor = "rgb(20, 20, 24)";
  const composer = new TextAreaMock();
  composer.setAttribute("data-composer-input", "");
  pane.appendChild(chat);
  pane.appendChild(composer);
  body.appendChild(pane);
  return { pane, chat, composer };
}

describe("selection bar in native Paseo chats", () => {
  it("shows Copy and Add to chat without Translate and quotes prose into the composer", () => {
    const { chat, composer } = createNativePane();
    const message = new ElementMock("DIV");
    message.setAttribute("data-testid", "assistant-message");
    const paragraph = new ElementMock("P");
    paragraph.textContent = "Line one\nLine two";
    message.appendChild(paragraph);
    chat.appendChild(message);

    select("Line one\nLine two", paragraph);

    expect(display()).toBe("block");
    expect(button("Copy")?.hidden).toBe(false);
    expect(button("Add to chat")?.hidden).toBe(false);
    expect(button("Translate")?.hidden).toBe(true);
    expect(host()?.style.getPropertyValue("--bc-bar-bg")).toBe("rgb(20, 20, 24)");
    expect(host()?.style.getPropertyValue("--bc-bar-text")).toBe("#f2f2f2");

    button("Add to chat")?.click();
    expect(composer.value).toBe("> Line one\n> Line two\n\n");
    expect(composer.focused).toBe(true);
  });

  it("uses Paseo's native copy markdown handler for assistant messages", () => {
    const { chat, composer } = createNativePane();
    const surface = new ElementMock("DIV");
    surface.addEventListener("copy", (event) => {
      event.preventDefault();
      (event as ClipboardEventMock).clipboardData.setData("text/plain", "Use **bold** and `code`");
    });
    const message = new ElementMock("DIV");
    message.setAttribute("data-testid", "assistant-message");
    const paragraph = new ElementMock("P");
    paragraph.textContent = "Use bold and code";
    message.appendChild(paragraph);
    surface.appendChild(message);
    chat.appendChild(surface);

    select("Use bold and code", paragraph);
    button("Copy")?.click();
    expect(copy).toHaveBeenCalledWith("Use **bold** and `code`");

    select("Use bold and code", paragraph);
    button("Add to chat")?.click();
    expect(composer.value).toBe("> Use **bold** and `code`\n\n");
  });

  it("fences native code blocks with their language and four-backtick escape when needed", () => {
    const { chat, composer } = createNativePane();
    const pre = new ElementMock("DIV");
    pre.setAttribute("data-paseo-markdown-tag", "pre");
    pre.setAttribute("data-paseo-markdown-language", "ts");
    const code = new ElementMock("SPAN");
    code.setAttribute("data-paseo-markdown-tag", "code");
    code.textContent = "const x = 1;";
    pre.appendChild(code);
    chat.appendChild(pre);

    select("const x = 1;", code);
    button("Add to chat")?.click();
    expect(composer.value).toBe("```ts\nconst x = 1;\n```\n\n");

    composer.value = "";
    select("const md = '```ts';", code);
    button("Add to chat")?.click();
    expect(composer.value).toBe("````ts\nconst md = '```ts';\n````\n\n");
  });

  it("supports dragging across a plugin card and a native message in the same chat", () => {
    const { chat, composer } = createNativePane();
    const card = new ElementMock("DIV");
    card.dataset.bcselection = "true";
    const cardText = new ElementMock("SPAN");
    cardText.textContent = "Tool result";
    card.appendChild(cardText);

    const nativeMsg = new ElementMock("DIV");
    nativeMsg.setAttribute("data-testid", "assistant-message");
    const nativeText = new ElementMock("P");
    nativeText.textContent = "Assistant reply";
    nativeMsg.appendChild(nativeText);

    chat.appendChild(card);
    chat.appendChild(nativeMsg);

    select("Tool result\nAssistant reply", cardText, nativeText, "Assistant reply");
    expect(display()).toBe("block");
    expect(button("Translate")?.hidden).toBe(true);
    button("Add to chat")?.click();
    expect(composer.value).toBe("> Tool result\n> Assistant reply\n\n");
  });

  it("ignores selections outside chat, across two panes, inside buttons, and inside inputs", () => {
    const { chat, composer } = createNativePane();
    const outside = new ElementMock("P");
    outside.textContent = "Sidebar item";
    body.appendChild(outside);
    select("Sidebar item", outside);
    expect(display()).toBe("none");

    select("draft text", composer);
    expect(display()).toBe("none");

    const btn = new ElementMock("BUTTON");
    btn.textContent = "Copy";
    chat.appendChild(btn);
    select("Copy", btn);
    expect(display()).toBe("none");

    const { chat: secondChat } = createNativePane();
    const firstMsg = new ElementMock("P");
    const secondMsg = new ElementMock("P");
    chat.appendChild(firstMsg);
    secondChat.appendChild(secondMsg);
    select("cross pane", firstMsg, secondMsg);
    expect(display()).toBe("none");
  });

  it("stops listening once uninstalled", () => {
    const { chat } = createNativePane();
    const msg = new ElementMock("P");
    chat.appendChild(msg);
    uninstall?.();
    uninstall = null;

    select("hello", msg);
    expect(host()).toBeUndefined();
  });
});
