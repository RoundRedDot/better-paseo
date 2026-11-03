import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Text } from "react-native";

/**
 * The row's ref has to be a DOM node before its layout effect. React Native
 * Web's View is one; the test renderer is not, so the stand-in writes the
 * node the case put on `globalThis`.
 */
vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    Platform: { OS: "web" },
    View: (props: { ref?: { current: unknown } | ((node: unknown) => void); children?: React.ReactNode; style?: unknown }) => {
      const { ref, ...rest } = props;
      const node = (globalThis as { __heldNode?: unknown }).__heldNode ?? null;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
      // Keep the ref off the host element: the renderer would replace it with its own instance.
      return ReactModule.createElement("View", rest);
    },
  };
});

import { followScrollerBottom, hiddenAncestor, intersectsWindow, isHiddenNode, useHeldRow } from "../../client/ui/hidden-row";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeNode {
  nodeType: number;
  style: { display: string };
  parentElement: FakeNode | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  id?: string;
  getBoundingClientRect: () => { top: number; bottom: number; left: number; width: number; height: number };
  closest: (selector: string) => FakeNode | null;
}

function element(partial: Partial<FakeNode> = {}): FakeNode {
  return {
    nodeType: 1,
    style: { display: "" },
    parentElement: null,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, width: 0, height: 0 }),
    closest: () => null,
    ...partial,
  };
}

function asElement(node: FakeNode): HTMLElement {
  return node as unknown as HTMLElement;
}

class QuietObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] { return []; }
}

class StyleObserver {
  static last: StyleObserver | null = null;
  private readonly notify: () => void;
  constructor(notify: () => void) {
    this.notify = notify;
    StyleObserver.last = this;
  }
  observe(): void {}
  disconnect(): void {}
  takeRecords(): [] { return []; }
  fire(): void { this.notify(); }
}

class ViewObserver {
  static last: ViewObserver | null = null;
  readonly targets: unknown[] = [];
  private readonly notify: (entries: Array<{ isIntersecting: boolean; target: unknown }>) => void;
  constructor(notify: (entries: Array<{ isIntersecting: boolean; target: unknown }>) => void) {
    this.notify = notify;
    ViewObserver.last = this;
  }
  observe(target: unknown): void { this.targets.push(target); }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] { return []; }
  fire(target: unknown): void {
    this.notify([{ isIntersecting: true, target }]);
  }
}

function Probe({ windowed = true }: { windowed?: boolean }) {
  const held = useHeldRow({ window: windowed });
  if (held) return held;
  return React.createElement(Text, null, "body");
}

async function renderProbe(node: FakeNode, windowed = true): Promise<TestRenderer.ReactTestRenderer> {
  (globalThis as { __heldNode?: unknown }).__heldNode = node;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe, { windowed }));
  });
  return renderer;
}

async function unmountProbe(renderer: TestRenderer.ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.unmount();
  });
}

function openedScroller(display = ""): FakeNode {
  return element({
    id: "agent-chat-scroll-web-dom-scroll",
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 400,
    style: { display },
    getBoundingClientRect: () => ({ top: 0, bottom: 400, left: 0, width: 400, height: 400 }),
  });
}

function rowIn(scroller: FakeNode, contentTop: number): FakeNode {
  return element({
    parentElement: scroller,
    closest: (selector) => selector.includes("agent-chat-scroll") ? scroller : null,
    getBoundingClientRect: () => {
      const top = contentTop - scroller.scrollTop;
      return { top, bottom: top + 26, left: 0, width: 80, height: 26 };
    },
  });
}

afterEach(() => {
  delete (globalThis as { __heldNode?: unknown }).__heldNode;
  StyleObserver.last = null;
  ViewObserver.last = null;
  vi.unstubAllGlobals();
});

