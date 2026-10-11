/**
 * Characterisation of the current hand-written engine. These pin today's
 * behaviour, flaws included, as the old-engine baseline for the S2 comparison.
 */
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../client/components/markdown/parse";

const kinds = (text: string) => parseMarkdown(text).map((block) => block.kind);

describe("parseMarkdown (current engine)", () => {
  it("parses headings, inline emphasis and code spans", () => {
    const blocks = parseMarkdown("# Title\n\nsome **bold** and `code`");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph"]);
    const paragraph = blocks[1];
    expect(paragraph?.kind === "paragraph" && paragraph.spans.map((s) => s.kind)).toEqual([
      "text",
      "strong",
      "text",
      "codeSpan",
    ]);
  });

  it("reads a closed fence as a code block with its language", () => {
    const blocks = parseMarkdown("before\n\n```ts\nconst a = 1;\n```\nafter");
    expect(blocks[1]).toEqual({ kind: "code", code: "const a = 1;", language: "ts" });
    expect(kinds("before\n\n```ts\nconst a = 1;\n```\nafter")).toEqual([
      "paragraph",
      "code",
      "paragraph",
    ]);
  });

  it("degrades an unclosed fence to plain text, then flips to code once closed", () => {
    // The format flip the plan's BC-05 targets: same block index, new kind.
    expect(kinds("```ts\nconst a = 1;\n")).toEqual(["plain"]);
    expect(kinds("```ts\nconst a = 1;\n```")).toEqual(["code"]);
  });

  it("splits unordered and ordered lists and parses a pipe table", () => {
    expect(kinds("- a\n- b\n\n1. x")).toEqual(["list", "list"]);
    const table = parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")[0];
    expect(table?.kind).toBe("table");
    expect(table?.kind === "table" && table.rows.length).toBe(1);
  });
});
