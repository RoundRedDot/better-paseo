import type { PaseoApi } from "@getpaseo/client";
import type { TaskCard, TaskPermission } from "../model";
import { EMPTY_QUESTION_DRAFT, type QuestionDraft } from "../question-form";

export function questionRequestKey(card: TaskCard): string {
  return JSON.stringify([card.id, card.permission?.requestId, card.permission?.questions]);
}

export interface QuestionDialogState {
  agentId: string;
  key: string;
  permission: TaskPermission;
  draft: QuestionDraft;
  pending: boolean;
  submitted: boolean;
  error: string | null;
}

/** Shared across board locations and virtualised card remounts, scoped to one client. */
export function createQuestionDialogStore() {
  let state: QuestionDialogState | null = null;
  const drafts = new Map<string, QuestionDraft>();
  const submitted = new Set<string>();
  const listeners = new Set<() => void>();
  const publish = (next: QuestionDialogState | null) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    open(card: TaskCard) {
      if (!card.permission || state?.pending) return;
      const key = questionRequestKey(card);
      if (state?.key === key || submitted.has(key)) return;
      publish({ agentId: card.id, key, permission: card.permission, draft: drafts.get(key) ?? EMPTY_QUESTION_DRAFT,
        pending: false, submitted: submitted.has(key), error: null });
    },
    close() { if (!state?.pending) publish(null); },
    change(draft: QuestionDraft) {
      if (!state || state.pending || state.submitted) return;
      drafts.set(state.key, draft);
      publish({ ...state, draft, error: null });
    },
    async submit(send: (state: QuestionDialogState) => Promise<void>) {
      if (!state || state.pending || state.submitted) return;
      const current = state;
      publish({ ...current, pending: true, error: null });
      try {
        await send(current);
        submitted.add(current.key);
        drafts.delete(current.key);
        if (state?.key === current.key) publish(null);
      } catch (error) {
        if (state?.key === current.key) publish({ ...state, pending: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

const stores = new WeakMap<PaseoApi, ReturnType<typeof createQuestionDialogStore>>();
export function questionDialogStore(paseo: PaseoApi) {
  let store = stores.get(paseo);
  if (!store) stores.set(paseo, store = createQuestionDialogStore());
  return store;
}

export type QuestionDialogStore = ReturnType<typeof createQuestionDialogStore>;
