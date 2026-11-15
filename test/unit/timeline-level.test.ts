import { describe, expect, it } from "vitest";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { showToolAtLevel } from "../../client/tools/timeline-level";
import { DEFAULT_PREFERENCES, parsePreferences } from "../../client/preferences";

function call(name: string, detail: ToolCallTimelineItem["detail"], status: ToolCallTimelineItem["status"] = "completed"): ToolCallTimelineItem {
  return { type: "tool_call", name, callId: "1", status, error: null, detail };
}

describe("timeline levels", () => {
  it("defaults to standard and preserves saved choices", () => {
    expect(DEFAULT_PREFERENCES.timelineLevel).toBe("standard");
    expect(parsePreferences({}).timelineLevel).toBe("standard");
    expect(parsePreferences({ timelineLevel: "invalid" }).timelineLevel).toBe("standard");
    expect(parsePreferences({ timelineLevel: "detailed" }).timelineLevel).toBe("detailed");
    expect(parsePreferences({ timelineLevel: "simple" }).timelineLevel).toBe("simple");
    expect(parsePreferences({ timelineLevel: "standard" }).timelineLevel).toBe("standard");
  });
  it.each([
    [call("Read", { type: "read", filePath: "a" }), false, false],
    [call("Edit", { type: "edit", filePath: "a" }), false, true],
    [call("Bash", { type: "shell", command: "test" }, "failed"), false, true],
    [call("Bash", { type: "shell", command: "test", exitCode: 1 }), false, true],
    [call("request_user_input", { type: "plain_text", text: "question" }), true, true],
    [call("agent_message", { type: "plain_text", text: "A message from another agent" }), true, true],
    [call("plan_approval", { type: "plan", text: "plan" }), true, true],
    [call("Agent", { type: "sub_agent", description: "work", log: "" }), false, true],
    [call("apply_patch", { type: "unknown", input: {}, output: null }), false, true],
    [call("hub", { type: "unknown", input: { op: "jobs" }, output: { details: { jobs: [{ id: "job", status: "running" }] } } }), true, true],
    [call("hub", { type: "unknown", input: { op: "jobs" }, output: { details: { jobs: [] } } }), true, true],
    [call("hub", { type: "unknown", input: { op: "send" }, output: { details: { receipts: [] } } }), false, false],
  ])("applies the visibility matrix", (item, simple, standard) => {
    expect(showToolAtLevel(item, "simple")).toBe(simple);
    expect(showToolAtLevel(item, "standard")).toBe(standard);
    expect(showToolAtLevel(item, "detailed")).toBe(true);
  });

  it.each(["message", "finished", "errored", "permission-required"] as const)("keeps agent %s events in simple mode", (event) => {
    const item = { ...call("agent_message", { type: "plain_text", text: `Agent ${event}` }),
      agentMessage: { event, sender: { id: "child" }, text: `Agent ${event}` } };
    expect(showToolAtLevel(item, "simple")).toBe(true);
  });
});
