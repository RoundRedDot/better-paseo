import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import type { TimelineLevel } from "../preferences";
import { classifyTool } from "./classify";
import { foldsIntoFileCard } from "./standard-fold";

const QUESTION_NAMES = new Set(["askuserquestion", "request_user_input", "request_user_input_async", "ask", "ask_user", "ask_user_question", "question"]);

/**
 * Visibility depends only on the call and the preferences, so history and
 * live updates agree. `foldEdits`: the standard level draws successful edits
 * and writes on the assistant reply's work card (`standardFoldActive`), not as rows.
 */
export function showToolAtLevel(item: ToolCallTimelineItem, level: TimelineLevel, foldEdits = false): boolean {
  if (level === "detailed") return true;
  const name = item.name.toLowerCase();
  if (name === "agent_message" || QUESTION_NAMES.has(name) || Array.isArray(item.metadata?.questions) || item.detail.type === "plan" || (name === "plan_approval" || name === "exitplanmode" || name === "exit_plan_mode")) return true;
  if (level === "simple" && name !== "hub") return false;
  const tool = classifyTool({ name: item.name, status: item.status, detail: item.detail, error: typeof item.error === "string" ? item.error : undefined });
  // The hub jobs row also feeds the existing background-work card.
  if (tool.hub?.kind === "jobs") return true;
  if (level === "simple") return false;
  if (foldEdits && foldsIntoFileCard(item)) return false;
  return tool.status === "failed" || ((tool.tool === "bash" || tool.tool === "shell" || tool.tool === "git") && tool.exitCode !== undefined && tool.exitCode !== 0) ||
    ["edit", "write", "sub_agent"].includes(tool.tool) ||
    tool.paseo?.tool === "create_agent" || tool.paseo?.tool === "send_agent_prompt" ||
    name === "apply_patch" || name === "agent_message" || name === "task_notification" ||
    /(?:^|[._/])(?:create_agent|send_agent_prompt)(?:$)/.test(name) ||
    /(?:^|__)paseo__\w*(?:create_agent|send_agent_prompt)$/.test(name);
}
