import { describe, expect, it } from "vitest";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { transformToolCall } from "../../client/tools/transform";
import { classifyTool, type ToolCallPayload } from "../../client/tools/classify";
import { readUserQuestions } from "../../client/tools/user-questions";

function item(extra: Partial<ToolCallTimelineItem> = {}): ToolCallTimelineItem {
  return {
    type: "tool_call",
    callId: "c1",
    name: "plan_approval",
    status: "completed",
    error: null,
    detail: { type: "plan", text: "# Ship it" },
    ...extra,
  } as ToolCallTimelineItem;
}

function data(input: ToolCallTimelineItem, phase: "streaming" | "complete" = "complete") {
  return transformToolCall({ item: input, phase })?.items[0]?.data as Record<string, unknown> | undefined;
}

describe("tool_call transformer", () => {
  it("keeps structured Codex questions through transformation and classification", () => {
    const questions = [{ id: "scope", header: "Scope", question: "Which platforms?", multiSelect: true,
      options: [{ label: "iOS" }, { label: "Web" }] }];
    const payload = data(item({ name: "request_user_input", detail: { type: "plain_text", text: "Questions and answers" },
      metadata: { questions, answers: { scope: ["iOS", "Web"] }, sessionId: "private-session" },
    })) as unknown as ToolCallPayload;
    expect(readUserQuestions(classifyTool(payload))).toMatchObject({ questions: [{ question: "Which platforms?", answer: "iOS, Web" }] });
    expect(JSON.stringify(payload)).not.toContain("private-session");
  });
  it("carries a plan's verdict, and no other metadata", () => {
    expect(data(item({ metadata: { approved: false, sessionId: "s", big: { x: 1 } } }))).toEqual({
      name: "plan_approval",
      status: "completed",
      detail: { type: "plan", text: "# Ship it" },
      callId: "c1",
      error: null,
      phase: "complete",
      approved: false,
    });
    expect(data(item({ metadata: { approved: true } }))?.approved).toBe(true);
    expect(data(item({ metadata: { approved: "yes" } }))).not.toHaveProperty("approved");
    expect(data(item())).not.toHaveProperty("approved");
  });

  it("keeps a canceled status as the host reported it", () => {
    expect(data(item({ status: "canceled", metadata: {} }))?.status).toBe("canceled");
  });

  it("leaves a message from another agent to the host, which knows its sender", () => {
    const message = item({
      callId: "paseo-agent-message:m1",
      name: "agent_message",
      detail: { type: "plain_text", text: "Done: tests pass", icon: "bot" },
    });
    expect(transformToolCall({ item: message, phase: "complete" })).toBeUndefined();
  });
});
