import { useEffect, useSyncExternalStore } from "react";
import type { PaseoAgentTimelineHandle } from "@getpaseo/client";
import { isAssistantPlaceholder } from "../../assistant-text";
import type { TaskPermission } from "../model";

/**
 * What the agent wrote right before it asked: the explanation a question
 * points back to ("the plan above"). The question dialog shows it so the
 * reader can answer without opening the agent's tab.
 *
 * It is not the latest reply. An async question (Codex's
 * `request_user_input_async`) lets the turn go on, and the reply after it is
 * a summary; the text the question refers to sits before the question's own
 * row. So the read finds that row by its call id and walks back from it.
 */
export type QuestionContext =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; text: string; timestamp?: string }
  | { state: "none" }
  | { state: "error" };

type Row = { timestamp?: string; item: { type: string; text?: string; callId?: string; name?: string } };
type Api = { agents: { ref(id: string): { timeline: Pick<PaseoAgentTimelineHandle, "refetch"> } } };

/** Tool rows fold into one projected row each, so this reaches past the work an async question lets run. */
const TAIL_LIMIT = 60;
/** An async question lets the turn go on: without its row, the tail's end is no anchor. */
const ASYNC_QUESTION = /_async$/;

/** A message that opens or ends on a rule (Codex separates its replies with `---`) reads cleaner without it. */
function trimRules(text: string): string {
  return text.replace(/^(?:\s*(?:-{3,}|\*{3,}|_{3,})\s*(?:\n|$))+/, "").replace(/(?:\n\s*(?:-{3,}|\*{3,}|_{3,})\s*)+$/, "").trim();
}

/**
 * The question's row: the first with its call id (a later copy can repeat it
 * once answered), else the last tool call of its name. A blocking question is
 * the last thing the turn did, so without a row the tail's end stands in.
 */
function anchorIndex(rows: readonly Row[], permission: Pick<TaskPermission, "callId" | "name">): number {
  if (permission.callId) {
    const index = rows.findIndex((row) => row.item.type === "tool_call" && row.item.callId === permission.callId);
    if (index >= 0) return index;
  }
  if (permission.name) {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const { item } = rows[index]!;
      if (item.type === "tool_call" && item.name === permission.name) return index;
    }
  }
  return permission.name && ASYNC_QUESTION.test(permission.name) ? -1 : rows.length;
}

/**
 * The assistant messages closest before the question in its turn, joined:
 * work rows between them end the run once text is found, a person's message
 * ends the turn.
 */
export function questionContextText(rows: readonly Row[], permission: Pick<TaskPermission, "callId" | "name">): Extract<QuestionContext, { state: "ready" }> | null {
  const anchor = anchorIndex(rows, permission);
  const parts: string[] = [];
  let timestamp: string | undefined;
  for (let index = anchor - 1; index >= 0; index -= 1) {
    const { item, timestamp: at } = rows[index]!;
    if (item.type === "user_message") break;
    if (item.type === "assistant_message") {
      const text = trimRules(item.text ?? "");
      if (!text || isAssistantPlaceholder(text)) continue;
      parts.unshift(text);
      timestamp ??= at;
      continue;
    }
    // Reasoning and progress notes sit inside a run of text; a tool call ends one.
    if (parts.length && item.type === "tool_call") break;
  }
  if (!parts.length) return null;
  return { state: "ready", text: parts.join("\n\n"), ...(timestamp !== undefined ? { timestamp } : {}) };
}

/**
 * Whether the details show the note above their inline answer. A blocking
 * question's note is the latest reply the details already show; an async
 * one's is not, the turn having replied again since. Only a read note that
 * differs shows, so the details never flash a skeleton they then take back.
 */
export function detailsShowNote(note: QuestionContext, reply: { state: string; timestamp?: string }): boolean {
  if (note.state !== "ready" || reply.state === "idle" || reply.state === "loading") return false;
  return reply.state !== "ready" || note.timestamp === undefined || note.timestamp !== reply.timestamp;
}

interface Entry { value: QuestionContext; ticket: number }

/** One read per question: the text before it does not move while it waits. */
export function createQuestionContextStore(api: Api) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let tickets = 0;
  const IDLE: QuestionContext = { state: "idle" };
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const keyOf = (agentId: string, requestId: string) => `${agentId}\n${requestId}`;
  return {
    read: (agentId: string, requestId: string): QuestionContext => entries.get(keyOf(agentId, requestId))?.value ?? IDLE,
    request(agentId: string, permission: Pick<TaskPermission, "requestId" | "callId" | "name">, force = false) {
      const key = keyOf(agentId, permission.requestId);
      const known = entries.get(key);
      if (known && !force && known.value.state !== "idle") return;
      const ticket = ++tickets;
      entries.set(key, { value: { state: "loading" }, ticket });
      notify();
      const land = (value: QuestionContext) => {
        if (entries.get(key)?.ticket !== ticket) return;
        entries.set(key, { value, ticket });
        notify();
      };
      api.agents.ref(agentId).timeline.refetch({ direction: "tail", projection: "projected", limit: TAIL_LIMIT })
        .then((page) => land(page.error ? { state: "error" } : questionContextText(page.entries, permission) ?? { state: "none" }))
        .catch(() => land({ state: "error" }));
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

type Store = ReturnType<typeof createQuestionContextStore>;
const stores = new WeakMap<object, Store>();

export function questionContextStore(api: Api): Store {
  let store = stores.get(api);
  if (!store) stores.set(api, (store = createQuestionContextStore(api)));
  return store;
}

/** The text before a card's pending question, read once when shown; `retry` reads it again. */
export function useQuestionContext(api: Api | undefined, agentId: string, permission: Pick<TaskPermission, "requestId" | "callId" | "name"> | null | undefined): { context: QuestionContext; retry(): void } {
  const store = api ? questionContextStore(api) : null;
  const requestId = permission?.requestId ?? "";
  const snapshot = () => (store && requestId ? store.read(agentId, requestId) : IDLE_CONTEXT);
  const context = useSyncExternalStore(store?.subscribe ?? noSubscribe, snapshot, snapshot);
  const callId = permission?.callId;
  const name = permission?.name;
  useEffect(() => {
    if (store && agentId && requestId) store.request(agentId, { requestId, callId, name });
  }, [store, agentId, requestId, callId, name]);
  return { context, retry: () => { if (store && agentId && requestId) store.request(agentId, { requestId, callId, name }, true); } };
}

const IDLE_CONTEXT: QuestionContext = { state: "idle" };
const noSubscribe = () => () => {};
