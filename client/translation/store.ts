import { useCallback, useMemo, useSyncExternalStore } from "react";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import type { PaseoAgent, PaseoAgentListResult, PaseoAgentTimelineHandle, PaseoApi } from "@getpaseo/client";
import {
  translateTimelineItemRpc,
  translationConfigSignature,
  type ConversationAgentModelConfig,
  type TimelineTranslationSettings,
  type TranslateTimelineItemInput,
  type TranslationJobState,
} from "../../shared/timeline-translation";

export type TranslationSourceKind = "assistant_message" | "user_message" | "reasoning" | "tool_output";

export interface TranslationEntry {
  jobId: string;
  sourceKey: string;
  sourceKind: TranslationSourceKind;
  sourceHash: string;
  configSignature: string;
  visible: boolean;
  state: TranslationJobState;
}

export interface TranslationRequestInput {
  sourceKey: string;
  sourceKind: TranslationSourceKind;
  agentId: string;
  text: string;
  interfaceLanguage: "en" | "zh";
  settings: TimelineTranslationSettings;
  agentConfig?: ConversationAgentModelConfig | null;
}

type CallTranslate = (input: TranslateTimelineItemInput) => Promise<TranslationJobState>;
type WatchHelper = (helperId: string, onChunk: () => void) => () => void;

const POLL_MS = 1000;
const MAX_ENTRIES = 500;

