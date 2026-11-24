import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRANSLATION_PROMPT,
  PREVIOUS_DEFAULT_TRANSLATION_PROMPTS,
  resolveThinkingCapability,
  timelineTranslationSettingsSchema,
  translateTimelineItemRpc,
  translationConfigSignature,
  type ConversationAgentModelConfig,
  type TimelineTranslationSettings,
} from "../../shared/translation-helper-legacy";
import {
  appendTranslationChunk,
  buildTranslationPrompt,
  createTimelineTranslator,
} from "../../server/translation/helper-service";
import type { PaseoApi } from "../../server/paseo-types";

// Codex helpers read the user's Codex config; keep tests off the real one.
beforeEach(() => { vi.stubEnv("CODEX_HOME", "/nonexistent/better-paseo-test-codex-home"); });
afterEach(() => { vi.unstubAllEnvs(); });

vi.mock("@getpaseo/plugin/client", () => ({ useRpc: vi.fn() }));

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "paseo-tl-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createMockEnv(options?: {
  settings?: Partial<TimelineTranslationSettings>;
  provider?: string;
  model?: string;
  thinkingOptions?: Array<{ id: string; label: string }>;
  agentThinkingId?: string | null;
  refreshAgent?: () => Promise<ConversationAgentModelConfig>;
  runResult?: { status: string; lastMessage?: string | null; error?: string | null };
  streamChunks?: Array<{ text: string; messageId?: string }>;
  throwOnRun?: boolean;
  createAgentError?: Error;
  archiveResult?: { error: string | null };
  providerEntries?: Array<{ provider: string; enabled: boolean; status: string; modes?: unknown[] }>;
  listModes?: (provider: string) => Promise<{ modes?: unknown[]; error?: string | null }>;
  firstRunResult?: { status: string; final?: unknown; lastMessage?: string | null; error?: string | null };
}) {
  const dir = makeTempDir();
  const parsed = timelineTranslationSettingsSchema.parse({
    enabled: true,
    customModel: false,
    disableThinking: true,
    targetLanguage: "zh-CN",
    prompt: DEFAULT_TRANSLATION_PROMPT,
    ...options?.settings,
  });

  const provider = options?.provider ?? "claude";
  const model = options?.model ?? "claude-sonnet-4-5";
  const captured: {
    prompts: string[];
    workspaceInputs: unknown[];
    agentConfigs: unknown[];
    archived: number;
    deletedHelpers: string[];
    touchedSourceTimeline: boolean;
    listModesCalls: string[];
    permissionResponses: unknown[];
  } = {
    prompts: [],
    workspaceInputs: [],
    agentConfigs: [],
    archived: 0,
    deletedHelpers: [],
    touchedSourceTimeline: false,
    listModesCalls: [],
    permissionResponses: [],
  };

  const paseo = {
    agents: {
      ref(id: string) {
        if (id === "source-agent-1") {
          return {
            async refresh() {
              return {
                agent: {
                  id: "source-agent-1",
                  provider,
                  model,
                  cwd: "/secret/user/project-should-not-load",
                  effectiveThinkingOptionId: options?.agentThinkingId ?? null,
                  thinkingOptionId: options?.agentThinkingId ?? null,
                  ...await options?.refreshAgent?.(),
                },
                project: { projectKey: "proj-1" },
              };
            },
            get timeline() {
              captured.touchedSourceTimeline = true;
              throw new Error("Privacy violation: source agent timeline must never be read");
            },
          };
        }
        throw new Error(`Unexpected agent ref: ${id}`);
      },
    },
    providers: {
      async snapshot() {
        return {
          entries: options?.providerEntries ?? [
            { provider, enabled: true, status: "ready" },
          ],
        };
      },
      async listModes(reqProvider: string) {
        captured.listModesCalls.push(reqProvider);
        return options?.listModes?.(reqProvider) ?? { modes: [{ id: "ask", label: "Always Ask", colorTier: "safe" }], error: null };
      },
      async listModels(reqProvider: string) {
        return {
          error: null,
          models: [
            {
              id: model,
              label: model,
              thinkingOptions: options?.thinkingOptions ?? [
                { id: "off", label: "Off" },
                { id: "high", label: "High" },
              ],
              defaultThinkingOptionId: "high",
            },
            ...(reqProvider === "alt"
              ? [{
                  id: "alt-model",
                  label: "Alt Model",
                  thinkingOptions: [
                    { id: "low", label: "Low" },
                    { id: "high", label: "High" },
                  ],
                  defaultThinkingOptionId: "high",
                }]
              : []),
          ],
        };
      },
    },
    workspaces: {
      async create(wsInput: unknown) {
        captured.workspaceInputs.push(wsInput);
        return {
          async archive() {
            captured.archived += 1;
            return { requestId: "archive-1", workspaceId: "ws-1", archivedAt: options?.archiveResult?.error ? null : "2026-11-20T00:00:00.000Z", error: null, ...options?.archiveResult };
          },
          agents: {
            async create(agentInput: unknown) {
              captured.agentConfigs.push(agentInput);
              if (options?.createAgentError) throw options.createAgentError;
              const handlers: Array<(event: unknown) => void> = [];
              return {
                id: "helper-agent-1",
                async waitForFinish() {
                  return options?.runResult ?? { status: "idle", lastMessage: "你好世界" };
                },
                async respondToPermission(input: unknown) {
                  captured.permissionResponses.push(input);
                },
                async refresh() {
                  return null;
                },
                timeline: {
                  subscribe(cb: (event: unknown) => void) {
                    handlers.push(cb);
                    return Object.assign(() => {}, { ready: Promise.resolve() });
                  },
                },
                async run(prompt: string) {
                  captured.prompts.push(prompt);
                  for (const chunk of options?.streamChunks ?? []) {
                    for (const cb of handlers) {
                      cb({
                        event: {
                          type: "timeline",
                          item: {
                            type: "assistant_message",
                            text: chunk.text,
                            messageId: chunk.messageId,
                          },
                        },
                      });
                    }
                  }
                  if (options?.throwOnRun) {
                    throw new Error("model crashed");
                  }
                  if (options?.firstRunResult) return options.firstRunResult;
                  return options?.runResult ?? {
                    status: "idle",
                    lastMessage: "你好世界",
                  };
                },
              };
            },
          },
        };
      },
    },
  };

  const translator = createTimelineTranslator({
    settings: {
      id: "timeline-translation",
      async read() {
        return { status: "ready", values: parsed, revision: "rev-1" };
      },
    } as never,
    async deleteHelper(agentId: string) {
      captured.deletedHelpers.push(agentId);
    },
    directory: dir,
    timeoutMs: 5000,
  });

  const configSignature = translationConfigSignature(parsed, "en", {
    provider,
    model,
    thinkingOptionId: options?.agentThinkingId,
  });
  return { translator, paseo: paseo as unknown as PaseoApi, captured, dir, settings: parsed, configSignature };
}

