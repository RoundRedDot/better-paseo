import { describe, expect, it } from "vitest";
import { diffHunk, diffLineNumbers, diffRows, lineDiff, splitDiffOutput } from "../../client/components/diff-lines";

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


describe("combined diff rows", () => {
  it("uses the result's line for additions and each deleted parent's line for removals", () => {
    const lines = ["diff --cc a.ts", "index 123,456..789", "--- a/a.ts", "+++ b/a.ts",
      "@@@ -10,3 -20,3 +30,3 @@@", "  keep", "- old first", " -old second", "++new", " +from first", "--old both"];
    const rows = diffRows(lines);
    expect(rows.map((row) => row.number)).toEqual([null, null, null, null, null, 30, 11, 21, 31, 32, 13]);
    expect(rows.slice(5).map((row) => row.kind)).toEqual([null, "remove", "remove", "add", "add", "remove"]);
    expect(rows.slice(5).map((row) => row.markers)).toEqual(["  ", "- ", " -", "++", " +", "--"]);
  });

  it("keeps source lines resembling file headers as body rows", () => {
    expect(diffRows(["@@ -1 +1 @@", "--- old", "+++ new"]).map((row) => [row.number, row.kind]))
      .toEqual([[null, null], [1, "remove"], [1, "add"]]);
  });

  it("resets metadata and numbering between files", () => {
    expect(diffLineNumbers(["@@ -10 +10 @@", "-old", "+new", "diff --git a/b b/b", "index 1..2", "--- a/b", "+++ b/b", "@@ -2 +2 @@", " ok"]))
      .toEqual([null, 10, 10, null, null, null, null, null, 2]);
  });

  it("accepts CRLF hunk headers without losing file line numbers", () => {
    expect(diffLineNumbers(["@@ -10 +20 @@\r", "-old\r", "+new\r"]))
      .toEqual([null, 10, 20]);
  });

  it("requires the header's marker count to match the number of parents", () => {
    expect(diffHunk("@@@ -1,2 -3,4 +5,6 @@@ heading")).toEqual({ starts: [1, 3, 5], counts: [2, 4, 6] });
    expect(diffHunk("@@@ -1 +2 @@@")).toBeNull();
  });
});

describe("splitDiffOutput", () => {
  const patch = "diff --git a/x.ts b/x.ts\nindex 1..2 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -4,2 +4,2 @@\n-old\n+new\n keep";
  it("separates a patch from surrounding logs and whitespace-prefixed stat output", () => {
    const text = `Starting\n${patch}\n  42 x.ts\n x.ts | 2 +-\n{\n  \"name\": \"example\"\n}`;
    expect(splitDiffOutput(text)).toEqual([
      { text: "Starting", diff: false }, { text: patch, diff: true, filename: "x.ts" },
      { text: '  42 x.ts\n x.ts | 2 +-\n{\n  "name": "example"\n}', diff: false },
    ]);
  });

  it("separates combined diffs and ordinary output after the hunk ends", () => {
    const patch = "diff --cc x.md\nindex 1,2..3\n--- a/x.md\n+++ b/x.md\n@@@ -1,2 -1,2 +1,2 @@@\n  keep\n--old\n++new";
    expect(splitDiffOutput(`${patch}\n  99 reference.md`)).toEqual([
      { text: patch, diff: true, filename: "x.md" }, { text: "  99 reference.md", diff: false },
    ]);
  });

  it("splits multiple files, retains metadata-only changes, and leaves stat-only output alone", () => {
    const mode = "diff --git a/run b/run\nold mode 100644\nnew mode 100755";
    expect(splitDiffOutput(`${patch}\n${mode}`)).toEqual([
      { text: patch, diff: true, filename: "x.ts" }, { text: mode, diff: true },
    ]);
    expect(splitDiffOutput(" x.ts | 2 +-\n 1 file changed")).toEqual([{ text: " x.ts | 2 +-\n 1 file changed", diff: false }]);
  });

  it("does not mistake header-shaped source content for new metadata", () => {
    const patch = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n--- old\n+++ new";
    expect(splitDiffOutput(patch)).toEqual([{ text: patch, diff: true, filename: "x.ts" }]);
  });

  it("retains an incomplete streaming hunk and no-newline markers", () => {
    const patch = "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+ne";
    expect(splitDiffOutput(patch)).toEqual([{ text: patch, diff: true }]);
  });
});
