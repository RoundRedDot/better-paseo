/**
 * Pointer focus loses the host's focus ring, keyboard focus keeps it
 * (`client/components/focus-ring.ts`). Paseo draws its ring for
 * `*:focus-visible`, and Chromium starts matching that on a clicked element at
 * the next key press, so the modality is recorded when focus arrives.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  installPointerFocusRing,
  POINTER_FOCUS_ATTRIBUTE,
  PLUGIN_ROOT_ATTRIBUTE,
} from "../../client/components/focus-ring";

/** Just enough of the DOM: a tree, attributes, `closest` on one attribute, `contains`. */
class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  isContentEditable = false;
  constructor(public tagName: string) {}
  append(...children: FakeElement[]) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  closest(selector: string): FakeElement | null {
    const name = selector.replace(/^\[|\]$/g, "");
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (node.attributes.has(name)) return node;
    }
    return null;
  }
  contains(other: unknown): boolean {
    for (let node = other as FakeElement | null; node; node = node.parent) if (node === this) return true;
    return false;
  }
  remove() {}
}

function fakeDocument(all: () => FakeElement[]) {
  const listeners = new Map<string, Set<(event: { target: unknown }) => void>>();
  const styles = new Map<string, { id: string; textContent: string; remove(): void }>();
  return {
    styles,
    listeners,
    getElementById: (id: string) => styles.get(id) ?? null,
    createElement: () => {
      const style = {
        id: "",
        textContent: "",
        remove() {
          styles.delete(style.id);
        },
      };
      return style;
    },
    head: { appendChild: (style: { id: string; textContent: string; remove(): void }) => styles.set(style.id, style) },
    addEventListener(type: string, listener: (event: { target: unknown }) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: { target: unknown }) => void) {
      listeners.get(type)?.delete(listener);
    },
    querySelectorAll: (selector: string) => {
      const name = selector.replace(/^\[|\]$/g, "");
      return all().filter((element) => element.attributes.has(name));
    },
    dispatch(type: string, target: unknown) {
      for (const listener of listeners.get(type) ?? []) listener({ target });
    },
  };
}

const globals = globalThis as { document?: unknown };

function setup() {
  // A plugin row: root > header button > verb text; a field in the same root;
  // and a host button outside any plugin root.
  const root = new FakeElement("DIV");
  root.setAttribute(PLUGIN_ROOT_ATTRIBUTE, "");
  const header = new FakeElement("BUTTON");
  const verb = new FakeElement("DIV");
  header.append(verb);
  const field = new FakeElement("INPUT");
  root.append(header, field);
  const hostButton = new FakeElement("BUTTON");
  const doc = fakeDocument(() => [root, header, verb, field, hostButton]);
  globals.document = doc;
  const remove = installPointerFocusRing();
  /** A mouse click: pointerdown on what is under the pointer, then focus moves. */
  const click = (target: FakeElement, focused: FakeElement) => {
    doc.dispatch("pointerdown", target);
    doc.dispatch("focusin", focused);
  };
  /** Tab: the key goes down, then focus moves. */
  const tab = (focused: FakeElement) => {
    doc.dispatch("keydown", focused);
    doc.dispatch("focusin", focused);
  };
  return { doc, remove, click, tab, root, header, verb, field, hostButton };
}

afterEach(() => {
  delete globals.document;
});

describe("pointer focus ring", () => {
  it("installs one rule that outranks the host's *:focus-visible, scoped to plugin roots", () => {
    const { doc, remove } = setup();
    const rules = [...doc.styles.values()].map((style) => style.textContent).join("\n");
    expect(rules).toContain(`[${PLUGIN_ROOT_ATTRIBUTE}] [${POINTER_FOCUS_ATTRIBUTE}]:focus-visible`);
    expect(rules).toContain("outline: none");
    expect(rules).not.toContain("!important");
    remove();
    expect(doc.styles.size).toBe(0);
  });

  it("tags a header a pointer focused, and keeps it tagged through a later key press", () => {
    const { doc, click, header, verb } = setup();
    click(verb, header);
    expect(header.hasAttribute(POINTER_FOCUS_ATTRIBUTE)).toBe(true);
    // Shift or Cmd after the click makes Chromium match :focus-visible; the tag stays.
    doc.dispatch("keydown", header);
    expect(header.hasAttribute(POINTER_FOCUS_ATTRIBUTE)).toBe(true);
    doc.dispatch("focusout", header);
    expect(header.hasAttribute(POINTER_FOCUS_ATTRIBUTE)).toBe(false);
  });

  it("never tags keyboard focus, also when Tab returns to a row that was clicked before", () => {
    const { doc, click, tab, header, verb, field } = setup();
    tab(header);
    expect(header.hasAttribute(POINTER_FOCUS_ATTRIBUTE)).toBe(false);
    click(verb, header);
    doc.dispatch("focusout", header);
    tab(field);
    doc.dispatch("focusout", field);
    tab(header);
    expect(header.hasAttribute(POINTER_FOCUS_ATTRIBUTE)).toBe(false);
  });

  it("leaves the host's controls and text fields alone", () => {
    const { click, field, hostButton } = setup();
    click(hostButton, hostButton);
    expect(hostButton.hasAttribute(POINTER_FOCUS_ATTRIBUTE)).toBe(false);
    click(field, field);
    expect(field.hasAttribute(POINTER_FOCUS_ATTRIBUTE)).toBe(false);
  });

  it("removes its listeners and tags on unload", () => {
    const { doc, remove, click, header, verb } = setup();
    click(verb, header);
    remove();
    expect(header.hasAttribute(POINTER_FOCUS_ATTRIBUTE)).toBe(false);
    for (const set of doc.listeners.values()) expect(set.size).toBe(0);
  });

  it("is a no-op without a document (iOS, Android)", () => {
    delete globals.document;
    expect(() => installPointerFocusRing()()).not.toThrow();
  });
});
