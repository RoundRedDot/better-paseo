import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import type { PaseoAgentTimelineHandle } from "@getpaseo/client";
import {
  translateTimelineItemRpc,
  translationConfigSignature,
  type TimelineTranslationSettings,
  type TranslationJobState,
} from "../../shared/timeline-translation";

export type TranslationSourceKind = "assistant_message" | "reasoning";

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
}

type TranslateStartInput = {
  action: "start";
  jobId: string;
  agentId: string;
  text: string;
  sourceKind: TranslationSourceKind;
  interfaceLanguage: "en" | "zh";
};

type TranslateStatusInput = {
  action: "status";
  jobId: string;
};

type CallTranslate = (input: TranslateStartInput | TranslateStatusInput) => Promise<TranslationJobState>;
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

export interface AssistantSourceInput {
  text: string;
  phase?: string;
  blockIndex?: number;
  messageText?: string;
  sourceText?: string;
  sourceId?: string;
  externalSegment?: boolean;
}

export interface ResolvedAssistantSource {
  sourceKey: string;
  sourceText: string;
  sourceAvailable: boolean;
  isMultiBlock: boolean;
  isLeadBlock: boolean;
  isTailBlock: boolean;
}

export function resolveAssistantSource(
  agentId: string,
  data: AssistantSourceInput,
): ResolvedAssistantSource {
  if (data.externalSegment) {
    const sourceText = data.text;
    const base = data.sourceId ?? hashTranslationText(sourceText);
    return {
      sourceKey: `${agentId}:assistant:${base}:seg:${data.blockIndex ?? 0}`,
      sourceText,
      sourceAvailable: true,
      isMultiBlock: false,
      isLeadBlock: true,
      isTailBlock: true,
    };
  }
  const isMultiBlock = data.blockIndex !== undefined;
  const isLeadBlock = !isMultiBlock || data.blockIndex === 0;
  const isTailBlock = !isMultiBlock || data.messageText !== undefined;
  const fullText = isMultiBlock ? (data.messageText ?? data.sourceText) : (data.messageText ?? data.text);
  if (fullText === undefined) {
    // Do not silently fall back to an incomplete block slice when full reply text is absent.
    const base = data.sourceId ?? `incomplete:${data.blockIndex ?? 0}`;
    return {
      sourceKey: `${agentId}:assistant:${base}`,
      sourceText: "",
      sourceAvailable: false,
      isMultiBlock,
      isLeadBlock,
      isTailBlock,
    };
  }
  const base = data.sourceId ?? hashTranslationText(fullText);
  return {
    sourceKey: `${agentId}:assistant:${base}`,
    sourceText: fullText,
    sourceAvailable: true,
    isMultiBlock,
    isLeadBlock,
    isTailBlock,
  };
}

export function resolveReasoningSource(
  agentId: string,
  storeKey: string | undefined,
  text: string,
): { sourceKey: string; sourceText: string } {
  const id = storeKey ? storeKey : hashTranslationText(text);
  return {
    sourceKey: `${agentId}:reasoning:${id}`,
    sourceText: text,
  };
}

export function isEntryCurrent(
  entry: TranslationEntry | undefined,
  sourceText: string,
  settings: TimelineTranslationSettings,
  interfaceLanguage: "en" | "zh",
): entry is TranslationEntry {
  if (!entry) return false;
  return (
    entry.sourceHash === hashTranslationText(sourceText) &&
    entry.configSignature === translationConfigSignature(settings, interfaceLanguage)
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
    ): TranslationEntry | undefined {
      const entry = entries.get(sourceKey);
      return isEntryCurrent(entry, sourceText, settings, interfaceLanguage) ? entry : undefined;
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
      const configSig = translationConfigSignature(input.settings, input.interfaceLanguage);
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
            jobId,
            agentId: input.agentId,
            text: input.text,
            sourceKind: input.sourceKind,
            interfaceLanguage: input.interfaceLanguage,
          });
          let failures = 0;

          while (result.state === "running") {
            if (!isLatestJob(seed)) return;
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
            if (!isLatestJob(seed)) return;
            try {
              result = await call({ action: "status", jobId });
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
): TranslationEntry | undefined {
  const snapshot = useCallback(
    () => translationStore.readValid(sourceKey, sourceText, settings, interfaceLanguage),
    [sourceKey, sourceText, settings, interfaceLanguage],
  );
  return useSyncExternalStore(translationStore.subscribe, snapshot, snapshot);
}

export function useTranslateCaller() {
  const call = useRpc(translateTimelineItemRpc);
  return useMemo(() => ({
    call: (input: TranslateStartInput | TranslateStatusInput) => call(input),
    watch: (helperId: string, onChunk: () => void) =>
      activePaseoApi ? watchTranslationReply(activePaseoApi, helperId, onChunk) : () => {},
  }), [call]);
}
