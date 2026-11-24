import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TRANSLATION_PROMPT,
  timelineTranslationSettingsSchema,
  translationConfigSignature,
  type TimelineTranslationSettings,
  type TranslationJobState,
} from "../../../shared/timeline-translation";
import { createCredentialStore } from "../../../server/translation/credential";
import { createTimelineTranslator } from "../../../server/translation/service";

/** Plugin-private temp directories, removed by `removeTranslationDirs`. */
const dirs: string[] = [];

export function translationTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-translation-direct-"));
  dirs.push(dir);
  return dir;
}

export function removeTranslationDirs(): void {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
}

export function translationSettings(values: Partial<TimelineTranslationSettings> = {}): TimelineTranslationSettings {
  return timelineTranslationSettingsSchema.parse({
    enabled: true,
    mode: "openai",
    endpoint: "https://api.example.test/v1",
    endpointModel: "test-model",
    targetLanguage: "zh-CN",
    prompt: DEFAULT_TRANSLATION_PROMPT,
    ...values,
  });
}

/** A settings handle that reads `current()` on every call, as the host's does. */
export function settingsHandle(current: () => TimelineTranslationSettings) {
  return {
    read: async () => ({ status: "ready" as const, values: current(), revision: "r1" }),
    subscribe: () => () => {},
  } as never;
}

export function createTranslationEnv(options: {
  settings?: Partial<TimelineTranslationSettings>;
  fetch?: typeof fetch;
  timeoutMs?: number;
} = {}) {
  const dir = translationTempDir();
  const credentialPath = join(dir, "plugin-data", "translation-credential.json");
  const credentials = createCredentialStore(credentialPath);
  let values = translationSettings(options.settings);
  const settings = settingsHandle(() => values);
  const translator = createTimelineTranslator({
    settings,
    credentials,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  });
  let jobs = 0;
  return {
    dir,
    credentialPath,
    credentials,
    translator,
    /** The host settings handle the translator reads. */
    handle: settings,
    get settings() {
      return values;
    },
    setSettings(patch: Partial<TimelineTranslationSettings>) {
      values = translationSettings({ ...values, ...patch });
    },
    /** Starts a job with the signature the client would send, and waits for it to settle. */
    async translate(text: string, sourceKind: "assistant_message" | "user_message" | "reasoning" | "tool_output" = "assistant_message",
      signature = translationConfigSignature(values, "en")): Promise<TranslationJobState> {
      const jobId = `job-${++jobs}`;
      translator.request({ action: "start", jobId, agentId: "agent-1", text, sourceKind, interfaceLanguage: "en", configSignature: signature });
      for (let i = 0; i < 400; i += 1) {
        const state = translator.request({ action: "status", jobId });
        if (state.state !== "running") return state;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Timed out waiting for the translation job");
    },
  };
}
