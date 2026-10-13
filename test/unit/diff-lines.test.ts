import { describe, expect, it } from "vitest";
import { diffLineNumbers, lineDiff } from "../../client/components/diff-lines";

describe("diffLineNumbers", () => {
  it("numbers removed rows from the old file and the rest from the new file", () => {
    const lines = [
      "@@ -148,7 +148,9 @@ function UserBubble",
      " const text = useMessageText(item);",
      "-const meta = formatUsage(item.usage);",
      "-return <Bubble />;",
      "+const time = formatClock(item.createdAt);",
      "+return (",
      "+  <Bubble />",
      " }",
    ];
    expect(diffLineNumbers(lines)).toEqual([null, 148, 149, 150, 149, 150, 151, 152]);
  });

  it("restarts at every hunk and skips file chrome", () => {
    const lines = ["--- a/x.ts", "+++ b/x.ts", "@@ -1 +1 @@", "-a", "+b", "@@ -10,2 +10,2 @@", " c", "\\ No newline at end of file"];
    expect(diffLineNumbers(lines)).toEqual([null, null, null, 1, 1, null, 10, null]);
  });

  it("falls back to row positions for a list with no hunk header", () => {
    expect(diffLineNumbers(["+a", "-b", " c"])).toEqual([1, 2, 3]);
  });
});

describe("lineDiff", () => {
  it("marks each line of the old and new text as kept, removed or added", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\n")).toBe(" a\n-b\n+B\n c");
    expect(lineDiff("x\r\ny", "x\ny\nz")).toBe(" x\n y\n+z");
  });

  it("adds every line of text that replaced nothing, and removes every line of text that was dropped", () => {
    expect(lineDiff("", "one\ntwo\n")).toBe("+one\n+two");
    expect(lineDiff("gone", "")).toBe("-gone");
    expect(lineDiff("", "")).toBe("");
  });

  it("writes no hunk header, so no row claims a file line", () => {
    expect(lineDiff("a", "b").split("\n").some((line) => line.startsWith("@@"))).toBe(false);
  });

  it("removes then adds the changed middle of texts too long to align line by line", () => {
    const old = Array.from({ length: 3000 }, (_, index) => `old ${index}`);
    const next = Array.from({ length: 3000 }, (_, index) => `new ${index}`);
    const lines = lineDiff(["head", ...old, "tail"].join("\n"), ["head", ...next, "tail"].join("\n")).split("\n");
    expect(lines).toHaveLength(6002);
    expect(lines.slice(0, 2)).toEqual([" head", "-old 0"]);
    expect(lines.slice(3000, 3002)).toEqual(["-old 2999", "+new 0"]);
    expect(lines[6001]).toBe(" tail");
  });
});
