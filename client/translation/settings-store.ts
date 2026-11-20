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
  pendingChange = null;
  activeReload = null;
  reloadCompleted = false;
  failedRevision = undefined;
}

// The host keeps its copy of the record after the last `useSettings` for it
// unmounts, and does not read it again when one mounts (`refetchOnMount:
// false`). A change from another client meanwhile leaves that copy stale, so
// the next hook to mount reads the record before anyone reports it (as the
// preferences do, `preference-sync-slot.tsx`).
let mountedReports = 0;
let hostCopyStale = false;
type SettingsRevision = { status: "ready" | "invalid"; revision: string };
// A push has no revision. A host report can still be from an earlier read
// or save, so only acknowledge the record confirmed for the latest push.
let pendingChange: { confirmed?: SettingsRevision } | null = null;
let activeReload: object | null = null;
let reloadCompleted = false;
let failedRevision: string | null | undefined;
let refreshes = 0;
const refreshListeners = new Set<() => void>();
function subscribeRefresh(listener: () => void) {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}
const readRefreshes = () => refreshes;
function notifyRefresh() {
  refreshes++;
  for (const listener of refreshListeners) listener();
}

function acknowledgeChange(record: Pick<TranslationSettingsSnapshot, "status" | "revision">): void {
  const confirmed = pendingChange?.confirmed;
  if (confirmed && confirmed.status === record.status && confirmed.revision === record.revision) {
    pendingChange = null;
  }
}

/** The daemon changed the record (`plugin_settings_changed`). */
export function noteTranslationSettingsChanged(read?: () => Promise<SettingsRevision>): void {
  const change: NonNullable<typeof pendingChange> = {};
  pendingChange = change;
  if (activeReload || reloadCompleted) {
    // This push can replace the host's refetch. Only the new read may report.
    activeReload = null;
    reloadCompleted = false;
    hostCopyStale = true;
    notifyRefresh();
  }
  if (mountedReports === 0) {
    hostCopyStale = true;
    // No translation starts or reuses a result until a hook reads the record.
    translationSettingsSync.report({ status: "loading" });
    return;
  }
  if (read && !hostCopyStale) {
    void read().then((record) => {
      if (pendingChange !== change) return;
      change.confirmed = record;
      // A same-revision refetch may not cause the hook to report again.
      acknowledgeChange(translationSettingsSync.snapshot());
    }, () => {
      // The settings hook still owns the read and reports its own errors.
    });
  }
}

/**
 * Reports a `useSettings(TIMELINE_TRANSLATION_SETTINGS)` state to the store:
 * the leading row's settings slot and the settings page both call it.
 */
export function useTranslationSettingsReport(state: SettingsState<typeof TIMELINE_TRANSLATION_SETTINGS.schema>): void {
  const latest = useRef(state);
  latest.current = state;
  const refreshed = useSyncExternalStore(subscribeRefresh, readRefreshes, readRefreshes);
  useEffect(() => {
    mountedReports++;
    return () => {
      if (--mountedReports !== 0 || !pendingChange) return;
      hostCopyStale = true;
      activeReload = null;
      reloadCompleted = false;
      translationSettingsSync.report({ status: "loading" });
    };
  }, []);
  // Start before the report effect so a new observer can't publish its cached copy.
  useEffect(() => {
    if (!hostCopyStale) return;
    hostCopyStale = false;
    failedRevision = undefined;
    const read = {};
    activeReload = read;
    const revision = "revision" in latest.current ? latest.current.revision : null;
    void Promise.resolve().then(() => {
      if (activeReload === read) return latest.current.reload();
    }).then(
      () => {
        if (activeReload !== read) return;
        activeReload = null;
        // The host reload returns void, including on query failure. Render
        // again to observe its current ready, invalid or error result.
        reloadCompleted = true;
        notifyRefresh();
      },
      (error: unknown) => {
        if (activeReload !== read) return;
        activeReload = null;
        failedRevision = revision;
        reportTranslationSettings({ status: "error", error: error instanceof Error ? error.message : String(error) });
      },
    );
  }, [refreshed]);
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
    if (hostCopyStale || activeReload) return;
    if (remote.status === "ready" || remote.status === "invalid") {
      if (remote.revision === failedRevision) return;
      if (reloadCompleted) pendingChange = null;
      else acknowledgeChange(remote);
    }
    reloadCompleted = false;
    failedRevision = undefined;
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
