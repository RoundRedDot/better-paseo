import { afterEach, describe, expect, it, vi } from "vitest";

const os = vi.hoisted(() => ({ OS: "web" }));
vi.mock("react-native", () => ({ Platform: os }));
const { applyTextSelection, ensureTextSelectionStyle, selectionColorProps, textSelectionRule } = await import("../../client/components/text-selection");

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

afterEach(() => { delete (globalThis as { document?: unknown }).document; os.OS = "web"; });

describe("web text selection style", () => {
  it("paints selections inside plugin roots and surfaces and follows the theme with one element", () => {
    const doc = fakeDocument();
    (globalThis as { document?: unknown }).document = doc;
    ensureTextSelectionStyle("rgba(28, 118, 242, 0.2)");
    ensureTextSelectionStyle("rgba(28, 118, 242, 0.2)");
    expect(doc.styles).toHaveLength(1);
    expect(doc.styles[0]!.textContent).toBe("[data-bcroot] ::selection, [data-bcselection] ::selection { background-color: rgba(28, 118, 242, 0.2); }");
    applyTextSelection("rgba(28, 118, 242, 0.3)", true);
    expect(doc.styles).toHaveLength(1);
    expect(doc.styles[0]!.textContent).toBe(textSelectionRule("rgba(28, 118, 242, 0.3)"));
  });
  it("does nothing without a document", () => {
    expect(() => ensureTextSelectionStyle("red")).not.toThrow();
  });
});

describe("selection colour props", () => {
  it("gives Android the theme's last fill, and nothing elsewhere", () => {
    applyTextSelection("rgba(28, 118, 242, 0.2)", false);
    os.OS = "android";
    expect(selectionColorProps()).toEqual({ selectionColor: "rgba(28, 118, 242, 0.2)" });
    os.OS = "ios";
    expect(selectionColorProps()).toEqual({});
  });
});
