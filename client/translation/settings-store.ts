import { useEffect, useSyncExternalStore } from "react";
import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  TIMELINE_TRANSLATION_SETTINGS,
  timelineTranslationSettingsSchema,
  type TimelineTranslationSettings,
} from "../../shared/timeline-translation";

export const DEFAULT_TIMELINE_TRANSLATION_SETTINGS: TimelineTranslationSettings =
  timelineTranslationSettingsSchema.parse({});

let currentSettings: TimelineTranslationSettings = DEFAULT_TIMELINE_TRANSLATION_SETTINGS;
let registeredClient: Pick<PluginClientContext, "rpc"> | null = null;
let initialLoadStarted = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function sameSettings(a: TimelineTranslationSettings, b: TimelineTranslationSettings): boolean {
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

export function getTranslationSettings(): TimelineTranslationSettings {
  return currentSettings;
}

export function subscribeTranslationSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishTranslationSettings(values: unknown): TimelineTranslationSettings {
  const parsed = timelineTranslationSettingsSchema.parse(values ?? {});
  if (!sameSettings(currentSettings, parsed)) {
    currentSettings = parsed;
    notify();
  }
  return currentSettings;
}

export function resetTranslationSettingsStoreForTests(): void {
  currentSettings = DEFAULT_TIMELINE_TRANSLATION_SETTINGS;
  registeredClient = null;
  initialLoadStarted = false;
  notify();
}

async function readRecord(client: Pick<PluginClientContext, "rpc">): Promise<TimelineTranslationSettings | null> {
  const result: unknown = await client.rpc(settingsRpc(TIMELINE_TRANSLATION_SETTINGS.id).read, {});
  if (!result || typeof result !== "object") return null;
  const record = result as { status?: unknown; values?: unknown };
  if (record.status === "ready") {
    return timelineTranslationSettingsSchema.parse(record.values ?? {});
  }
  return null;
}

export function ensureTranslationSettingsLoaded(): void {
  if (initialLoadStarted || !registeredClient) return;
  initialLoadStarted = true;
  const client = registeredClient;
  readRecord(client)
    .then((parsed) => {
      if (registeredClient === client && parsed) publishTranslationSettings(parsed);
    })
    .catch(() => {
      initialLoadStarted = false;
    });
}

export function useTimelineTranslationSettings(): TimelineTranslationSettings {
  const snapshot = useSyncExternalStore(
    subscribeTranslationSettings,
    getTranslationSettings,
    getTranslationSettings,
  );
  useEffect(() => {
    ensureTranslationSettingsLoaded();
  }, []);
  return snapshot;
}

export function registerTranslationSettingsClient(client: Pick<PluginClientContext, "rpc">): () => void {
  registeredClient = client;
  initialLoadStarted = false;
  return () => {
    if (registeredClient === client) {
      registeredClient = null;
      initialLoadStarted = false;
    }
  };
}

export function watchTranslationSettingsChanges(
  client: Pick<PluginClientContext, "paseo" | "rpc">,
): () => void {
  let live = true;
  let latestRead = 0;
  const read = () => {
    const id = ++latestRead;
    readRecord(client)
      .then((parsed) => {
        if (live && id === latestRead && parsed) publishTranslationSettings(parsed);
      })
      .catch(() => {});
  };
  const observation = client.paseo.observeEvents(["status.plugin_settings_changed"]);
  const unsubscribe = observation.subscribe({
    snapshot() {},
    update(message) {
      if (message.type !== "status") return;
      const { status, settingsId } = message.payload;
      if (status !== "plugin_settings_changed" || settingsId !== TIMELINE_TRANSLATION_SETTINGS.id) return;
      read();
    },
  });
  return () => {
    live = false;
    unsubscribe();
    void observation.release();
  };
}
