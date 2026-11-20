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
  hostCopies.clear();
  reader = null;
  latestRead = 0;
  unconfirmed = false;
  readFailed = false;
  confirmedRevision = null;
}

// A `plugin_settings_changed` push carries no revision, and revisions are
// content hashes with no order. What the host's `useSettings` reports can be
// older than the latest push: its first read joins a request sent before the
// push (react-query shares an in-flight fetch while it has no data, for an
// invalidation and a refetch alike), a save can report its own record late,
// and a copy retained while no hook was mounted is not read again on mount
// (`refetchOnMount: false`). A read this client sends after it received the
// push is answered after the daemon stored that change (the daemon serializes
// settings work and pushes after it writes), so only such a read confirms a
// record. Until it answers the store is loading (error if it fails); host
// reports wait for it and are shown only when they agree with it.

// `read` is the latest read when the hook last reported: the host had
// answered by then, so a different revision then is an older copy.
type HostCopy = { revision: string | null; read: number; reload: () => Promise<void> };
const hostCopies = new Set<HostCopy>();
let reader: (() => Promise<unknown>) | null = null;
let latestRead = 0;
// The latest read has not answered a record yet (or failed).
let unconfirmed = false;
let readFailed = false;
// The revision the latest read answered.
let confirmedRevision: string | null = null;

type SettingsRecord = Extract<RemoteTranslationSettings, { revision: string }>;

function readResult(result: unknown): SettingsRecord | null {
  if (!result || typeof result !== "object") return null;
  const read = result as { status?: unknown; revision?: unknown; values?: unknown; error?: unknown };
  if (typeof read.revision !== "string") return null;
  if (read.status === "invalid") return { status: "invalid", error: String(read.error ?? ""), revision: read.revision };
  if (read.status !== "ready") return null;
  const parsed = timelineTranslationSettingsSchema.safeParse(read.values ?? {});
  return parsed.success
    ? { status: "ready", values: parsed.data, revision: read.revision }
    : { status: "invalid", error: parsed.error.message, revision: read.revision };
}

/** Reads the record; only the latest read reports, an earlier one may answer last. */
function readRecord(): void {
  const read = reader;
  if (!read) return;
  const id = ++latestRead;
  unconfirmed = true;
  readFailed = false;
  // The values held now may be out of date: no translation starts or reuses
  // a result under them until this read answers, mounted hook or not.
  translationSettingsSync.report({ status: "loading" });
  new Promise<unknown>((resolve) => resolve(read()))
    .then((result) => {
      if (id !== latestRead) return;
      const record = readResult(result);
      if (!record) throw new Error("The daemon answered no translation settings record");
      unconfirmed = false;
      confirmedRevision = record.revision;
      reportTranslationSettings(record);
      // A host copy reported since this read began is older: read it again,
      // so the settings page shows and saves against the record. A copy not
      // reported since is still being read and reports to `hostReported`.
      // One query, so one reload is enough.
      for (const copy of hostCopies) {
        if (copy.read !== id || copy.revision === null || copy.revision === record.revision) continue;
        copy.reload().catch(() => {
          // The hook reports the host's own error; the record stands.
        });
        break;
      }
    })
    .catch((error: unknown) => {
      if (id !== latestRead) return;
      readFailed = true;
      reportTranslationSettings({ status: "error", error: error instanceof Error ? error.message : String(error) });
    });
}

/** The daemon changed the record (`plugin_settings_changed`); `read` reads it through the settings RPC. */
export function noteTranslationSettingsChanged(read: () => Promise<unknown>): void {
  reader = read;
  readRecord();
}

function hostReported(remote: RemoteTranslationSettings): void {
  if (unconfirmed) {
    // A host report is the next chance to retry a failed read.
    if (readFailed) readRecord();
    return;
  }
  if (confirmedRevision !== null) {
    // The host's loading or error state does not undo the confirmed record.
    if (remote.status !== "ready" && remote.status !== "invalid") return;
    // Older (stale copy) or newer (a save before its push): read to decide.
    if (remote.revision !== confirmedRevision) {
      readRecord();
      return;
    }
  }
  reportTranslationSettings(remote);
}

/**
 * Reports a `useSettings(TIMELINE_TRANSLATION_SETTINGS)` state to the store:
 * the leading row's settings slot and the settings page both call it.
 */
export function useTranslationSettingsReport(state: SettingsState<typeof TIMELINE_TRANSLATION_SETTINGS.schema>): void {
  const latest = useRef(state);
  latest.current = state;
  const copy = useRef<HostCopy | null>(null);
  // Declared before the report below, so the copy is registered when it runs.
  useEffect(() => {
    const entry: HostCopy = { revision: null, read: 0, reload: () => latest.current.reload() };
    copy.current = entry;
    hostCopies.add(entry);
    return () => {
      hostCopies.delete(entry);
      copy.current = null;
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
    const entry = copy.current;
    if (entry) entry.revision = "revision" in remote ? remote.revision : null;
    hostReported(remote);
    if (entry) entry.read = latestRead;
    // `remote` is rebuilt every render; its identity is its status and revision.
  }, [remote.status, revision, error]);
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
