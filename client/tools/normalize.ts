/**
 * Some providers report a call this plugin already has a card for in a shape
 * of their own: Grok wraps every MCP call in a `UseTool` variant, Cursor
 * names it `other` with the server and tool in the input, OpenCode calls
 * Paseo's tools `paseo_<tool>`. Each is rewritten here into the shape the
 * classifier reads, so they draw as the MCP, Paseo, fetch or subtask card.
 *
 * Pure: no React, no host hooks.
 */
import type { ToolCallPayload } from "./classify";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** An answer as content blocks, the form an MCP result takes. */
function asContent(value: string | undefined): Record<string, unknown> | undefined {
  return value === undefined ? undefined : { content: [{ type: "text", text: value }] };
}

function mcpCall(payload: ToolCallPayload, server: string, tool: string, input: unknown, output: unknown,
  error?: string): ToolCallPayload {
  return {
    ...payload,
    name: `mcp__${server}__${tool}`,
    detail: { type: "unknown", input: record(input) ?? {}, output },
    ...(error ? { status: "failed", error } : {}),
  };
}

/** Grok: `{ variant: "UseTool", tool_name: "server__tool", tool_input }`, answered `{ OkayOutput }` or `{ Error }`. */
function readGrokUseTool(payload: ToolCallPayload, input: Record<string, unknown>, output: Record<string, unknown> | undefined) {
  const name = text(input.tool_name) ?? "";
  const split = name.indexOf("__");
  const server = text(output?.server_name) ?? (split > 0 ? name.slice(0, split) : undefined);
  const tool = text(output?.tool_name) ?? (split > 0 ? name.slice(split + 2) : undefined);
  if (!server || !tool) return undefined;
  const answer = record(output?.output);
  const okay = answer?.OkayOutput;
  const failure = text(answer?.Error);
  const body = typeof okay === "string" ? okay : okay === undefined ? undefined : JSON.stringify(okay);
  return mcpCall(payload, server, tool, input.tool_input, asContent(body), failure);
}

/** Cursor: `{ providerIdentifier, toolName, args }`, answered `{ success }` or `{ error }`. */
function readCursorTool(payload: ToolCallPayload, input: Record<string, unknown>, output: Record<string, unknown> | undefined) {
  const server = text(input.providerIdentifier);
  const tool = text(input.toolName);
  if (!server || !tool) return undefined;
  // `{ success: true }` says nothing the row does not; there is no result to show.
  return mcpCall(payload, server, tool, input.args, undefined, text(output?.error));
}

export function normalizeForeignTool(payload: ToolCallPayload): ToolCallPayload {
  const detail = record(payload.detail);
  if (!detail || detail.type !== "unknown") return payload;
  const input = record(detail.input);
  const output = record(detail.output);
  if (!input) return payload;
  if (input.variant === "UseTool") return readGrokUseTool(payload, input, output) ?? payload;
  if (payload.name === "other") {
    if (input.providerIdentifier !== undefined) return readCursorTool(payload, input, output) ?? payload;
    // Cursor's subtask: the tool's name rides in the input.
    if (input._toolName === "task") {
      const { _toolName: _ignored, ...rest } = input;
      return { ...payload, name: "task", detail: { ...detail, input: rest } };
    }
  }
  // OpenCode names Paseo's tools `paseo_<tool>` and answers in plain text.
  const paseo = /^paseo_([a-z_]+)$/.exec(payload.name);
  if (paseo) return mcpCall(payload, "paseo", paseo[1]!, input, asContent(text(detail.output)));
  if (payload.name === "webfetch" && text(input.url)) {
    return { ...payload, detail: { type: "fetch", url: input.url, result: text(detail.output) } };
  }
  return payload;
}
