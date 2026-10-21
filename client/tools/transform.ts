/**
 * The `tool_call` transformer: what the plugin keeps of a host item for the
 * row to draw (`ToolCallPayload`).
 */
import type { PluginTimelineTransformResult } from "@getpaseo/plugin";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { toolErrorText } from "./error-text";
import { agentMessageFromDetail, agentMessageSchema, senderlessAgentMessage } from "./agent-message";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export function transformToolCall({ item, phase }: {
  item: ToolCallTimelineItem;
  phase: "streaming" | "complete";
}): PluginTimelineTransformResult | undefined {
  if (item.type !== "tool_call") return undefined;
  // The host's provenance when it passes it on; otherwise the notification's own status line.
  const provenance = item.name === "agent_message"
    ? (item as { agentMessage?: unknown }).agentMessage ?? agentMessageFromDetail(item.detail) : undefined;
  const message = provenance !== undefined ? agentMessageSchema.safeParse(provenance) : undefined;
  // A provenance that does not parse stays with the host. A plain message
  // with none is claimed; its row reads the sender back.
  if (message && !message.success) return undefined;
  if (item.name === "agent_message" && !message && !senderlessAgentMessage(item.detail)) return undefined;
  // The status rides as the host sent it, `canceled` included. Of the
  // metadata a plan's verdict and structured questions are kept: Claude reports a rejected plan
  // as `completed` with `approved: false`, so the status alone cannot tell.
  // The rest can be large and no row reads it.
  const approved = item.metadata?.approved;
  const metadata = item.metadata;
  const questionData = Array.isArray(metadata?.questions) ? {
    questions: metadata.questions,
    ...(metadata.answers !== undefined ? { answers: metadata.answers } : {}),
    ...(metadata.questionResult !== undefined ? { result: metadata.questionResult } : {}),
    ...(metadata.questionStatus !== undefined ? { status: metadata.questionStatus } : {}),
  } : undefined;
  return {
    items: [
      {
        type: "plugin" as const,
        kind: "omp-tool-call",
        version: 1,
        data: {
          name: item.name,
          status: item.status,
          detail: toJsonValue(item.detail),
          ...(item.callId ? { callId: item.callId } : {}),
          error: toolErrorText(item.error),
          phase,
          ...(message?.success ? { agentMessage: toJsonValue(message.data) } : {}),
          ...(typeof approved === "boolean" ? { approved } : {}),
          ...(questionData ? { questionData: toJsonValue(questionData) } : {}),
        },
      },
    ],
  };
}
