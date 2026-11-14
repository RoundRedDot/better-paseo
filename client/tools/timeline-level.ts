import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import type { TimelineLevel } from "../preferences";
import { classifyTool } from "./classify";

const QUESTION_NAMES = new Set(["askuserquestion", "request_user_input", "request_user_input_async", "ask", "ask_user", "ask_user_question", "question"]);

/** Visibility depends only on the call, so history and live updates agree. */
export function showToolAtLevel(item: ToolCallTimelineItem, level: TimelineLevel): boolean {
  if (level === "detailed") return true;
  const name = item.name.toLowerCase();
  if (QUESTION_NAMES.has(name) || Array.isArray(item.metadata?.questions) || item.detail.type === "plan" || (name === "plan_approval" || name === "exitplanmode" || name === "exit_plan_mode")) return true;
  if (level === "simple") return false;
  const tool = classifyTool({ name: item.name, status: item.status, detail: item.detail, error: typeof item.error === "string" ? item.error : undefined });
  return tool.status === "failed" || ((tool.tool === "bash" || tool.tool === "shell" || tool.tool === "git") && tool.exitCode !== undefined && tool.exitCode !== 0) ||
    ["edit", "write", "sub_agent"].includes(tool.tool) ||
    tool.paseo?.tool === "create_agent" || tool.paseo?.tool === "send_agent_prompt" ||
    name === "apply_patch" || name === "agent_message" || name === "task_notification" ||
    /(?:^|[._/])(?:create_agent|send_agent_prompt)(?:$)/.test(name) ||
    /(?:^|__)paseo__\w*(?:create_agent|send_agent_prompt)$/.test(name);
}
