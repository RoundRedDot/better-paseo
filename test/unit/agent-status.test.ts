import { describe, expect, it } from "vitest";
import { readAgentStatus, AGENT_STATUS_LABEL, type AgentStatus } from "../../client/tools/agent-status";
import { transformToolCall } from "../../client/tools/transform";
import { classifyTool, type ToolCallPayload } from "../../client/tools/classify";
import { summarizeTool } from "../../client/tools/summarize";
import { toolHasDetail } from "../../client/tools/detail";
import { readAgentMessage, type AgentMessage } from "../../client/tools/agent-message";
import { toolCopyPlan } from "../../client/tools/copy";

const agentId = "2fc66837-4115-48c4-a763-ea67d6217d18";
const title = "卡片测试 (review) · Claude Code";
const body = "# Result\n\nYou've hit your session limit · resets 5:50pm (Asia/Singapore)\n\n<example>keep me</example>";
const detail = (status = "finished", response = body) => ({ type: "plain_text" as const,
  text: `Agent ${agentId} (${title}) ${status}.\n\n<agent-response>\n${response}\n</agent-response>` });

const events: Record<AgentStatus, AgentMessage["event"]> = { message: "message", finished: "finished", errored: "errored", "needs permission": "permission-required", "was closed": "closed", "was canceled": "errored" };
describe("supervisor status cards", () => {
  it.each(Object.keys(AGENT_STATUS_LABEL).filter((status) => status !== "message"))("preserves %s through the live transformer and renderer classification", (status) => {
    const transformed = transformToolCall({ item: { type: "tool_call", callId: "paseo-agent-message:m1",
      name: "agent_message", status: "completed", error: null, detail: detail(status),
      agentMessage: { event: events[status as AgentStatus], sender: { id: agentId, title }, text: detail(status).text } }, phase: "complete" });
    const payload = transformed!.items[0]!.data as unknown as ToolCallPayload;
    const view = classifyTool(payload);
    expect(view.agentStatus).toEqual({ agentId, title, status, body });
    expect(view.status).toBe(status === "errored" ? "failed" : "completed");
    expect(summarizeTool(view)).toMatchObject({ verb: AGENT_STATUS_LABEL[status as keyof typeof AGENT_STATUS_LABEL], target: title });
    expect(toolHasDetail(view, 72)).toBe(true);
    expect(toolCopyPlan(view, (path) => path).primary?.text).toBe(body);
  });

  it("does not infer failure from a finished agent's response", () => {
    expect(classifyTool({ name: "agent_message", status: "completed", detail: detail(), agentMessage: { event: "finished", sender: { id: agentId, title }, text: detail().text } }).status).toBe("completed");
  });

  it("retains permission instructions, request IDs and the response", () => {
    const request = 'Respond with `respond_to_permission`.\n\n<permission-request>\n{"requestId":"r1"}\n</permission-request>';
    const notification = detail("needs permission");
    notification.text = notification.text.replace("\n\n<agent-response>", `\n\n${request}\n\n<agent-response>`);
    expect(readAgentStatus(notification)?.body).toBe(`${request}\n\n${body}`);
  });

  it("retains long responses and server truncation notices without adding truncation", () => {
    const long = "Line\n".repeat(1000) + "[truncated 123 chars; use get_agent_activity for the full response]";
    expect(readAgentStatus(detail("finished", long))?.body).toBe(long);
  });

  it("supports empty responses and CRLF without losing nested response tags", () => {
    expect(readAgentStatus({ type: "plain_text", text: `Agent ${agentId} (${title}) was closed.` })?.body).toBe("");
    const nested = "<agent-response>\nkeep this literal example\n</agent-response>";
    expect(readAgentStatus(detail("finished", nested))?.body).toBe(nested);
    expect(readAgentStatus({ ...detail(), text: detail().text.replaceAll("\n", "\r\n") })?.body).toBe(body.replaceAll("\n", "\r\n"));
  });

  it.each(["Done: tests pass", "Agent worker finished.", "Agent worker (Review) will finish.", "Intro\n" + detail().text])(
    "does not claim an unrecognized agent message: %s", (text) => {
      expect(readAgentStatus({ type: "plain_text", text })).toBeUndefined();
      expect(transformToolCall({ item: { type: "tool_call", callId: "m", name: "agent_message",
        status: "completed", error: null, detail: { type: "plain_text", text } }, phase: "complete" })).toBeUndefined();
    });
});

describe("received agent messages", () => {
  it("uses host provenance and retains literal status-looking text and tags", () => {
    const message: AgentMessage = { event: "message", sender: { id: agentId, title: "QA question-timing #7014/#7000/#6809" },
      text: detail().text };
    const source = { type: "tool_call" as const, callId: "delivery", name: "agent_message", status: "completed" as const,
      error: null, detail: { type: "plain_text" as const, text: message.text }, agentMessage: message };
    const projected = transformToolCall({ item: source, phase: "complete" })!;
    const view = classifyTool(projected.items[0]!.data as unknown as ToolCallPayload);
    expect(view.agentStatus).toEqual({ agentId, title: message.sender.title, status: "message", body: message.text });
    expect(summarizeTool(view).verb).toBe("Message");
    expect(toolCopyPlan(view, (path) => path).primary?.text).toBe(message.text);
  });

  it("uses the complete sender ID when the host supplied no title", () => {
    expect(readAgentMessage({ event: "message", sender: { id: "server::worker" }, text: "" })).toEqual({
      agentId: "server::worker", title: "server::worker", status: "message", body: "",
    });
  });

  it("does not remove a supervisor-looking line for a different sender", () => {
    expect(readAgentMessage({ event: "finished", sender: { id: "other" }, text: detail().text }).body).toBe(detail().text);
  });
});
