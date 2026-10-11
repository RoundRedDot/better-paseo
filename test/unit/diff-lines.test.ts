import { describe, expect, it } from "vitest";
import { diffLineNumbers } from "../../client/components/diff-lines";

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
