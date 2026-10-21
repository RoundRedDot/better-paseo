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

const EVENT: Record<AgentStatus, AgentMessage["event"] | undefined> = {
  finished: "finished", errored: "errored", "needs permission": "permission-required", "was closed": "closed",
  // The supervisor files a cancel under the errored event (agent-prompt.ts).
  "was canceled": "errored", message: undefined,
};

/**
 * Paseo 0.12 hands plugin transformers the tool call without its
 * `agentMessage` (the app's `sourceToolCallTimelineItem` copies only call ID,
 * name, detail, metadata, status and error). A supervisor notification still
 * names its sender and event in its first line, so it is read back from the
 * detail. A plain agent-to-agent message carries no sender there; see
 * `senderlessAgentMessage`.
 */
export function agentMessageFromDetail(detail: unknown): AgentMessage | undefined {
  const status = readAgentStatus(detail);
  if (!status) return undefined;
  const event = EVENT[status.status];
  if (!event) return undefined;
  const text = (detail as { text: string }).text;
  return { event, sender: { id: status.agentId, title: status.title }, text };
}

/**
 * A plain agent-to-agent message as the transformer sees it: the text and no
 * sender. Its row reads the sender back from the timeline
 * (`state/agent-message-senders.ts`) and draws the message without one until then.
 */
export function senderlessAgentMessage(detail: unknown): AgentMessage | undefined {
  const plain = detail as { type?: unknown; text?: unknown } | null | undefined;
  if (plain?.type !== "plain_text" || typeof plain.text !== "string") return undefined;
  return { event: "message", sender: { id: "" }, text: plain.text };
}
