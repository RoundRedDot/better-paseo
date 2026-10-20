import { describe, expect, it } from "vitest";
import { classifyTool, type ToolCallPayload } from "../../client/tools/classify";
import { summarizeTool } from "../../client/tools/summarize";
import { providerName, shortAgentId, shouldFold } from "../../client/tools/agent-row";
import { readPermissionRequest } from "../../client/tools/agent-status";

const agentId = "58821f29-ede4-48c1-8bb2-60ed7057abca";

function paseo(name: string, input: Record<string, unknown>, output: unknown, status = "completed", error?: string) {
  return summarizeTool(classifyTool({ name: `mcp__paseo__${name}`, callId: name, status, error,
    detail: { type: "unknown", input, output } } as ToolCallPayload));
}

describe("agent row grammar", () => {
  it.each([
    ["create running", paseo("create_agent", { title: "Builder", provider: "claude" }, null, "running"),
      { verb: "Creating", target: "Builder", meta: ["Claude"], tone: "default" }],
    ["create failed", paseo("create_agent", { title: "Builder", provider: "grok" }, null, "failed", "Unknown model grok-5.\nmore"),
      { verb: "Create failed", target: "Builder", meta: ["Unknown model grok-5."], tone: "danger" }],
    ["send sent", paseo("send_agent_prompt", { agentId, prompt: "go" }, { success: true, disposition: "steered" }),
      { verb: "Sent prompt", target: "58821f29", meta: ["steered running turn"], agent: { id: agentId, targetIsId: true } }],
    ["status", paseo("get_agent_status", { agentId }, { status: "running", snapshot: { title: "Reviewer" } }),
      { verb: "Status", target: "Reviewer", meta: ["running"], agent: { targetIsId: false } }],
    ["list agents", paseo("list_agents", {}, { agents: [{ id: "a", status: "running" }, { id: "b", status: "running" }, { id: "c", status: "idle" }] }),
      { verb: "Listed agents", target: "3 agents", meta: ["2 running · 1 idle"] }],
    ["cancel not applied", paseo("cancel_agent", { agentId }, { success: false }),
      { verb: "Cancel turn", meta: ["not applied"], tone: "default" }],
    ["kill failed", paseo("kill_agent", { agentId }, null, "failed", "agent busy"),
      { verb: "Close agent", meta: ["failed · agent busy"], tone: "danger" }],
    ["set mode", paseo("set_agent_mode", { agentId, modeId: "plan" }, { success: true, newMode: "plan" }),
      { verb: "Set mode", meta: ["→ plan"] }],
    ["deny permission", paseo("respond_to_permission", { agentId, requestId: "p1", response: { behavior: "deny" } }, { success: true }),
      { verb: "Denied", agent: { icon: "ShieldX" } }],
  ])("%s", (_label, summary, expected) => {
    expect(summary).toMatchObject(expected);
  });

  it("names a waiting permission's tool and colours the row as a warning", () => {
    const text = `Agent ${agentId} (Builder) needs permission.\n\n<permission-request>\n${JSON.stringify({ agentId, requestId: "p7",
      request: { id: "p7", name: "Bash", input: { command: "rm -rf out" } } })}\n</permission-request>`;
    const summary = summarizeTool(classifyTool({ name: "agent_message", status: "completed", detail: { type: "plain_text", text },
      agentMessage: { event: "permission-required", sender: { id: agentId, title: "Builder" }, text } }));
    expect(summary).toMatchObject({ verb: "Needs permission", target: "Builder", meta: ["Bash"], tone: "warning",
      agent: { icon: "ShieldAlert" } });
  });

  it("keeps the subtask type and action count as one meta entry", () => {
    const summary = summarizeTool(classifyTool({ name: "Task", status: "running", detail: { type: "sub_agent",
      subAgentType: "explore", description: "Map the store", log: "", actions: [{ index: 0, toolName: "Grep" }] } }));
    expect(summary).toMatchObject({ verb: "Running subtask", target: "Map the store", meta: ["Explore · 1 action"] });
  });
});

describe("agent identity helpers", () => {
  it("shortens IDs and names providers", () => {
    expect(shortAgentId(agentId)).toBe("58821f29");
    expect(shortAgentId("remote::reviewer")).toBe("reviewer");
    expect(providerName("cursor/grok-4.7")).toBe("Cursor");
    expect(providerName("acme")).toBe("acme");
  });

  it("reads a permission request and drops the model-facing instruction", () => {
    const body = "Respond with `respond_to_permission` using the `agentId` and `requestId` below.\n\n" +
      `<permission-request>\n${JSON.stringify({ agentId, requestId: "p7", request: { id: "p7", title: "Bash",
        description: "Clear screenshots", input: { command: "rm -rf out" } } }, null, 2)}\n</permission-request>`;
    expect(readPermissionRequest(body)).toEqual({ requestId: "p7", title: "Bash", description: "Clear screenshots",
      command: "rm -rf out", rest: "" });
    expect(readPermissionRequest("no request")).toBeUndefined();
  });

  it("folds long bodies but not ones that would hide only a few lines", () => {
    expect(shouldFold("a\n".repeat(12).trim())).toBe(false);
    expect(shouldFold("a\n".repeat(13).trim())).toBe(false);
    expect(shouldFold("a\n".repeat(14).trim())).toBe(true);
    expect(shouldFold("x".repeat(901))).toBe(true);
  });
});
