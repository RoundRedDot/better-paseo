import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Android paints a selectable `Text`'s range in its `selectionColor`, and with none in the
// host app's highlight. Selected text is one fill across the plugin (`textSelection`), so every
// outermost selectable `Text` spreads `selectionColorProps()` (`client/components/text-selection.ts`).
// A run nested in another text is drawn by its parent and needs nothing.

const ROOT = join(__dirname, "../..");
const TEXTISH = new Set(["Text", "ProseSpan", "ProseText", "SelectableText", "SelectableSpan"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "debug" ? [] : sources(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

function uncoloured(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node, inText: boolean) => {
    const tag = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    let inside = inText;
    if (tag) {
      const name = tag.tagName.getText(source);
      if (name === "Text" && !inText) {
        const props = tag.attributes.properties;
        const selectable = props.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === "selectable");
        const off = selectable && ts.isJsxAttribute(selectable) && selectable.initializer?.getText(source) === "{false}";
        const coloured = props.some((prop) => (ts.isJsxAttribute(prop) && prop.name.getText(source) === "selectionColor")
          || (ts.isJsxSpreadAttribute(prop) && prop.expression.getText(source).startsWith("selectionColorProps(")));
        if (selectable && !off && !coloured) {
          const { line } = source.getLineAndCharacterOfPosition(tag.getStart(source));
          found.push(`${file}:${line + 1}: ${(text.split("\n")[line] ?? "").trim().slice(0, 160)}`);
        }
      }
      if (TEXTISH.has(name)) inside = true;
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(source, false);
  return found;
}

describe("selectable text colour", () => {
  it("flags an outermost selectable Text without the selection colour, and not a nested run", () => {
    expect(uncoloured("a.tsx", "const a = <Text selectable style={s}>x<Text selectable>y</Text></Text>;")).toHaveLength(1);
    expect(uncoloured("a.tsx", "const a = <Text selectable {...selectionColorProps()}>x</Text>;")).toEqual([]);
    expect(uncoloured("a.tsx", "const a = <Text selectable={false}>x</Text>;")).toEqual([]);
    expect(uncoloured("a.tsx", "const a = <ProseText><Text selectable>x</Text></ProseText>;")).toEqual([]);
  });

  it("gives every outermost selectable Text in client/ the selection colour", () => {
    const found = sources(join(ROOT, "client")).flatMap((path) => uncoloured(relative(ROOT, path), readFileSync(path, "utf8")));
    expect(found).toEqual([]);
  });
});
