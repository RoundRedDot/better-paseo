import { describe, expect, it } from "vitest";
import { classifyTool } from "../../client/tools/classify";
import { AGENT_OPERATIONS } from "../../client/tools/agent-operation";
import { toolCopyPlan } from "../../client/tools/copy";
import { toolHasDetail } from "../../client/tools/detail";

const agentId = "remote::reviewer";
const input = { agentId, prompt: "# Follow up\n\n**Keep all changes**\n", sessionMode: "read-only" };
const result = { success: true, disposition: "turn_started", status: "running", guidance: "Wait for the finish notification." };
function tool(name: string, output: unknown, status = "completed", args: Record<string, unknown> = input) {
  return classifyTool({ name, status, callId: "tool-1", detail: { type: "unknown", input: args, output } });
}

describe("Paseo agent dispatch cards", () => {
  it.each(["send_agent_prompt", "paseo.send_agent_prompt", "mcp__paseo__send_agent_prompt", "paseo / send_agent_prompt"])(
    "keeps the typed prompt and returned dispatch state for %s", (name) => {
      const view = tool(name, { content: [], structuredContent: result });
      expect(view.tool).toBe("paseo");
      expect(view.paseo?.sendAgentPrompt).toMatchObject({ agentId, prompt: input.prompt, state: "sent",
        success: true, disposition: "turn_started", agentStatus: "running", guidance: result.guidance });
      expect(toolHasDetail(view, 72)).toBe(true);
      expect(toolCopyPlan(view, (path) => path).menu[0]?.text).toBe(JSON.stringify(input, null, 2));
    });

  it.each([result, JSON.stringify(result), { content: [{ type: "text", text: JSON.stringify(result) }] },
    { content: [], structuredContent: result }])("reads the supported MCP result transport %j", (output) => {
    expect(tool("paseo.send_agent_prompt", output).paseo?.sendAgentPrompt?.state).toBe("sent");
  });

  it.each([
    ["running", null, "sending"], ["failed", "provider unavailable", "failed"], ["canceled", null, "canceled"],
    ["completed", { isError: true, content: [{ type: "text", text: "rejected" }] }, "failed"],
    ["completed", { success: false }, "failed"], ["completed", null, "unconfirmed"],
    ["completed", { success: "true", status: "running" }, "unconfirmed"],
  ])("preserves dispatch state for status %s and output %j", (status, output, state) => {
    const view = tool("paseo.send_agent_prompt", output, status as string);
    expect(view.paseo?.sendAgentPrompt?.state).toBe(state);
  });

  it("does not label a running agent as a completed task or infer missing fields", () => {
    const sent = tool("paseo.send_agent_prompt", result).paseo!.sendAgentPrompt!;
    expect(sent.state).toBe("sent");
    expect(sent.agentStatus).toBe("running");
    expect(tool("paseo.send_agent_prompt", {}).paseo?.sendAgentPrompt).toMatchObject({
      state: "unconfirmed", success: undefined, agentStatus: undefined, disposition: undefined, guidance: undefined,
    });
  });
});

describe("agent operation inventory", () => {
  it.each(Object.keys(AGENT_OPERATIONS))("gives %s an expandable typed card and raw copy sources", (name) => {
    const output = { content: [], structuredContent: { success: true } };
    const view = tool(`paseo.${name}`, output);
    expect(view.tool).toBe("paseo");
    expect(view.paseo?.agentOperation).toMatchObject({ agentId, label: "Request acknowledged", tone: "success" });
    expect(toolHasDetail(view, 72)).toBe(true);
    expect(toolCopyPlan(view, (path) => path).primary?.text).toBe(JSON.stringify(output, null, 2));
  });

  it("uses explicit snapshot fields and keeps unknown fields in the raw result", () => {
    const output = { status: "running", snapshot: { title: "Reviewer", provider: "codex", cwd: "/repo", model: "gpt-6",
      currentModeId: "read-only", pendingPermissions: [], arbitraryField: "kept" } };
    const data = tool("paseo.get_agent_status", output).paseo!.agentOperation!;
    expect(data.title).toBe("Reviewer");
    expect(data.label).toBe("running");
    expect(data.facts).toEqual([{ label: "Provider", value: "codex" }, { label: "Model", value: "gpt-6" },
      { label: "Directory", value: "/repo" }, { label: "Mode", value: "read-only" }]);
    expect(data.result).toBe(output);
  });

  it("retains activity Markdown without truncating it", () => {
    const content = "# Activities\n\n" + "**Full response**\n".repeat(300);
    expect(tool("paseo.get_agent_activity", { agentId, updateCount: 0, content }).paseo?.agentOperation).toMatchObject({
      content, facts: [{ label: "Updates", value: "0" }],
    });
  });

  it("reads agent lists and distinguishes an empty list from a missing result", () => {
    const agent = { id: agentId, title: "Reviewer", status: "idle", provider: "codex", cwd: "/repo" };
    expect(tool("paseo.list_agents", { agents: [agent] }).paseo?.agentOperation?.agents).toEqual([agent]);
    expect(tool("paseo.list_agents", { agents: [] }).paseo?.agentOperation?.agents).toEqual([]);
    expect(tool("paseo.list_agents", null).paseo?.agentOperation?.agents).toBeUndefined();
  });

  it("does not call an idle cancel a failure or invent success for a missing result", () => {
    expect(tool("paseo.cancel_agent", { success: false }).paseo?.agentOperation?.label).toBe("No run canceled");
    expect(tool("paseo.update_agent", null).paseo?.agentOperation?.label).toBe("No result reported");
  });

  it("extracts a successful creation ID from the structured MCP result", () => {
    expect(tool("paseo.create_agent", { content: [], structuredContent: { agentId, status: "running" } }).paseo?.createAgent?.agentId).toBe(agentId);
  });
});
