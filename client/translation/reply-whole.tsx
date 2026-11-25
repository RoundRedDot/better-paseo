import React, { useEffect, useSyncExternalStore } from "react";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { translationSettingsSync, type TranslationSettingsSnapshot } from "./settings-store";
import { InlineTranslation, InlineTranslateButton, InlineTranslationNotice, type InlineTranslationState } from "./inline";

const hosts = new WeakMap<object, Map<string, { state: InlineTranslationState; settings: TranslationSettingsSnapshot }>>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const release = translationSettingsSync.subscribe(listener);
  return () => { listeners.delete(listener); release(); };
};
const emit = () => { for (const listener of listeners) listener(); };

export function useWholeReplyTranslation(key: string): InlineTranslationState | undefined {
  const host = usePaseo();
  return useSyncExternalStore(subscribe, () => {
    const entry = host ? hosts.get(host)?.get(key) : undefined;
    return entry?.settings === translationSettingsSync.snapshot() ? entry.state : undefined;
  }, () => undefined);
}

export function WholeReplyTranslateButton({ agentId, replyKey, text, theme }: {
  agentId: string; replyKey: string; text: string; theme: PluginTheme;
}) {
  const previous = useWholeReplyTranslation(replyKey);
  return <InlineTranslation agentId={agentId} kind="assistant_message" text={text} streaming={false} initialActive={previous?.active === true && (previous.view?.status === "done" || previous.view?.status === "running")}>
    {(state) => <PublishedReply state={state} replyKey={replyKey} theme={theme} />}
  </InlineTranslation>;
}

function PublishedReply({ state, replyKey, theme }: { state: InlineTranslationState; replyKey: string; theme: PluginTheme }) {
  const host = usePaseo();
  useEffect(() => {
    if (!host) return;
    let entries = hosts.get(host);
    if (!entries) hosts.set(host, entries = new Map());
    if (state.active) entries.set(replyKey, { state, settings: translationSettingsSync.snapshot() });
    else if (!entries.delete(replyKey)) return;
    emit();
  }, [host, replyKey, state.active, state.view]);
  return <><InlineTranslateButton state={state} theme={theme} testID="footer-translate" timeline size={24} />
    <InlineTranslationNotice state={state} theme={theme} /></>;
}
