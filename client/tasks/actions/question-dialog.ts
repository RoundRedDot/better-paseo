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

type SharedQuestions = {
  drafts: Map<string, QuestionDraft>;
  submitted: Set<string>;
  pending: Set<string>;
  peers: Set<(key: string, patch: Partial<QuestionDialogState> | null) => void>;
};

/** Shared across board locations and virtualised card remounts, scoped to one client. */
export function createQuestionDialogStore(shared: SharedQuestions = { drafts: new Map(), submitted: new Set(), pending: new Set(), peers: new Set() }) {
  let state: QuestionDialogState | null = null;
  const drafts = shared.drafts;
  const submitted = shared.submitted;
  const listeners = new Set<() => void>();
  const publish = (next: QuestionDialogState | null) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const receive = (key: string, patch: Partial<QuestionDialogState> | null) => {
    if (state?.key !== key) return;
    publish(patch ? { ...state, ...patch } : null);
  };
  const broadcast = (key: string, patch: Partial<QuestionDialogState> | null) => {
    receive(key, patch);
    for (const peer of [...shared.peers]) if (peer !== receive) peer(key, patch);
  };
  return {
    fork: () => createQuestionDialogStore(shared),
    get: () => state,
    isSubmitted(card: TaskCard) { return submitted.has(questionRequestKey(card)); },
    subscribe(listener: () => void) { listeners.add(listener); shared.peers.add(receive); return () => { listeners.delete(listener); if (!listeners.size) shared.peers.delete(receive); }; },
    open(card: TaskCard) {
      if (!card.permission || state?.pending) return;
      const key = questionRequestKey(card);
      if (state?.key === key || submitted.has(key)) return;
      publish({ agentId: card.id, key, permission: card.permission, draft: drafts.get(key) ?? EMPTY_QUESTION_DRAFT,
        pending: shared.pending.has(key), submitted: submitted.has(key), error: null });
    },
    close() { if (!state?.pending) publish(null); },
    reset() {
      if (!state || state.pending) return;
      drafts.delete(state.key);
      broadcast(state.key, { draft: EMPTY_QUESTION_DRAFT, error: null });
    },
    change(draft: QuestionDraft) {
      if (!state || state.pending || state.submitted) return;
      drafts.set(state.key, draft);
      broadcast(state.key, { draft, error: null });
    },
    async submit(send: (state: QuestionDialogState) => Promise<void>, cards?: TaskCard[]) {
      if (!state || state.pending || state.submitted) return;
      const current = state;
      shared.pending.add(current.key);
      broadcast(current.key, { pending: true, error: null });
      try {
        await send(current);
        shared.pending.delete(current.key);
        submitted.add(current.key);
        drafts.delete(current.key);
        for (const peer of [...shared.peers]) if (peer !== receive) peer(current.key, null);
        if (state?.key === current.key) {
          const available = cards?.filter((card) => questionRequestKey(card) !== current.key && !submitted.has(questionRequestKey(card))) ?? [];
          const originalIndex = cards?.findIndex((card) => card.id === current.agentId) ?? -1;
          const next = cards?.slice(originalIndex + 1).find((card) => available.includes(card)) ?? available.at(-1);
          if (next?.permission) {
            const key = questionRequestKey(next);
            publish({ agentId: next.id, key, permission: next.permission, draft: drafts.get(key) ?? EMPTY_QUESTION_DRAFT, pending: false, submitted: false, error: null });
          } else publish(null);
        }
      } catch (error) {
        shared.pending.delete(current.key);
        broadcast(current.key, { pending: false, error: error instanceof Error ? error.message : String(error) });
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
