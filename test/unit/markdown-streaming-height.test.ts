/**
 * Defects D4 and D5 of the V1 report, as properties of the streamed tail.
 *
 * D4: a code block must never lose a line while it streams. The closing fence
 * arrives a character at a time, and an unheld "``" was drawn as a code line,
 * then dropped when the fence closed (18 px per block).
 *
 * D5: a block must never change kind, even when the host's frame-paced reveal
 * jumps several characters at once. Jumps skip intermediate states, so the
 * check remembers each block's last visible kind across held-back (empty)
 * states instead of comparing neighbours only.
 */
import { describe, expect, it } from "vitest";
import { repairTail } from "../../client/components/markdown/repair";

describe("streamed tail", () => {
  it("holds the start of a closing fence, and only that", () => {
    expect(repairTail("```ts\nconst a = 1;\n``")).toBe("```ts\nconst a = 1;\n");
    expect(repairTail("````md\n```\n``")).toBe("````md\n```\n");
    expect(repairTail("~~~\nx\n~~")).toBe("~~~\nx\n");
    // A backtick run inside a tilde fence is code, not a closer.
    expect(repairTail("~~~\nx\n``")).toBe("~~~\nx\n``");
  });

  it("holds a line of digits until it is a number or an item (D5)", () => {
    expect(repairTail("Steps:\n\n1")).toBe("Steps:\n\n");
    expect(repairTail("1. one\n2")).toBe("1. one\n");
    expect(repairTail("```\n1")).toBe("```\n1");
  });

});
