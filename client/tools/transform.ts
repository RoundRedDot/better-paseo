/**
 * The `tool_call` transformer: what the plugin keeps of a host item for the
 * row to draw (`ToolCallPayload`).
 */
import type { PluginTimelineTransformResult } from "@getpaseo/plugin";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { toolErrorText } from "./error-text";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export function transformToolCall({ item, phase }: {
  item: ToolCallTimelineItem;
  phase: "streaming" | "complete";
}): PluginTimelineTransformResult | undefined {
  if (item.type !== "tool_call") return undefined;
  // A message from another agent (`agent_message`) is left to the host. Its
  // sender and event ride on `agentMessage`, which the host keeps on its own
  // item but leaves out of the one handed here; drawn by the host it reads
  // "Message from X" or "X finished".
  if (item.name === "agent_message") return undefined;
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
          ...(typeof approved === "boolean" ? { approved } : {}),
          ...(questionData ? { questionData: toJsonValue(questionData) } : {}),
        },
      },
    ],
  };
}