export function hashTranslationText(text: string): string {
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2, 33) ^ ch;
  }
  return `${text.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

export function isEntryCurrent(
  entry: TranslationEntry | undefined,
  sourceText: string,
  settings: TimelineTranslationSettings,
  interfaceLanguage: "en" | "zh",
  agentConfig?: ConversationAgentModelConfig | null,
): entry is TranslationEntry {
  if (!entry) return false;
  return (
    entry.sourceHash === hashTranslationText(sourceText) &&
    entry.configSignature === translationConfigSignature(settings, interfaceLanguage, agentConfig)
  );
}

let jobSequence = 0;

export function createTranslationStore() {
  const entries = new Map<string, TranslationEntry>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const setEntry = (entry: TranslationEntry) => {
    if (entries.has(entry.sourceKey)) entries.delete(entry.sourceKey);
    entries.set(entry.sourceKey, entry);
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    notify();
  };

  const isLatestJob = (entry: TranslationEntry): boolean => {
    const current = entries.get(entry.sourceKey);
    return (
      current !== undefined &&
      current.jobId === entry.jobId &&
      current.sourceHash === entry.sourceHash &&
      current.configSignature === entry.configSignature
    );
  };

  const store = {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    read(sourceKey: string): TranslationEntry | undefined {
      return entries.get(sourceKey);
    },

    readValid(
      sourceKey: string,
      sourceText: string,
      settings: TimelineTranslationSettings,
      interfaceLanguage: "en" | "zh",
      agentConfig?: ConversationAgentModelConfig | null,
    ): TranslationEntry | undefined {
      const entry = entries.get(sourceKey);
      return isEntryCurrent(entry, sourceText, settings, interfaceLanguage, agentConfig) ? entry : undefined;
    },

    setVisible(sourceKey: string, visible: boolean): void {
      const current = entries.get(sourceKey);
      if (!current || current.visible === visible) return;
      setEntry({ ...current, visible });
    },

    clearAll(): void {
      if (entries.size === 0) return;
      entries.clear();
      notify();
    },

    startTranslation(
      input: TranslationRequestInput,
      call: CallTranslate,
      watch?: WatchHelper,
    ): void {
      const sourceHash = hashTranslationText(input.text);
      const configSig = translationConfigSignature(input.settings, input.interfaceLanguage, input.agentConfig);
      const jobId = `tl-${++jobSequence}-${Date.now().toString(36)}`;
      const seed: TranslationEntry = {
        jobId,
        sourceKey: input.sourceKey,
        sourceKind: input.sourceKind,
        sourceHash,
        configSignature: configSig,
        visible: true,
        state: { state: "running" },
      };
      setEntry(seed);

      void (async () => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let wake: (() => void) | null = null;
        let unwatch: (() => void) | null = null;
        let watching: string | undefined;

        const pause = () =>
          new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(() => {
              wake = null;
              timer = null;
              resolve();
            }, POLL_MS);
          });

        const nudge = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          const fn = wake;
          wake = null;
          fn?.();
        };

        try {
          let result = await call({
            action: "start",
            agentId: input.agentId,
            text: input.text,
            sourceKind: input.sourceKind,
            interfaceLanguage: input.interfaceLanguage,
            configSignature: configSig,
          });
          let failures = 0;

          // A newer job replaced this one: stop it on the server, which cancels the host request.
          // The server's handle for this job; status and cancel need it.
          const handle = result.state === "running" ? result.handle : undefined;
          const abandon = () => {
            if (handle) void call({ action: "cancel", handle }).catch(() => undefined);
          };
          while (result.state === "running") {
            if (!isLatestJob(seed)) return abandon();
            const current = entries.get(seed.sourceKey);
            if (current && (current.state.state !== "running" || current.state.text !== result.text)) {
              setEntry({ ...current, state: result });
            }
            if (watch && result.helperId && result.helperId !== watching) {
              unwatch?.();
              watching = result.helperId;
              try {
                unwatch = watch(result.helperId, nudge);
              } catch {
                unwatch = null;
              }
            }
            await pause();
            if (!isLatestJob(seed)) return abandon();
            try {
              if (!handle) throw new Error("The translation task has no handle.");
              result = await call({ action: "status", handle });
              failures = 0;
            } catch (error) {
              failures += 1;
              if (failures >= 3) throw error;
            }
          }

          if (!isLatestJob(seed)) return;
          const current = entries.get(seed.sourceKey);
          if (!current) return;
          // Preserve the user's current expand/collapse choice (`current.visible`) across settlement.
          if (result.state === "idle") {
            setEntry({
              ...current,
              state: { state: "error", error: "The translation task was lost. Please retry." },
            });
          } else {
            setEntry({ ...current, state: result });
          }
        } catch (error) {
          if (!isLatestJob(seed)) return;
          const current = entries.get(seed.sourceKey);
          if (!current) return;
          setEntry({
            ...current,
            state: {
              state: "error",
              error: error instanceof Error ? error.message : String(error),
            },
          });
        } finally {
          if (timer) clearTimeout(timer);
          unwatch?.();
        }
      })();
    },
  };

  return store;
}

export const translationStore = createTranslationStore();

export type AgentConfigState =
  | { status: "loading" | "error" }
  | { status: "ready"; config: ConversationAgentModelConfig };

interface AgentConfigEntry {
  listeners: Set<() => void>;
  snapshot: AgentConfigState;
  version: number;
  updatedAt?: string;
}

const AGENT_CONFIG_LOADING: AgentConfigState = { status: "loading" };
const AGENT_CONFIG_ERROR: AgentConfigState = { status: "error" };

export function createTranslationAgentConfigStore(paseo: Pick<PaseoApi, "agents">) {
  const agents = new Map<string, AgentConfigEntry>();
  let stop: (() => void) | undefined;
  let feedStatus: AgentConfigState["status"] = "loading";

  const publish = (entry: AgentConfigEntry, snapshot: AgentConfigState) => {
    if (entry.snapshot === snapshot) return;
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener();
  };

  const apply = (entry: AgentConfigEntry, agent: Pick<PaseoAgent,
    "provider" | "model" | "thinkingOptionId" | "effectiveThinkingOptionId" | "updatedAt">) => {
    entry.updatedAt = agent.updatedAt;
    entry.version += 1;
    const thinkingOptionId = agent.effectiveThinkingOptionId ?? agent.thinkingOptionId ?? null;
    const previous = entry.snapshot.status === "ready" ? entry.snapshot.config : null;
    if (previous?.provider === agent.provider && previous.model === agent.model &&
      previous.thinkingOptionId === thinkingOptionId) return;
    publish(entry, { status: "ready", config: { provider: agent.provider, model: agent.model, thinkingOptionId } });
  };

  const refresh = async (agentId: string, entry: AgentConfigEntry) => {
    const version = ++entry.version;
    publish(entry, AGENT_CONFIG_LOADING);
    const isCurrent = () => agents.get(agentId) === entry && entry.version === version;
    if (!isCurrent()) return;
    try {
      const result = await paseo.agents.ref(agentId).refresh();
      if (!isCurrent()) return;
      if (result) apply(entry, result.agent);
      else publish(entry, AGENT_CONFIG_ERROR);
    } catch {
      if (isCurrent()) publish(entry, AGENT_CONFIG_ERROR);
    }
  };

  const watch = () => {
    let closed = false;
    const pending = new AbortController();
    let subscription: PaseoAgentListResult["subscription"];
    let unobserve: (() => void) | undefined;
    const fail = () => {
      if (closed) return;
      feedStatus = "error";
      for (const entry of agents.values()) {
        if (closed) return;
        entry.version += 1;
        publish(entry, AGENT_CONFIG_ERROR);
      }
    };

    void (async () => {
      // The first page establishes a live feed for the host. A visible agent can be on any page.
      const list = await paseo.agents.list({
        filter: { includeArchived: true }, page: { limit: 1 }, subscribe: {}, signal: pending.signal,
      });
      if (closed) {
        await list.subscription.release();
        return;
      }
      subscription = list.subscription;
      unobserve = subscription.subscribe({
        snapshot: () => {
          if (closed) return;
          feedStatus = "ready";
          for (const [agentId, entry] of agents) void refresh(agentId, entry);
        },
        update: (message) => {
          if (closed || feedStatus !== "ready" || message.type !== "agent_update") return;
          const update = message.payload;
          const entry = agents.get(update.kind === "upsert" ? update.agent.id : update.agentId);
          if (!entry) return;
          if (update.kind === "upsert") {
            if (entry.updatedAt === undefined || update.agent.updatedAt >= entry.updatedAt) apply(entry, update.agent);
          } else {
            entry.version += 1;
            publish(entry, AGENT_CONFIG_ERROR);
          }
        },
        error: fail,
      });
    })().catch(fail);

    return () => {
      closed = true;
      feedStatus = "loading";
      unobserve?.();
      if (subscription) void subscription.release().catch(console.error);
      else pending.abort();
    };
  };

  return {
    read: (agentId: string) => agents.get(agentId)?.snapshot ?? AGENT_CONFIG_LOADING,
    /**
     * Reads a conversation's model again after it failed to load. A failed feed
     * is shared by every row on this host, so it restarts for all of them; a
     * single failed read retries only that conversation.
     */
    retry(agentId: string) {
      const entry = agents.get(agentId);
      if (!entry || entry.snapshot.status !== "error") return;
      if (feedStatus === "error") {
        stop?.();
        stop = undefined;
        for (const each of agents.values()) {
          each.version += 1;
          publish(each, AGENT_CONFIG_LOADING);
        }
        if (agents.size > 0) stop ??= watch();
        return;
      }
      if (feedStatus === "ready") void refresh(agentId, entry);
    },
    subscribe(agentId: string, listener: () => void) {
      let entry = agents.get(agentId);
      if (!entry) {
        entry = {
          listeners: new Set(),
          snapshot: feedStatus === "error" ? AGENT_CONFIG_ERROR : AGENT_CONFIG_LOADING,
          version: 0,
        };
        agents.set(agentId, entry);
        if (feedStatus === "ready") void refresh(agentId, entry);
      }
      entry.listeners.add(listener);
      stop ??= watch();
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) agents.delete(agentId);
        if (agents.size > 0) return;
        stop?.();
        stop = undefined;
      };
    },
  };
}

const agentConfigStores = new WeakMap<PaseoApi, ReturnType<typeof createTranslationAgentConfigStore>>();

export type TranslationAgentConfigStore = ReturnType<typeof createTranslationAgentConfigStore>;

/** One configuration feed per host: every reader on the same `PaseoApi` shares it. */
export function translationAgentConfigStoreFor(paseo: PaseoApi): TranslationAgentConfigStore {
  let store = agentConfigStores.get(paseo);
  if (!store) agentConfigStores.set(paseo, store = createTranslationAgentConfigStore(paseo));
  return store;
}

export function useTranslationAgentConfig(agentId: string, enabled: boolean): AgentConfigState {
  const paseo = usePaseo();
  const store = enabled ? translationAgentConfigStoreFor(paseo) : undefined;
  const subscribe = useCallback(
    (listener: () => void) => store ? store.subscribe(agentId, listener) : () => {},
    [store, agentId],
  );
  const snapshot = useCallback(() => store?.read(agentId) ?? AGENT_CONFIG_LOADING, [store, agentId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

type LiveApi = { agents: { ref(id: string): { timeline: Pick<PaseoAgentTimelineHandle, "subscribe"> } } };

let activePaseoApi: LiveApi | null = null;

export function setTranslationPaseo(api: LiveApi | null): () => void {
  activePaseoApi = api;
  return () => {
    if (activePaseoApi === api) activePaseoApi = null;
  };
}

export function resetTranslationStoreForTests(): void {
  activePaseoApi = null;
  translationStore.clearAll();
}

export function watchTranslationReply(api: LiveApi, helperId: string, onChunk: () => void): () => void {
  const subscription = api.agents.ref(helperId).timeline.subscribe(({ event }) => {
    if (
      event.type === "subscription_restored" ||
      (event.type === "timeline" && "item" in event && event.item.type === "assistant_message")
    ) {
      onChunk();
    }
  });
  subscription.ready?.catch(() => {});
  return () => subscription();
}

export function useTranslationEntry(
  sourceKey: string,
  sourceText: string,
  settings: TimelineTranslationSettings,
  interfaceLanguage: "en" | "zh",
  agentConfig: ConversationAgentModelConfig | null,
): TranslationEntry | undefined {
  const snapshot = useCallback(
    () => settings.customModel || agentConfig
      ? translationStore.readValid(sourceKey, sourceText, settings, interfaceLanguage, agentConfig)
      : undefined,
    [sourceKey, sourceText, settings, interfaceLanguage, agentConfig],
  );
  return useSyncExternalStore(translationStore.subscribe, snapshot, snapshot);
}

export function useTranslateCaller() {
  const call = useRpc(translateTimelineItemRpc);
  return useMemo(() => ({
    call: (input: TranslateTimelineItemInput) => call(input),
    watch: (helperId: string, onChunk: () => void) =>
      activePaseoApi ? watchTranslationReply(activePaseoApi, helperId, onChunk) : () => {},
  }), [call]);
}
