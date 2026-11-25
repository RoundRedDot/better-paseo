import { afterEach, describe, expect, it } from "vitest";
import { ensureTextSelectionStyle, textSelectionRule } from "../../client/components/text-selection-style";

class FakeStyle { id = ""; textContent = ""; }
function fakeDocument() {
  const head: FakeStyle[] = [];
  return {
    head: { appendChild: (node: FakeStyle) => { head.push(node); } },
    createElement: () => new FakeStyle(),
    getElementById: (id: string) => head.find((node) => node.id === id) ?? null,
    styles: head,
  };
}

afterEach(() => { delete (globalThis as { document?: unknown }).document; });

describe("web text selection style", () => {
  it("paints selections inside plugin surfaces and follows the theme with one element", () => {
    const doc = fakeDocument();
    (globalThis as { document?: unknown }).document = doc;
    ensureTextSelectionStyle("rgba(28, 118, 242, 0.3)");
    ensureTextSelectionStyle("rgba(28, 118, 242, 0.3)");
    expect(doc.styles).toHaveLength(1);
    expect(doc.styles[0]!.textContent).toBe("[data-bcselection] ::selection { background-color: rgba(28, 118, 242, 0.3); }");
    ensureTextSelectionStyle("rgba(28, 118, 242, 0.4)");
    expect(doc.styles).toHaveLength(1);
    expect(doc.styles[0]!.textContent).toBe(textSelectionRule("rgba(28, 118, 242, 0.4)"));
  });
  it("does nothing without a document", () => {
    expect(() => ensureTextSelectionStyle("red")).not.toThrow();
  });
});
