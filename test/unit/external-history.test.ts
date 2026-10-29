import { describe, expect, it } from "vitest";
import { externalHistoryRows } from "../../client/external-history";
import { classifyTool } from "../../client/tools/classify";
import { defaultToolExpanded, toolDisclosureKey } from "../../client/tools/disclosure";

describe("imported external history", () => {
  it("separates merged calls, results, and replies without pairing parallel calls", () => {
    const text = "Before" +
      "[external_agent_tool_call: Read]\nfile: /tmp/report.md\n[/external_agent_tool_call]" +
      "[external_agent_tool_call: Bash]\ncommand: ls\n[/external_agent_tool_call]" +
      "[external_agent_tool_result]\n" + "1\tLong output\n".repeat(1000) + "[/external_agent_tool_result]" +
      "Done";
    const rows = externalHistoryRows(text, "complete", "message-1")!;
    expect(rows.map((row) => row.kind)).toEqual(["omp-assistant", "omp-tool-call", "omp-tool-call", "omp-tool-call", "omp-assistant"]);
    expect(rows[0]!.data).toMatchObject({ text: "Before" });
    expect(rows[4]!.data).toMatchObject({ text: "Done", messageText: text });
    const calls = rows.slice(1, 4).map((row) => classifyTool(row.data as unknown as Parameters<typeof classifyTool>[0]));
    expect(calls.map((call) => call.text)).toEqual(["file: /tmp/report.md", "command: ls", "1\tLong output\n".repeat(1000).slice(0, -1)]);
    expect(calls.every((call) => !defaultToolExpanded(call, "expand-failed"))).toBe(true);
    expect(new Set(calls.map((call) => toolDisclosureKey("agent", call))).size).toBe(3);
  });

  it("leaves incomplete and streaming text untouched", () => {
    expect(externalHistoryRows("[external_agent_tool_call: Read]\nfile", "complete")).toBeUndefined();
    expect(externalHistoryRows("[external_agent_tool_result]\noutput\n[/external_agent_tool_result]", "streaming")).toBeUndefined();
    expect(externalHistoryRows("ordinary reply", "complete")).toBeUndefined();
    expect(externalHistoryRows("```text\n[external_agent_tool_result]\noutput\n[/external_agent_tool_result]\n```", "complete")).toBeUndefined();
    expect(externalHistoryRows("[external_agent_tool_result]\n[/external_agent_tool_result]", "complete")?.[0]?.data)
      .toMatchObject({ detail: { text: "" } });
    expect(externalHistoryRows("[external_agent_tool_result: error]\nfailed\n[/external_agent_tool_result]", "complete")?.[0]?.data)
      .toMatchObject({ status: "failed", detail: { text: "failed" } });
  });
});
