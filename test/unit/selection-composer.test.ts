import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ copyText: vi.fn() }));

// The DOM is a system boundary: a tree of elements, each composer a textarea
// that is on screen unless its tab or pane is hidden.
class FakeElement {
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  constructor(public marked = false, public shown = true) {}
  add(...children: FakeElement[]) {
    for (const child of children) { child.parentElement = this; this.children.push(child); }
    return this;
  }
  querySelectorAll(): FakeElement[] {
    return this.children.flatMap((child) => [...(child.marked ? [child] : []), ...child.querySelectorAll()]);
  }
  querySelector(): null { return null; }
  getClientRects() {
    for (let node: FakeElement | null = this; node; node = node.parentElement) if (!node.shown) return [];
    return [{}];
  }
}
class FakeTextArea extends FakeElement {}
Object.assign(globalThis, { HTMLTextAreaElement: FakeTextArea, HTMLInputElement: class {} });
const { nearestComposer } = await import("../../client/components/selection-actions");

describe("Add to chat target", () => {
  it("takes the composer of the selection's own chat, not a hidden tab's that comes first", () => {
    const hiddenTab = new FakeElement(false, false);
    const hiddenComposer = new FakeTextArea(true);
    hiddenTab.add(new FakeElement().add(hiddenComposer));
    const timeline = new FakeElement();
    const selection = new FakeElement();
    timeline.add(new FakeElement().add(selection));
    const ownComposer = new FakeTextArea(true);
    const shownTab = new FakeElement().add(timeline, ownComposer);
    const otherPane = new FakeElement().add(new FakeTextArea(true));
    new FakeElement().add(hiddenTab, shownTab, otherPane);

    expect(nearestComposer(selection as unknown as Element)).toBe(ownComposer);
  });

  it("finds nothing when every composer is hidden", () => {
    const selection = new FakeElement();
    new FakeElement().add(selection, new FakeElement(false, false).add(new FakeTextArea(true)));
    expect(nearestComposer(selection as unknown as Element)).toBeNull();
    expect(nearestComposer(null)).toBeNull();
  });
});
