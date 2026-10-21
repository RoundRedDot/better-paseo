/**
 * The `tool_call` transformer: what the plugin keeps of a host item for the
 * row to draw (`ToolCallPayload`).
 */
import type { PluginTimelineTransformResult } from "@getpaseo/plugin";
import type { CompactionTimelineItem, ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { toolErrorText } from "./error-text";
import { isTaskEcho } from "./task-notification";
import { readCodexAsyncQuestions } from "./codex-questions";
import { agentMessageFromDetail, agentMessageSchema, senderlessAgentMessage } from "./agent-message";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function isEmptyTerminalPoll(detail: unknown): boolean {
  const plain = detail as { type?: unknown; label?: unknown; text?: unknown };
  return plain.type === "plain_text" && !plain.label && !plain.text;
}

/** What a task notification's row reads of its metadata. */
const TASK_METADATA = ["taskId", "toolUseId", "status", "outputFile"];

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

/**
 * Context compaction has no card in the host's style; it is drawn as a row
 * like a tool call's, which the host replaces in place once it completes.
 */
export function transformCompaction({ item }: { item: CompactionTimelineItem }): PluginTimelineTransformResult | undefined {
  if (item.type !== "compaction") return undefined;
  return {
    items: [{
      type: "plugin" as const,
      kind: "omp-tool-call",
      version: 1,
      data: {
        name: "compaction",
        status: item.status === "loading" ? "running" : "completed",
        detail: toJsonValue({ type: "compaction",
          ...(item.trigger ? { trigger: item.trigger } : {}),
          ...(typeof item.preTokens === "number" ? { preTokens: item.preTokens } : {}) }),
        phase: item.status === "loading" ? "streaming" : "complete",
      },
    }],
  };
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
  // A task notification that only repeats its command's row is not drawn at all.
  const taskNotification = item.name === "task_notification";
  if (taskNotification && isTaskEcho(item.detail as Record<string, unknown>, item.metadata)) return { items: [] };
  // Codex polling a terminal it names nothing about says nothing at all.
  if (item.name === "terminal" && item.status === "completed" && isEmptyTerminalPoll(item.detail)) return { items: [] };
  const approved = item.metadata?.approved;
  const metadata = item.metadata;
  const questionData = Array.isArray(metadata?.questions) ? {
    questions: metadata.questions,
    ...(metadata.answers !== undefined ? { answers: metadata.answers } : {}),
    ...(metadata.questionResult !== undefined ? { result: metadata.questionResult } : {}),
    ...(metadata.questionStatus !== undefined ? { status: metadata.questionStatus } : {}),
  } : item.name === "request_user_input_async" && item.detail.type === "plain_text"
    ? readCodexAsyncQuestions(item.detail.text) : undefined;
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
          ...(taskNotification && metadata ? { metadata: toJsonValue(pick(metadata, TASK_METADATA)) } : {}),
        },
      },
    ],
  };
}
