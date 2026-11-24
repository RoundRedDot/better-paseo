import { describe, expect, it } from "vitest";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { transformToolCallAt } from "../../client/tools/transform";
import { foldedWorkVerb, standardFoldActive } from "../../client/tools/standard-fold";
import { DEFAULT_PREFERENCES, type EnhancerPreferences } from "../../client/preferences";

function call(name: string, detail: ToolCallTimelineItem["detail"], status: ToolCallTimelineItem["status"] = "completed"): ToolCallTimelineItem {
  return { type: "tool_call", name, callId: `${name}-${status}`, status, error: status === "failed" ? "boom" : null, detail } as ToolCallTimelineItem;
}

const FOLDING: EnhancerPreferences = { ...DEFAULT_PREFERENCES, timelineLevel: "standard", assistantMarkdown: true, enhancedUserBubble: true };
const rows = (item: ToolCallTimelineItem, preferences: EnhancerPreferences) =>
  transformToolCallAt({ item, phase: "complete" }, preferences)?.items.length ?? -1;

const edit = call("Edit", { type: "edit", filePath: "a.ts", unifiedDiff: "@@\n-a\n+b" });
const write = call("Write", { type: "write", filePath: "b.ts", content: "x\n" });

describe("standard work card fold", () => {
  it("drops successful edit and write rows while the plugin draws assistant replies", () => {
    expect(rows(edit, FOLDING)).toBe(0);
    expect(rows(write, FOLDING)).toBe(0);
  });

  it("draws no row for an edit or write still running: it would vanish into the card once it succeeds", () => {
    expect(rows(call("Edit", { type: "edit", filePath: "a.ts" }, "running"), FOLDING)).toBe(0);
    expect(rows(call("Write", { type: "write", filePath: "b.ts", content: "" }, "running"), FOLDING)).toBe(0);
    // Without a path it would not fold, so it keeps its row; so does a running patch.
    expect(rows(call("Edit", { type: "edit", filePath: "" }, "running"), FOLDING)).toBe(1);
    expect(rows(call("apply_patch", { type: "edit", filePath: "a.ts", unifiedDiff: "@@" }, "running"), FOLDING)).toBe(1);
    expect(rows(call("Edit", { type: "edit", filePath: "a.ts" }, "running"), { ...FOLDING, timelineLevel: "detailed" })).toBe(1);
  });

  it("keeps failures, patches, questions, plans and sub-tasks as rows", () => {
    for (const item of [
      call("Edit", { type: "edit", filePath: "a.ts" }, "failed"),
      call("Edit", { type: "edit", filePath: "a.ts" }, "canceled"),
      call("Bash", { type: "shell", command: "npm test", exitCode: 1 }),
      call("Bash", { type: "shell", command: "npm test" }, "failed"),
      call("apply_patch", { type: "edit", filePath: "a.ts", unifiedDiff: "@@\n-a\n+b" }),
      call("apply_patch", { type: "unknown", input: {}, output: null }),
      call("request_user_input", { type: "plain_text", text: "question" }),
      call("plan_approval", { type: "plan", text: "plan" }),
      call("Agent", { type: "sub_agent", description: "work", log: "" }),
    ]) expect(rows(item, FOLDING)).toBe(1);
  });

  it("keeps today's standard rows when the plugin does not draw replies", () => {
    expect(rows(edit, { ...FOLDING, assistantMarkdown: false })).toBe(1);
    expect(rows(write, { ...FOLDING, assistantMarkdown: false })).toBe(1);
    expect(rows(edit, { ...FOLDING, chatEnabled: false })).toBe(1);
    // The prompt bubble is not an anchor, so its switch does not keep the row.
    expect(rows(edit, { ...FOLDING, enhancedUserBubble: false })).toBe(0);
  });

  it("leaves simple and detailed as they were", () => {
    expect(rows(edit, { ...FOLDING, timelineLevel: "detailed" })).toBe(1);
    expect(rows(write, { ...FOLDING, timelineLevel: "detailed" })).toBe(1);
    expect(rows(edit, { ...FOLDING, timelineLevel: "simple" })).toBe(0);
    const read = call("Read", { type: "read", filePath: "a.ts" });
    expect(rows(read, { ...FOLDING, timelineLevel: "detailed" })).toBe(1);
    expect(rows(read, FOLDING)).toBe(0);
  });

  it("folds by status, detail type, exit code and path only", () => {
    expect(foldedWorkVerb(call("Read", { type: "read", filePath: "a.ts" }))).toBe("read");
    expect(foldedWorkVerb(edit)).toBe("edit");
    expect(foldedWorkVerb(write)).toBe("write");
    expect(foldedWorkVerb(call("Bash", { type: "shell", command: "ls", exitCode: 0 }))).toBe("command");
    expect(foldedWorkVerb(call("Bash", { type: "shell", command: "ls", exitCode: 2 }))).toBeNull();
    expect(foldedWorkVerb(call("Edit", { type: "edit", filePath: "" }))).toBeNull();
    expect(foldedWorkVerb(call("Bash", { type: "shell", command: "ls" }, "running"))).toBeNull();
  });

  it("is active at standard while the plugin draws replies", () => {
    expect(standardFoldActive(FOLDING)).toBe(true);
    expect(standardFoldActive(DEFAULT_PREFERENCES)).toBe(true);
    expect(standardFoldActive({ ...DEFAULT_PREFERENCES, assistantMarkdown: false })).toBe(false);
    expect(standardFoldActive({ ...FOLDING, timelineLevel: "detailed" })).toBe(false);
  });
});
