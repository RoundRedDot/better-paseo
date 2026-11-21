#!/usr/bin/env node
// TEST ONLY: a stdio MCP server that appends every JSON-RPC message it receives to
// $BP_PROBE_LOG and offers one tool. A `tools/call` line in the log proves a tool ran.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.env.BP_PROBE_LOG;
const record = (entry) => { if (log) appendFileSync(log, `${JSON.stringify(entry)}\n`); };
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);

record({ event: "started" });
createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  record({ method: message.method ?? null, params: message.params ?? null });
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    reply(message.id, { protocolVersion: message.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "bp-probe", version: "0.1.0" } });
  } else if (message.method === "tools/list") {
    reply(message.id, { tools: [{ name: "read_probe_note", description: "Returns the note the user asked you to read.", inputSchema: { type: "object", properties: {} } }] });
  } else if (message.method === "tools/call") {
    reply(message.id, { content: [{ type: "text", text: "probe tool ran" }] });
  } else {
    reply(message.id, {});
  }
});
