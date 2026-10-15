/** Synthetic shape of the iOS long-history incident; contains no captured text. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export function longHistoryFixture() {
  const events: Array<{ t: number; item: AgentTimelineItem; mode: "append" | "replace" }> = [];
  const tools: Extract<AgentTimelineItem, { type: "tool_call" }>[] = [];
  const add = (item: AgentTimelineItem) => events.push({ t: events.length * 10, item,
    mode: item.type === "tool_call" ? "replace" : "append" });
  const prose = (length: number) => "Synthetic history paragraph with **formatting** and `code`. ".repeat(Math.ceil(length / 60) + 1).slice(0, length);
  const section = `## Synthetic section\n\n${prose(760)}\n\n`;
  const list = Array.from({ length: 244 }, (_, index) =>
    `- Synthetic item ${index}: ${"independent detail ".repeat(5)}\n`).join("");
  const longReply = `## Synthetic report\n\n${prose(10_470)}\n\n${list}\n${section.repeat(80)}`.slice(0, 59_427);
  let toolId = 0;
  for (let turn = 0; turn < 12; turn++) {
    add({ type: "user_message", text: `Synthetic prompt ${turn + 1}` });
    const thoughts = 21 + (turn < 8 ? 1 : 0);
    const replies = 11 + (turn < 8 ? 1 : 0);
    const calls = 33 + (turn < 2 ? 1 : 0);
    for (let index = 0; index < calls; index++) {
      if (index < thoughts) add({ type: "reasoning", text: prose(550) });
      if (Math.floor((index + 1) * replies / calls) > Math.floor(index * replies / calls)) {
        add({ type: "assistant_message", text: turn === 11 && index === calls - 1 ? longReply : prose(420) });
      }
      const tool: Extract<AgentTimelineItem, { type: "tool_call" }> = {
        type: "tool_call", callId: `synthetic-${toolId}`, name: "Read", status: "running", error: null,
        detail: { type: "read", filePath: `/synthetic/src/synthetic-${toolId++}.ts` },
      };
      tools.push(tool);
      add(tool);
    }
  }
  // Updates arrive after many intervening messages: this preserves the
  // lifecycle overlap that expands a projected tail beyond its requested size.
  for (const tool of tools) add({ ...tool, status: "completed", error: null,
    detail: { type: "read", filePath: `/synthetic/src/${tool.callId}.ts`, content: prose(1800) } });
  return [{ kind: "meta", name: "history-long-load",
    description: "Synthetic 810-item history: 12 prompts, 260 thoughts, 398 tools, 140 replies; one 59427-character reply and delayed lifecycle updates",
    scenario: "Cold history open, upward pagination and long-reply remount (not streaming throughput)" }, ...events]
    .map((line) => JSON.stringify(line)).join("\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = new URL("./history-long-load.jsonl", import.meta.url);
  const expected = longHistoryFixture();
  if (process.argv.includes("--check")) {
    if (readFileSync(file, "utf8") !== expected) throw new Error("history-long-load fixture drifted");
  } else writeFileSync(file, expected);
}
