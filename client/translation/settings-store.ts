import { useSyncExternalStore } from "react";
import {
  timelineTranslationSettingsSchema,
  type TimelineTranslationSettings,
} from "../../shared/timeline-translation";

export const DEFAULT_TIMELINE_TRANSLATION_SETTINGS: TimelineTranslationSettings =
  timelineTranslationSettingsSchema.parse({});

export type RemoteTranslationSettings =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "invalid"; error: string; revision: string }
  | { status: "ready"; values: TimelineTranslationSettings; revision: string };

export interface TranslationSettingsSnapshot {
  status: RemoteTranslationSettings["status"];
  values: TimelineTranslationSettings;
  error: string | null;
  revision: string | null;
}

const INITIAL_SNAPSHOT: TranslationSettingsSnapshot = {
  status: "loading",
  values: DEFAULT_TIMELINE_TRANSLATION_SETTINGS,
  error: null,
  revision: null,
};

function sameValues(a: TimelineTranslationSettings, b: TimelineTranslationSettings): boolean {
  return (
    a.enabled === b.enabled &&
    a.customModel === b.customModel &&
    a.disableThinking === b.disableThinking &&
    a.provider === b.provider &&
    a.model === b.model &&
    a.thinkingOptionId === b.thinkingOptionId &&
    a.targetLanguage === b.targetLanguage &&
    a.prompt === b.prompt
  );
}

export function createTranslationSettingsSync() {
  let snapshot: TranslationSettingsSnapshot = INITIAL_SNAPSHOT;
  let lastSeen: string | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    report(state: RemoteTranslationSettings): void {
      const seen =
        state.status === "ready" || state.status === "invalid"
          ? `${state.status}:${state.revision}`
          : state.status === "error"
            ? `error:${state.error}`
            : state.status;
      if (seen === lastSeen) return;
      lastSeen = seen;

      if (state.status === "ready") {
        const parsed = timelineTranslationSettingsSchema.parse(state.values ?? {});
        if (
          snapshot.status === "ready" &&
          snapshot.revision === state.revision &&
          sameValues(snapshot.values, parsed)
        ) {
          return;
        }
        snapshot = {
          status: "ready",
          values: parsed,
          error: null,
          revision: state.revision,
        };
        notify();
        return;
      }

      if (state.status === "invalid") {
        snapshot = {
          status: "invalid",
          values: DEFAULT_TIMELINE_TRANSLATION_SETTINGS,
          error: state.error,
          revision: state.revision,
        };
        notify();
        return;
      }

      if (state.status === "error") {
        snapshot = {
          status: "error",
          values: snapshot.values,
          error: state.error,
          revision: snapshot.revision,
        };
        notify();
        return;
      }

      if (snapshot.status !== "loading") {
        snapshot = INITIAL_SNAPSHOT;
        notify();
      }
    },

    snapshot(): TranslationSettingsSnapshot {
      return snapshot;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    resetForTests(): void {
      snapshot = INITIAL_SNAPSHOT;
      lastSeen = null;
      notify();
    },
  };
}

export const translationSettingsSync = createTranslationSettingsSync();

export function getTranslationSettingsState(): TranslationSettingsSnapshot {
  return translationSettingsSync.snapshot();
}

export function getTranslationSettings(): TimelineTranslationSettings {
  return translationSettingsSync.snapshot().values;
}

export function reportTranslationSettings(state: RemoteTranslationSettings): void {
  translationSettingsSync.report(state);
}

/** Test and story helper to publish a ready settings snapshot cleanly. */
export function publishTranslationSettings(
  values: unknown,
  revision = `local-${Date.now().toString(36)}`,
): TimelineTranslationSettings {
  const parsed = timelineTranslationSettingsSchema.parse(values ?? {});
  translationSettingsSync.report({ status: "ready", values: parsed, revision });
  return parsed;
}

export function resetTranslationSettingsStoreForTests(): void {
  translationSettingsSync.resetForTests();
}

export function useTranslationSettingsState(): TranslationSettingsSnapshot {
  return useSyncExternalStore(
    translationSettingsSync.subscribe,
    translationSettingsSync.snapshot,
    translationSettingsSync.snapshot,
  );
}

export function useTimelineTranslationSettings(): TimelineTranslationSettings {
  return useTranslationSettingsState().values;
}