async function waitForJob(
  translator: ReturnType<typeof createTimelineTranslator>,
  paseo: PaseoApi,
  jobId: string,
) {
  for (let i = 0; i < 40; i += 1) {
    const state = await translator.request({ action: "status", jobId }, paseo);
    if (state.state !== "running") return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for job");
}

describe("timeline translation server service", () => {
  it("rejects a stale settings snapshot even when the model and target are unchanged", async () => {
    const { translator, paseo, captured, settings } = createMockEnv();
    const configSignature = translationConfigSignature(
      { ...settings, prompt: "Use the previous translation instructions." },
      "en",
      { provider: "claude", model: "claude-sonnet-4-5" },
    );
    translator.request({
      action: "start",
      jobId: "job-stale-prompt",
      agentId: "source-agent-1",
      text: "Original text",
      sourceKind: "assistant_message",
      interfaceLanguage: "en",
      configSignature,
    }, paseo);
    expect(await waitForJob(translator, paseo, "job-stale-prompt")).toEqual({
      state: "error", error: "Translation configuration changed. Please retry.",
    });
    expect(captured.workspaceInputs).toHaveLength(0);
  });

  it("never accesses source timeline, isolates helper workspace, and sends only selected content", async () => {
    const { translator, paseo, captured, dir, configSignature } = createMockEnv({
      streamChunks: [
        { text: "你好", messageId: "m1" },
        { text: "世界", messageId: "m1" },
      ],
    });

    const start = await translator.request(
      {
        action: "start",
        jobId: "job-privacy",
        agentId: "source-agent-1",
        text: "Hello **world**\n\n`npm test`",
        sourceKind: "assistant_message",
        interfaceLanguage: "en",
        configSignature,
      },
      paseo,
    );
    expect(start.state).toBe("running");

    const done = await waitForJob(translator, paseo, "job-privacy");
    expect(done).toMatchObject({
      state: "done",
      translation: "你好世界",
      targetLanguageCode: "zh-CN",
      provider: "claude",
      model: "claude-sonnet-4-5",
      thinkingMode: "disabled",
      thinkingOptionId: "off",
    });

    expect(captured.touchedSourceTimeline).toBe(false);
    expect(captured.workspaceInputs).toHaveLength(1);
    expect(captured.workspaceInputs[0]).toMatchObject({
      background: true,
      source: { kind: "directory", path: dir },
    });
    expect(JSON.stringify(captured.workspaceInputs[0])).not.toContain("/secret/user/project-should-not-load");
    expect(captured.prompts).toHaveLength(1);
    expect(captured.prompts[0]).toContain("Hello **world**\n\n`npm test`");
    expect(captured.prompts[0]).toContain("zh-CN");
    expect(captured.prompts[0]).not.toContain("secret");
    expect(captured.archived).toBe(1);
    expect(captured.deletedHelpers).toEqual(["helper-agent-1"]);
  });

  it("translates selected tool output without reading the conversation", async () => {
    const { translator, paseo, captured, configSignature } = createMockEnv();
    const text = "js execution timed out; kernel reset";
    const request = translateTimelineItemRpc.input.parse({
      action: "start", jobId: "tool-selection", agentId: "source-agent-1", text,
      sourceKind: "tool_output", interfaceLanguage: "en", configSignature,
    });
    await translator.request(request, paseo);
    expect((await waitForJob(translator, paseo, "tool-selection")).state).toBe("done");
    expect(captured.prompts).toHaveLength(1);
    expect(captured.prompts[0]).toContain(`Source kind: tool output\n\nText to translate:\n${text}`);
    expect(captured.touchedSourceTimeline).toBe(false);
  });

  it("translates a selected user message without reading the conversation", async () => {
    const { translator, paseo, captured, configSignature } = createMockEnv();
    const text = "Please check the logs.";
    const request = translateTimelineItemRpc.input.parse({
      action: "start", jobId: "user-selection", agentId: "source-agent-1", text,
      sourceKind: "user_message", interfaceLanguage: "en", configSignature,
    });
    await translator.request(request, paseo);
    expect((await waitForJob(translator, paseo, "user-selection")).state).toBe("done");
    expect(captured.prompts[0]).toContain(`Source kind: user message\n\nText to translate:\n${text}`);
    expect(captured.touchedSourceTimeline).toBe(false);
  });

  it("recognizes only off, none, and disabled as genuine thinking-off options", () => {
    expect(resolveThinkingCapability([{ id: "off", label: "Off" }]).status).toBe("supported");
    expect(resolveThinkingCapability([{ id: "none", label: "None" }]).status).toBe("supported");
    expect(resolveThinkingCapability([{ id: "disabled", label: "Disabled" }]).status).toBe("supported");
    expect(resolveThinkingCapability([{ id: "minimal", label: "Minimal" }, { id: "low", label: "Low" }]).status).toBe("unsupported_off");
    expect(resolveThinkingCapability([]).status).toBe("none");
  });

  it("does not silently downgrade thinking when model lacks off/none/disabled", async () => {
    const { translator, paseo, captured, configSignature } = createMockEnv({
      thinkingOptions: [
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
      agentThinkingId: "high",
    });

    await translator.request(
      {
        action: "start",
        jobId: "job-no-off",
        agentId: "source-agent-1",
        text: "Reasoning trace",
        sourceKind: "reasoning",
        interfaceLanguage: "en",
        configSignature,
      },
      paseo,
    );
    const done = await waitForJob(translator, paseo, "job-no-off");
    expect(done).toMatchObject({
      state: "done",
      thinkingMode: "unsupported_off",
      thinkingOptionId: "high",
    });
    const config = (captured.agentConfigs[0] as { config: { thinkingOptionId?: string } }).config;
    expect(config.thinkingOptionId).toBe("high");
    expect(config.thinkingOptionId).not.toBe("minimal");
    expect(config.thinkingOptionId).not.toBe("low");
  });

  it("handles models with no thinking options honestly", async () => {
    const { translator, paseo, captured, configSignature } = createMockEnv({
      thinkingOptions: [],
    });

    await translator.request(
      {
        action: "start",
        jobId: "job-none-cap",
        agentId: "source-agent-1",
        text: "Short text",
        sourceKind: "assistant_message",
        interfaceLanguage: "en",
        configSignature,
      },
      paseo,
    );
    const done = await waitForJob(translator, paseo, "job-none-cap");
    expect(done).toMatchObject({
      state: "done",
      thinkingMode: "none",
      thinkingOptionId: null,
    });
    const config = (captured.agentConfigs[0] as { config: { thinkingOptionId?: string } }).config;
    expect(config.thinkingOptionId).toBeUndefined();
  });

  it("cleans up workspace and helper even when helper run fails", async () => {
    const { translator, paseo, captured, configSignature } = createMockEnv({
      throwOnRun: true,
    });

    await translator.request(
      {
        action: "start",
        jobId: "job-fail",
        agentId: "source-agent-1",
        text: "Failure path test",
        sourceKind: "assistant_message",
        interfaceLanguage: "en",
        configSignature,
      },
      paseo,
    );
    const settled = await waitForJob(translator, paseo, "job-fail");
    expect(settled).toEqual({ state: "error", error: "model crashed" });
    expect(captured.archived).toBe(1);
    expect(captured.deletedHelpers).toEqual(["helper-agent-1"]);
  });

  it("reports an archive the daemon answered with an error and keeps the helper", async () => {
    // The daemon's archive_workspace_response carries the failure in `error`; the SDK resolves it.
    const { translator, paseo, captured, configSignature } = createMockEnv({
      archiveResult: { error: "workspace is busy" },
    });
    await translator.request({
      action: "start", jobId: "job-archive", agentId: "source-agent-1", text: "Archive path",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature,
    }, paseo);
    const settled = await waitForJob(translator, paseo, "job-archive");
    expect(settled).toEqual({ state: "error", error: "Could not archive the translation helper: workspace is busy" });
    expect(captured.archived).toBe(1);
    expect(captured.deletedHelpers).toEqual([]);
  });

  it("names the target language once in the prompt it sends", async () => {
    const { translator, paseo, captured, configSignature } = createMockEnv();
    await translator.request({
      action: "start", jobId: "job-prompt", agentId: "source-agent-1", text: "Hello",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature,
    }, paseo);
    await waitForJob(translator, paseo, "job-prompt");
    expect(captured.prompts[0]).toContain("Target language: Simplified Chinese / 简体中文 (zh-CN)\nSource kind:");
  });

  it("passes the conversation's own thinking option on when the catalog does not list it", async () => {
    const { translator, paseo, captured, configSignature } = createMockEnv({
      settings: { disableThinking: false },
      agentThinkingId: "default",
      thinkingOptions: [{ id: "low", label: "Low" }, { id: "high", label: "High" }],
    });
    await translator.request({
      action: "start", jobId: "job-inherit", agentId: "source-agent-1", text: "Hello",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature,
    }, paseo);
    expect(await waitForJob(translator, paseo, "job-inherit")).toMatchObject({ state: "done", thinkingMode: "inherited", thinkingOptionId: "default" });
    expect((captured.agentConfigs[0] as { config: { thinkingOptionId?: string } }).config.thinkingOptionId).toBe("default");
  });

  it("rejects translation when disabled in settings", async () => {
    const { translator, paseo, configSignature } = createMockEnv({
      settings: { enabled: false },
    });
    await translator.request(
      {
        action: "start",
        jobId: "job-disabled",
        agentId: "source-agent-1",
        text: "Disabled check",
        sourceKind: "assistant_message",
        interfaceLanguage: "en",
        configSignature,
      },
      paseo,
    );
    const settled = await waitForJob(translator, paseo, "job-disabled");
    expect(settled.state).toBe("error");
    if (settled.state === "error") {
      expect(settled.error).toContain("disabled");
    }
  });

  it("accumulates streaming chunks and builds bounded source prompts", () => {
    let sofar: { text: string; messageId?: string } = { text: "" };
    sofar = appendTranslationChunk(sofar, {
      event: { type: "timeline", item: { type: "assistant_message", text: "Hello ", messageId: "m1" } },
    } as never)!;
    sofar = appendTranslationChunk(sofar, {
      event: { type: "timeline", item: { type: "assistant_message", text: "world", messageId: "m1" } },
    } as never)!;
    expect(sofar.text).toBe("Hello world");

    const restarted = appendTranslationChunk(sofar, {
      event: { type: "timeline", item: { type: "assistant_message", text: "Fresh", messageId: "m2" } },
    } as never)!;
    expect(restarted.text).toBe("Fresh");

    const prompt = buildTranslationPrompt("Translate", "Japanese / 日本語 (ja)", "reasoning", "Step 1");
    // The target names its code once (`resolveTranslationTarget().promptTarget`).
    expect(prompt).toContain("Target language: Japanese / 日本語 (ja)\n");
    expect(prompt.match(/\(ja\)/g)).toHaveLength(1);
    expect(prompt).toContain("Source kind: assistant reasoning");
    expect(prompt).toContain("Step 1");
  });
});

describe("default timeline translation prompt", () => {
  const legacyDefault =
    "Translate the supplied text into the target language. Preserve Markdown, code blocks, inline code, commands, paths, links, and technical identifiers. Return only the translation, without explanations.";

  it("reads an untouched earlier default as the current default and keeps every other prompt", () => {
    expect(PREVIOUS_DEFAULT_TRANSLATION_PROMPTS).toEqual([legacyDefault]);
    const promptOf = (values: unknown) => timelineTranslationSettingsSchema.parse(values).prompt;
    expect(promptOf({})).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(promptOf({ prompt: "   " })).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(promptOf({ prompt: legacyDefault })).toBe(DEFAULT_TRANSLATION_PROMPT);
    // The schema already trims every prompt, so surrounding whitespace is not an edit.
    expect(promptOf({ prompt: `\n${legacyDefault}  ` })).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(promptOf({ prompt: DEFAULT_TRANSLATION_PROMPT })).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(promptOf({ prompt: "Keep it terse." })).toBe("Keep it terse.");
    const extended = `${legacyDefault} Use a formal register.`;
    expect(promptOf({ prompt: extended })).toBe(extended);
    expect(promptOf({ prompt: legacyDefault.replace("Return only", "Return just") })).toBe(
      legacyDefault.replace("Return only", "Return just"),
    );
  });

  it("binds translations to the mapped prompt on both client and server", async () => {
    const mapped = timelineTranslationSettingsSchema.parse({ prompt: legacyDefault });
    const fresh = timelineTranslationSettingsSchema.parse({});
    expect(translationConfigSignature(mapped, "en")).toBe(translationConfigSignature(fresh, "en"));
    // A translation cached by a build that still used the earlier default no longer matches.
    expect(translationConfigSignature({ ...mapped, prompt: legacyDefault }, "en")).not.toBe(
      translationConfigSignature(mapped, "en"),
    );

    const { translator, paseo, captured, configSignature } = createMockEnv({ settings: { prompt: legacyDefault } });
    await translator.request({
      action: "start", jobId: "job-legacy-default", agentId: "source-agent-1", text: "Run `npm test`.",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature,
    }, paseo);
    expect((await waitForJob(translator, paseo, "job-legacy-default")).state).toBe("done");
    expect(captured.prompts[0]!.startsWith(`${DEFAULT_TRANSLATION_PROMPT}\n\nTarget language:`)).toBe(true);
    expect(captured.prompts[0]).not.toContain("Translate the supplied text");
  });
});

describe("dormant ordinary translation helpers", () => {
  it("translates with the conversation provider when the host has no tool-free API", async () => {
    const env = createMockEnv();
    env.translator.request({ action: "start", jobId: "ordinary-inherited", agentId: "source-agent-1", text: "Hello",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature: env.configSignature }, env.paseo);
    expect(await waitForJob(env.translator, env.paseo, "ordinary-inherited")).toMatchObject({ state: "done", translation: "你好世界", provider: "claude" });
    const created = env.captured.agentConfigs[0] as { config: Record<string, unknown> };
    expect(created.config.provider).toBe("claude/claude-sonnet-4-5");
    expect(created.config).not.toHaveProperty("toolPolicy");
    expect(created.config.systemPrompt).toContain("Do not use tools");
    expect(env.captured.prompts[0]).toContain("Hello");
    expect(env.captured.archived).toBe(1);
    expect(env.captured.deletedHelpers).toEqual(["helper-agent-1"]);
  });

  it("uses the chosen provider without silently switching models", async () => {
    const env = createMockEnv({ settings: { customModel: true, provider: "alt", model: "alt-model" },
      providerEntries: [
        { provider: "claude", enabled: true, status: "ready" },
        { provider: "alt", enabled: true, status: "ready" },
      ] });
    env.translator.request({ action: "start", jobId: "ordinary-custom", agentId: "source-agent-1", text: "Hello",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature: env.configSignature }, env.paseo);
    expect(await waitForJob(env.translator, env.paseo, "ordinary-custom")).toMatchObject({ state: "done", provider: "alt", model: "alt-model" });
    const created = env.captured.agentConfigs[0] as { config: Record<string, unknown> };
    expect(created.config.provider).toBe("alt/alt-model");
    expect(created.config).not.toHaveProperty("toolPolicy");
  });

  it("reports an unavailable configured provider without sending text through the conversation provider", async () => {
    const env = createMockEnv({ settings: { customModel: true, provider: "alt", model: "alt-model" } });
    env.translator.request({ action: "start", jobId: "unavailable-provider", agentId: "source-agent-1", text: "Hello",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature: env.configSignature }, env.paseo);
    expect(await waitForJob(env.translator, env.paseo, "unavailable-provider")).toEqual({
      state: "error", error: 'Translation provider "alt" is unavailable.',
    });
    expect(env.captured.workspaceInputs).toEqual([]);
    expect(env.captured.prompts).toEqual([]);
  });

  it("reports a helper creation error and archives the workspace", async () => {
    const env = createMockEnv({ createAgentError: new Error("Provider could not start the helper.") });
    env.translator.request({ action: "start", jobId: "create-failed", agentId: "source-agent-1", text: "Hello",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature: env.configSignature }, env.paseo);
    expect(await waitForJob(env.translator, env.paseo, "create-failed")).toEqual({
      state: "error", error: "Provider could not start the helper.",
    });
    expect(env.captured.prompts).toEqual([]);
    expect(env.captured.archived).toBe(1);
    expect(env.captured.deletedHelpers).toEqual([]);
  });
});

const CLAUDE_MODES = [
  { id: "plan", label: "Plan Mode", colorTier: "planning" },
  { id: "default", label: "Always Ask", colorTier: "safe" },
  { id: "acceptEdits", label: "Accept File Edits", colorTier: "moderate" },
  { id: "auto", label: "Auto mode", colorTier: "moderate" },
  { id: "bypassPermissions", label: "Bypass", colorTier: "dangerous" },
];

describe("translation helper restrictions", () => {
  async function createdConfig(env: ReturnType<typeof createMockEnv>, jobId: string) {
    env.translator.request({ action: "start", jobId, agentId: "source-agent-1", text: "Hello",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature: env.configSignature }, env.paseo);
    expect(await waitForJob(env.translator, env.paseo, jobId)).toMatchObject({ state: "done" });
    return (env.captured.agentConfigs[0] as { config: Record<string, unknown> }).config;
  }

  it.each(["claude", "pi"])("leaves a helper that follows the %s conversation unrestricted", async (provider) => {
    const env = createMockEnv({ provider, model: "claude-sonnet-4-5", providerEntries: [{ provider, enabled: true, status: "ready", modes: provider === "pi" ? [] : CLAUDE_MODES }] });
    const config = await createdConfig(env, `follow-${provider}`);
    expect(config).not.toHaveProperty("modeId");
    expect(config).not.toHaveProperty("options");
    expect(config).not.toHaveProperty("mcpServers");
    expect(env.captured.listModesCalls).toEqual([]);
  });

  it("returns a following helper's permission stop as an error, as before", async () => {
    const env = createMockEnv({ firstRunResult: { status: "permission", lastMessage: null, error: null, final: { pendingPermissions: [{ id: "perm-1", name: "Bash" }] } } });
    env.translator.request({ action: "start", jobId: "follow-permission", agentId: "source-agent-1", text: "Hello",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature: env.configSignature }, env.paseo);
    expect(await waitForJob(env.translator, env.paseo, "follow-permission")).toEqual({ state: "error", error: "Translation ended with status: permission." });
    expect(env.captured.permissionResponses).toEqual([]);
  });

  it("starts a custom Claude helper in plan mode with tools denied and a sandbox", async () => {
    const env = createMockEnv({ settings: { customModel: true, provider: "claude", model: "claude-sonnet-4-5" }, providerEntries: [{ provider: "claude", enabled: true, status: "ready", modes: CLAUDE_MODES }] });
    const config = await createdConfig(env, "mode-claude");
    expect(config.modeId).toBe("plan");
    expect(config.options).toMatchObject({
      disallowedTools: expect.arrayContaining(["Bash", "Read", "mcp__paseo"]),
      extraArgs: { "strict-mcp-config": null },
      sandbox: { enabled: true },
    });
    expect(env.captured.listModesCalls).toEqual([]);
  });

  it("starts a custom Codex helper in the read-only sandbox without Paseo tools", async () => {
    const env = createMockEnv({ provider: "codex", model: "gpt-5.5", settings: { customModel: true, provider: "codex", model: "gpt-5.5" }, providerEntries: [{ provider: "codex", enabled: true, status: "ready", modes: [
      { id: "auto", colorTier: "moderate" }, { id: "auto-review", colorTier: "moderate" }, { id: "full-access", colorTier: "dangerous" },
    ] }] });
    const config = await createdConfig(env, "mode-codex");
    expect(config).toMatchObject({ modeId: "auto", options: { sandbox_mode: "read-only", approval_policy: "never" }, mcpServers: { paseo: expect.any(Object) } });
  });

  it("starts a custom provider helper in its least permissive mode", async () => {
    const env = createMockEnv({
      settings: { customModel: true, provider: "alt", model: "alt-model" },
      providerEntries: [
        { provider: "claude", enabled: true, status: "ready", modes: CLAUDE_MODES },
        { provider: "alt", enabled: true, status: "ready", modes: [
          { id: "full", label: "Full Access", colorTier: "dangerous", isUnattended: true },
          { id: "write", label: "Write Approval", colorTier: "moderate" },
          { id: "ask", label: "Always Ask", colorTier: "safe" },
        ] },
      ],
    });
    expect((await createdConfig(env, "mode-custom")).modeId).toBe("ask");
  });

  it("reads the modes when the snapshot does not list them", async () => {
    const env = createMockEnv({ settings: { customModel: true, provider: "alt", model: "alt-model" },
      providerEntries: [{ provider: "claude", enabled: true, status: "ready" }, { provider: "alt", enabled: true, status: "ready" }] });
    expect((await createdConfig(env, "mode-fallback")).modeId).toBe("ask");
    expect(env.captured.listModesCalls).toEqual(["alt"]);
  });

  it("refuses a custom provider that cannot be kept from running tools before creating a helper", async () => {
    const env = createMockEnv({ provider: "pi", model: "pi-model", settings: { customModel: true, provider: "pi", model: "pi-model" }, providerEntries: [{ provider: "pi", enabled: true, status: "ready", modes: [] }] });
    env.translator.request({ action: "start", jobId: "mode-pi", agentId: "source-agent-1", text: "Hello",
      sourceKind: "assistant_message", interfaceLanguage: "en", configSignature: env.configSignature }, env.paseo);
    expect(await waitForJob(env.translator, env.paseo, "mode-pi")).toEqual({
      state: "error", error: 'Translation provider "pi" cannot be kept from running tools. Choose another translation model in settings.',
    });
    expect(env.captured.workspaceInputs).toEqual([]);
  });

  it("denies a custom helper's tool request and keeps the translation", async () => {
    const env = createMockEnv({ settings: { customModel: true, provider: "claude", model: "claude-sonnet-4-5" }, firstRunResult: { status: "permission", lastMessage: null, error: null,
      final: { pendingPermissions: [{ id: "perm-1", name: "Bash" }] } } });
    await createdConfig(env, "mode-deny");
    expect(env.captured.permissionResponses).toEqual([{ requestId: "perm-1", response: expect.objectContaining({ behavior: "deny" }) }]);
    expect(await env.translator.request({ action: "status", jobId: "mode-deny" }, env.paseo)).toMatchObject({ translation: "你好世界" });
  });
});
