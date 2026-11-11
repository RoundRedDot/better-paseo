import { readdirSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Paseo installs the plugin with `npm ci --omit=dev` (paseo-plugin.json) and then compiles
// `index.server.ts`. Its compiler (`compiler-build.ts`, v0.14.0) resolves every import of
// every module it reaches, type-only imports included, and fails the install with "Could not
// resolve type dependency" when a package is missing. It skips only the plugin SDK
// specifiers, `zod`, Node built-ins and type-only `@getpaseo/protocol/*` imports, which the
// host supplies. So every other package a server or shared module names, even for types,
// must be a production dependency. `@getpaseo/client` is a dev dependency: its types reach
// the server through `server/paseo-types.ts`.

const ROOT = join(__dirname, "../..");
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
const DEPENDENCIES = new Set(Object.keys(manifest.dependencies ?? {}));
/** `PLUGIN_SDK_SPECIFIERS` minus the client-only entries, which the server may not import at all. */
const HOST_SDK = new Set(["@getpaseo/plugin", "@getpaseo/plugin/server", "@getpaseo/plugin/server/provider", "@getpaseo/plugin/server/usage", "@getpaseo/plugin/server/acp"]);

function sources(path: string): string[] {
  if (!statSync(path).isDirectory()) return /\.[cm]?[jt]sx?$/.test(path) && !path.endsWith(".d.ts") ? [path] : [];
  return readdirSync(path).flatMap((name) => sources(join(path, name)));
}

const packageName = (specifier: string) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

function allowed(specifier: string, typeOnly: boolean): boolean {
  if (specifier.startsWith(".") || isBuiltin(specifier) || HOST_SDK.has(specifier) || /^zod(\/|$)/.test(specifier)) return true;
  if (typeOnly && specifier.startsWith("@getpaseo/protocol/")) return true;
  return DEPENDENCIES.has(packageName(specifier));
}

/** `file:line: specifier` for each import the installed plugin could not resolve. */
function unresolvable(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const check = (node: ts.Node | undefined, typeOnly: boolean) => {
    if (!node || !ts.isStringLiteralLike(node) || allowed(node.text, typeOnly)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${relative(ROOT, file)}:${line + 1}: ${node.text}`);
  };
  const typeBindings = (bindings: ts.NamedImportBindings | ts.NamedExportBindings | undefined) =>
    !!bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      check(node.moduleSpecifier, !!clause?.isTypeOnly || (!clause?.name && typeBindings(clause?.namedBindings)));
    } else if (ts.isExportDeclaration(node)) check(node.moduleSpecifier, node.isTypeOnly || typeBindings(node.exportClause));
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) check(node.argument.literal, true);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) check(node.moduleReference.expression, node.isTypeOnly);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) check(node.arguments[0], false);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("server install imports", () => {
  it("names only packages a production install provides", () => {
    const files = ["index.server.ts", "server", "shared"].flatMap((path) => sources(join(ROOT, path)));
    expect(files.length).toBeGreaterThan(20);
    expect(files.flatMap(unresolvable)).toEqual([]);
  });

  it("flags a type-only import of a dev dependency", () => {
    expect(allowed("@getpaseo/client", true)).toBe(false);
    expect(allowed("@getpaseo/plugin/server", true)).toBe(true);
    expect(allowed("@getpaseo/protocol/agent-types", true)).toBe(true);
    expect(allowed("@getpaseo/protocol/agent-types", false)).toBe(false);
  });
});
