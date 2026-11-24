import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import {
  translateTimelineItemRpc,
  translationConfigSignature,
  type TimelineTranslationSettings,
  type TranslateTimelineItemInput,
  type TranslationJobState,
} from "../../shared/timeline-translation";
import { FREE_SERVICE_INFO, translateFree } from "../../shared/free-translation";
import { resolveTranslationTarget } from "../../shared/translation-languages";

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
}

type CallTranslate = (input: TranslateTimelineItemInput) => Promise<TranslationJobState>;

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
): entry is TranslationEntry {
  if (!entry) return false;
  return (
    entry.sourceHash === hashTranslationText(sourceText) &&
    entry.configSignature === translationConfigSignature(settings, interfaceLanguage)
  );
}

let jobSequence = 0;

type TranslateFree = typeof translateFree;

/** Free mode: the client asks the service itself; there is no daemon job to poll. */
async function translateLocally(input: TranslationRequestInput, free: TranslateFree): Promise<TranslationJobState> {
  const target = resolveTranslationTarget(input.settings.targetLanguage, input.interfaceLanguage);
  const { translation, service } = await free({ service: input.settings.freeService, text: input.text, targetCode: target.code });
  return {
    state: "done",
    translation,
    targetLanguageCode: target.code,
    origin: FREE_SERVICE_INFO[service].origin,
    model: FREE_SERVICE_INFO[service].name,
  };
}

export function createTranslationStore(deps: { translateFree?: TranslateFree } = {}) {
  const free = deps.translateFree ?? translateFree;
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

        const pause = () =>
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              timer = null;
              resolve();
            }, POLL_MS);
          });

        try {
          let result = input.settings.mode === "free" ? await translateLocally(input, free) : await call({
            action: "start",
            jobId,
            agentId: input.agentId,
            text: input.text,
            sourceKind: input.sourceKind,
            interfaceLanguage: input.interfaceLanguage,
            configSignature: configSig,
          });
          let failures = 0;

          while (result.state === "running") {
            if (!isLatestJob(seed)) return;
            const current = entries.get(seed.sourceKey);
            if (current && (current.state.state !== "running" || current.state.text !== result.text)) {
              setEntry({ ...current, state: result });
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
        }
      })();
    },
  };

  return store;
}

export const translationStore = createTranslationStore();

export function resetTranslationStoreForTests(): void {
  translationStore.clearAll();
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
    call: (input: TranslateTimelineItemInput) => call(input),
  }), [call]);
}
