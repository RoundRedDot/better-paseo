import { describe, expect, it } from "vitest";
import { textChunks, DIFF_TEXT_CHUNK_LINES, TEXT_CHUNK_CHARS, TEXT_CHUNK_LINES } from "../../client/ui/text-chunks";

describe("native text chunks", () => {
  it("uses smaller diff chunks without losing row offsets or empty lines", () => {
    const lines = Array.from({ length: 100 }, (_, index) => index % 16 ? `+line-${index}` : "");
    const chunks = textChunks(lines, DIFF_TEXT_CHUNK_LINES);
    expect(chunks.every((chunk) => chunk.lines.length <= DIFF_TEXT_CHUNK_LINES)).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.lines)).toEqual(lines);
    expect(chunks.map((chunk) => chunk.from)).toEqual([0, 16, 32, 48, 64, 80, 96]);
  });
  it.each([1_000, 5_000, 20_000])("bounds text and row counts for %i lines without changing content", (count) => {
    const lines = Array.from({ length: count }, (_, index) => `${index}: ${"word ".repeat(index % 40)}`);
    const chunks = textChunks(lines);
    expect(chunks.every((chunk) => chunk.lines.length <= TEXT_CHUNK_LINES && chunk.text.length <= TEXT_CHUNK_CHARS)).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.lines)).toEqual(lines);
  });

  it("keeps empty lines and indentation, including chunk boundaries", () => {
    const lines = Array.from({ length: 200 }, (_, index) => index % 2 ? "  " : "");
    expect(textChunks(lines).flatMap((chunk) => chunk.lines)).toEqual(lines);
  });

  it("splits minified lines without inserting or dropping characters or splitting surrogate pairs", () => {
    const long = `${"x".repeat(TEXT_CHUNK_CHARS - 1)}\uD83D\uDE00${"yz".repeat(20_000)}`;
    const chunks = textChunks(["before", long, "", "  after"]);
    const parts = chunks.filter((chunk) => chunk.from === 1);
    expect(parts.map((chunk) => chunk.text).join("")).toBe(long);
    expect(parts.map((chunk) => chunk.offset)).toEqual(parts.map((_, index) => parts.slice(0, index).reduce((offset, chunk) => offset + chunk.text.length, 0)));
    expect(chunks.every((chunk) => chunk.text.length <= TEXT_CHUNK_CHARS)).toBe(true);
    expect(parts[0]!.text).toHaveLength(TEXT_CHUNK_CHARS - 1);
    expect(parts[1]!.text.startsWith("\uD83D\uDE00")).toBe(true);
    expect(chunks.at(-1)!.lines).toEqual(["", "  after"]);
  });
});
