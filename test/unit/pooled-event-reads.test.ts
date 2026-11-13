import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// React Native 0.86's Fabric renderer still pools synthetic events: once the handler returns,
// the event's `nativeEvent` is set to null (`ReactFabric-prod.js`, `destructor`). A read that
// leaves the handler, such as a state updater, a timer or a frame callback, then throws
// "Cannot read property 'layout' of null". An updater runs during render when the component
// already has a pending update, so the throw reaches the host's boundary and the whole Tasks
// screen shows "Plugin failed". It only happens on device: web events and test renderers keep
// their payload. Read what the handler needs while it runs, and keep only those values.

const ROOT = join(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

type Fn = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration;
const isFn = (node: ts.Node): node is Fn =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);
const declares = (fn: Fn, name: string) => fn.parameters.some((param) => ts.isIdentifier(param.name) && param.name.text === name);

/** `file:line: code` for each event reference made from a function nested in the handler that received it. */
function lateEventReads(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const report = (node: ts.Node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${file}:${line + 1}: ${(text.split("\n")[line] ?? "").trim().slice(0, 160)}`);
  };
  const visit = (node: ts.Node) => {
    if (isFn(node) && node.body) {
      for (const param of node.parameters) {
        if (!ts.isIdentifier(param.name)) continue;
        const name = param.name.text;
        // Only parameters the handler reads as an event.
        let event = false;
        const probe = (child: ts.Node) => {
          if (ts.isPropertyAccessExpression(child) && child.name.text === "nativeEvent" && ts.isIdentifier(child.expression) && child.expression.text === name) event = true;
          if (!event) ts.forEachChild(child, probe);
        };
        probe(node.body);
        if (!event) continue;
        const scan = (child: ts.Node, nested: boolean) => {
          if (isFn(child)) {
            if (declares(child, name)) return;
            nested = true;
          }
          if (nested && ts.isIdentifier(child) && child.text === name && !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child)) report(child);
          ts.forEachChild(child, (next) => scan(next, nested));
        };
        ts.forEachChild(node.body, (child) => scan(child, false));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("pooled event reads", () => {
  it("finds an event read from a state updater, a timer and a forwarded call", () => {
    const code = [
      "const a = (event) => setWidth((old) => old === event.nativeEvent.layout.width ? old : event.nativeEvent.layout.width);",
      "const b = (e) => { setTimeout(() => measure(e)); return e.nativeEvent.layout; };",
      "const c = (event) => { const { width } = event.nativeEvent.layout; setWidth((old) => old === width ? old : width); };",
      "const d = (event) => list.forEach((event) => event.nativeEvent);",
    ].join("\n");
    expect(lateEventReads("fixture.tsx", code).map((line) => line.split(":")[1])).toEqual(["1", "1", "2"]);
  });

  it("keeps every client event read inside its handler", () => {
    const found = sources(join(ROOT, "client")).flatMap((path) => lateEventReads(relative(ROOT, path), readFileSync(path, "utf8")));
    expect(found).toEqual([]);
  });
});