describe("hidden timeline rows", () => {
  it("finds the nearest display:none ancestor", () => {
    const route = element({ style: { display: "none" } });
    const tab = element({ style: { display: "none" }, parentElement: route });
    const row = element({ parentElement: tab });
    expect(hiddenAncestor(asElement(row))).toBe(tab);
    expect(isHiddenNode(asElement(row))).toBe(true);
    tab.style.display = "";
    expect(hiddenAncestor(asElement(row))).toBe(route);
  });

  it("treats a zero-size row as outside the window", () => {
    expect(intersectsWindow({ top: 0, bottom: 0, width: 0, height: 0 }, { top: 0, bottom: 400 }, 400)).toBe(false);
    expect(intersectsWindow({ top: 10, bottom: 36, width: 80, height: 26 }, { top: 0, bottom: 400 }, 400)).toBe(true);
    expect(intersectsWindow({ top: -1500, bottom: -1474, width: 80, height: 26 }, { top: 0, bottom: 400 }, 400)).toBe(false);
  });

  it("follows the bottom until the reader scrolls away", () => {
    const scroller = element({ scrollTop: 0, scrollHeight: 1000, clientHeight: 100 });
    const pinned = new Map<HTMLElement, number>();
    const node = asElement(scroller);
    followScrollerBottom(node, pinned);
    expect(scroller.scrollTop).toBe(900);
    scroller.scrollHeight = 1200;
    followScrollerBottom(node, pinned);
    expect(scroller.scrollTop).toBe(1100);
    scroller.scrollTop = 200;
    followScrollerBottom(node, pinned);
    expect(scroller.scrollTop).toBe(200);
  });

  it("does not mount a row inside a hidden tab", async () => {
    vi.stubGlobal("MutationObserver", QuietObserver);
    const panel = element({ style: { display: "none" } });
    const row = element({ parentElement: panel, clientHeight: 26, scrollHeight: 26 });
    const renderer = await renderProbe(row);
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    await unmountProbe(renderer);
    vi.unstubAllGlobals();
  });

  it("mounts a row that sits in the opened chat's window", async () => {
    const scroller = element({
      id: "agent-chat-scroll-web-dom-scroll",
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 400,
      getBoundingClientRect: () => ({ top: 0, bottom: 400, left: 0, width: 400, height: 400 }),
    });
    const row = element({
      parentElement: scroller,
      scrollHeight: 26,
      clientHeight: 26,
      closest: (selector) => selector.includes("agent-chat-scroll") ? scroller : null,
      getBoundingClientRect: () => {
        const top = 1700 - scroller.scrollTop;
        return { top, bottom: top + 26, left: 0, width: 80, height: 26 };
      },
    });
    const renderer = await renderProbe(row);
    expect(scroller.scrollTop).toBe(1600);
    expect(renderer.root.findByType(Text).props.children).toBe("body");
    await unmountProbe(renderer);
  });

  it("leaves a row above the opened window as a placeholder", async () => {
    vi.stubGlobal("IntersectionObserver", QuietObserver);
    const scroller = element({
      id: "agent-chat-scroll-web-dom-scroll",
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 400,
      getBoundingClientRect: () => ({ top: 0, bottom: 400, left: 0, width: 400, height: 400 }),
    });
    const row = element({
      parentElement: scroller,
      closest: (selector) => selector.includes("agent-chat-scroll") ? scroller : null,
      getBoundingClientRect: () => {
        const top = 0 - scroller.scrollTop;
        return { top, bottom: top + 26, left: 0, width: 80, height: 26 };
      },
    });
    const renderer = await renderProbe(row);
    expect(scroller.scrollTop).toBe(1600);
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    const placeholder = renderer.root.findByType("View" as unknown as React.ElementType);
    expect(placeholder.props.style).toEqual({ height: 26 });
    await unmountProbe(renderer);
  });

  it("mounts a hidden row once its own tab is shown", async () => {
    vi.stubGlobal("MutationObserver", StyleObserver);
    const scroller = openedScroller("none");
    const renderer = await renderProbe(rowIn(scroller, 1700));
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    expect(scroller.scrollTop).toBe(0);
    scroller.style.display = "";
    await act(async () => {
      StyleObserver.last?.fire();
    });
    expect(scroller.scrollTop).toBe(1600);
    expect(renderer.root.findByType(Text).props.children).toBe("body");
    await unmountProbe(renderer);
  });

  it("stays held until every hidden ancestor is shown", async () => {
    vi.stubGlobal("MutationObserver", StyleObserver);
    const route = element({ style: { display: "none" } });
    const tab = element({ style: { display: "none" }, parentElement: route });
    const scroller = openedScroller();
    scroller.parentElement = tab;
    const renderer = await renderProbe(rowIn(scroller, 1700));
    await act(async () => {
      StyleObserver.last?.fire();
    });
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    tab.style.display = "";
    await act(async () => {
      StyleObserver.last?.fire();
    });
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    route.style.display = "";
    await act(async () => {
      StyleObserver.last?.fire();
    });
    expect(renderer.root.findByType(Text).props.children).toBe("body");
    await unmountProbe(renderer);
  });

  it("mounts a placeholder once it crosses into the window", async () => {
    vi.stubGlobal("IntersectionObserver", ViewObserver);
    const scroller = openedScroller();
    const row = rowIn(scroller, 0);
    const renderer = await renderProbe(row);
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    await act(async () => {
      ViewObserver.last?.fire(row);
    });
    expect(renderer.root.findByType(Text).props.children).toBe("body");
    await unmountProbe(renderer);
  });

  it("mounts a reply even when it sits above the opened window", async () => {
    const scroller = openedScroller();
    const renderer = await renderProbe(rowIn(scroller, 0), false);
    expect(scroller.scrollTop).toBe(1600);
    expect(renderer.root.findByType(Text).props.children).toBe("body");
    await unmountProbe(renderer);
  });

  it("draws a hidden row when a tab cannot be watched", async () => {
    vi.stubGlobal("MutationObserver", undefined);
    const panel = element({ style: { display: "none" } });
    const row = element({ parentElement: panel });
    const renderer = await renderProbe(row);
    expect(renderer.root.findByType(Text).props.children).toBe("body");
    await unmountProbe(renderer);
  });
});
