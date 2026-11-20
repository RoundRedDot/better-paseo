import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SettingsState } from "@getpaseo/plugin/client";
import {
  timelineTranslationSettingsSchema,
  type TIMELINE_TRANSLATION_SETTINGS,
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
  mountedReports = 0;
  hostCopyStale = false;
  refreshing = false;
}

// The host keeps its copy of the record after the last `useSettings` for it
// unmounts, and does not read it again when one mounts (`refetchOnMount:
// false`). A change from another client meanwhile leaves that copy stale, so
// the next hook to mount reads the record before anyone reports it (as the
// preferences do, `preference-sync-slot.tsx`).
let mountedReports = 0;
let hostCopyStale = false;
let refreshing = false;
/** Counts finished reads, so each one renders its hooks again and they report the answer. */
let refreshes = 0;
const refreshListeners = new Set<() => void>();
function subscribeRefresh(listener: () => void) {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}
const readRefreshes = () => refreshes;

/** The daemon changed the record (`plugin_settings_changed`). */
export function noteTranslationSettingsChanged(): void {
  // A mounted hook's own query reads the change.
  if (mountedReports === 0) hostCopyStale = true;
}

/**
 * Reports a `useSettings(TIMELINE_TRANSLATION_SETTINGS)` state to the store:
 * the leading row's settings slot and the settings page both call it.
 */
export function useTranslationSettingsReport(state: SettingsState<typeof TIMELINE_TRANSLATION_SETTINGS.schema>): void {
  const reload = useRef(state.reload);
  reload.current = state.reload;
  const refreshed = useSyncExternalStore(subscribeRefresh, readRefreshes, readRefreshes);
  // Declared before the report below, so a stale cached record is never reported.
  useEffect(() => {
    mountedReports++;
    if (hostCopyStale) {
      hostCopyStale = false;
      refreshing = true;
      const done = () => {
        refreshing = false;
        refreshes++;
        for (const listener of refreshListeners) listener();
      };
      void Promise.resolve().then(() => reload.current()).then(done, done);
    }
    return () => {
      mountedReports--;
    };
  }, []);
  const remote: RemoteTranslationSettings =
    state.status === "ready"
      ? { status: "ready", values: state.values, revision: state.revision }
      : state.status === "invalid"
        ? { status: "invalid", error: state.error, revision: state.revision }
        : state.status === "error"
          ? { status: "error", error: state.error }
          : { status: "loading" };
  const revision = "revision" in remote ? remote.revision : "";
  const error = "error" in remote ? remote.error : "";
  useEffect(() => {
    // A hook mounted in this commit may have started a read.
    if (refreshing) return;
    reportTranslationSettings(remote);
    // `remote` is rebuilt every render; its identity is its status and revision.
  }, [remote.status, revision, error, refreshed]);
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
