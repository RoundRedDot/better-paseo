import { z } from "zod";
import { readAgentStatus, type AgentStatus, type AgentStatusData } from "./agent-status";

/** The host's optional tool-call provenance, carried without the display envelope. */
export const agentMessageSchema = z.object({
  event: z.enum(["message", "finished", "errored", "permission-required", "closed"]),
  sender: z.object({ id: z.string().min(1), title: z.string().min(1).optional() }),
  text: z.string(),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

const STATUS: Record<AgentMessage["event"], AgentStatus> = {
  message: "message", finished: "finished", errored: "errored",
  "permission-required": "needs permission", closed: "was closed",
};

export function readAgentMessage(message: AgentMessage): AgentStatusData {
  const status = STATUS[message.event];
  // Only supervisor notifications own the outer status line and response tag.
  // A received message is user-authored content, including any literal tags.
  const notification = message.event === "message" ? undefined : readAgentStatus({ type: "plain_text", text: message.text });
  const wrapped = notification?.agentId === message.sender.id &&
    (notification.status === status || message.event === "errored" && notification.status === "was canceled");
  return {
    agentId: message.sender.id,
    title: message.sender.title ?? message.sender.id,
    status: wrapped ? notification.status : status,
    body: wrapped ? notification.body : message.text,
  };
}
