import { describe, expect, it, vi } from "vitest";
import { blockKind, lexBlock, lexCacheSize } from "../../client/components/markdown/lex";
import {
  codeLanguage,
  decodeEntities,
  fenceClosed,
  isPathLike,
  softBreaks,
} from "../../client/components/markdown/render/text";

describe("isPathLike", () => {
  it("accepts paths and file names", () => {
    for (const path of [
      "client/components/markdown/blocks.ts",
      "client/components/markdown/blocks.ts:42",
      "./scripts/check.mjs",
      "~/notes/todo.md",
      "/Users/me/project",
      "package.json",
      "index.ts:12:3",
      "node_modules/",
    ]) {
      expect(isPathLike(path), path).toBe(true);
    }
  });

  it("rejects code, commands, URLs and member access", () => {
    for (const text of [
      "npm test",
      "item.data",
      "console.log",
      "React.memo",
      "1.2.3",
      "https://a.b/c",
      "a/b",
      "//",
      "x",
      "fn(a/b)",
    ]) {
      expect(isPathLike(text), text).toBe(false);
    }
  });
});

describe("text helpers", () => {
  it("decodes the references an assistant writes, and leaves others alone", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#39;d&#x27; &copy;")).toBe("a & b <c> 'd' &copy;");
  });

  it("turns soft breaks into spaces", () => {
    expect(softBreaks("one\n  two\nthree")).toBe("one two three");
  });

  it("reads the language from the info string", () => {
    expect(codeLanguage('ts title="a.ts"')).toBe("ts");
    expect(codeLanguage(undefined)).toBe("");
  });

  it("tells an open fence from a closed one", () => {
    expect(fenceClosed("```ts\nconst a = 1;\n")).toBe(false);
    expect(fenceClosed("```ts\nconst a = 1;\n``")).toBe(false);
    expect(fenceClosed("```ts\nconst a = 1;\n```")).toBe(true);
    expect(fenceClosed("````\n```\n````\n\n")).toBe(true);
    expect(fenceClosed("~~~\nx\n```")).toBe(false);
    expect(fenceClosed("```")).toBe(false);
    expect(fenceClosed("    indented code")).toBe(true);
  });
});

describe("lexBlock", () => {
  it("lexes math as one block, open or closed", () => {
    expect(blockKind(lexBlock("$$\nE = mc^2\n$$\n"))).toBe("math");
    expect(blockKind(lexBlock("$$\nE = mc^"))).toBe("math");
    expect(lexBlock("$$\na\n$$")[0]).toMatchObject({ type: "math", text: "a", closed: true });
  });

  it("returns the cached tree for the same source and stays bounded", () => {
    const first = lexBlock("cache **me**");
    expect(lexBlock("cache **me**")).toBe(first);
    for (let index = 0; index < 600; index++) lexBlock(`block ${index}`);
    expect(lexCacheSize()).toBe(500);
  });

  it("keeps a streaming tail out of the LRU but reuses it while it is unchanged", async () => {
    // A fresh module: the LRU above is already full.
    vi.resetModules();
    const lex = await import("../../client/components/markdown/lex");
    const tail = lex.lexBlock("tail **gro", true);
    expect(lex.lexBlock("tail **gro", true)).toBe(tail);
    for (let index = 0; index < 50; index++) lex.lexBlock(`tail ${"x".repeat(index)}`, true);
    expect(lex.lexCacheSize()).toBe(0);
    lex.lexBlock("tail **grown**");
    expect(lex.lexCacheSize()).toBe(1);
  });

  it("serves a streaming tail from the LRU when a finished block has its source", () => {
    const finished = lexBlock("done **block**");
    expect(lexBlock("done **block**", true)).toBe(finished);
  });
});
