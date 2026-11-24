import React, { type ReactNode } from "react";
import { InlineTranslation, type InlineTranslationState } from "./inline";
import type { TranslationSourceKind } from "./store";

export type TranslationField = { id: string; text: string; kind: TranslationSourceKind; streaming?: boolean };
export type TranslationFields = Record<string, InlineTranslationState>;

/** Separate requests keep translated labels tied to their original fields. */
export function TranslationGroup({ agentId, fields, children }: {
  agentId?: string; fields: TranslationField[]; children(states: TranslationFields): ReactNode;
}) {
  if (!agentId) return <>{children({})}</>;
  return <TranslationSessions agentId={agentId} fields={fields} index={0} states={{}} children={children} />;
}

function TranslationSessions({ agentId, fields, index, states, children }: {
  agentId: string; fields: TranslationField[]; index: number; states: TranslationFields; children(states: TranslationFields): ReactNode;
}) {
  const field = fields[index];
  if (!field) return <>{children(states)}</>;
  return <InlineTranslation key={JSON.stringify([agentId, field.id])} agentId={agentId}
    kind={field.kind} text={field.text} streaming={field.streaming === true}>
    {(state) => <TranslationSessions agentId={agentId} fields={fields} index={index + 1}
      states={{ ...states, [field.id]: state }} children={children} />}
  </InlineTranslation>;
}

export function translatedField(states: TranslationFields, id: string, original: string): string {
  const state = states[id];
  return state?.active && state.view?.status === "done" ? state.view.result.translation : original;
}

/** One action controls a collection while allowing failed fields to retry independently. */
export function translationGroupState(states: TranslationFields): InlineTranslationState | undefined {
  const items = Object.values(states);
  if (!items.length) return undefined;
  const active = items.some((state) => state.active);
  const partial = active && items.some((state) => !state.active);
  const retry = items.filter((state) => state.active && (state.view?.status === "error" || state.view?.status === "stale"));
  const waiting = items.find((state) => state.active && (state.view?.status === "running" || state.view?.status === "settings-loading"));
  const other = items.find((state) => state.active && state.view?.status !== "done");
  return {
    active,
    view: partial ? null : waiting?.view ?? retry[0]?.view ?? other?.view ?? items.find((state) => state.active)?.view ?? null,
    toggle() {
      if (partial) { items.filter((state) => !state.active).forEach((state) => state.toggle()); return; }
      if (retry.length && !waiting) { retry.forEach((state) => state.toggle()); return; }
      items.forEach((state) => { if (state.active === active) state.toggle(); });
    },
  };
}
