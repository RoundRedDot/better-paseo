import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRANSLATION_PROMPT,
  resolveThinkingCapability,
  timelineTranslationSettingsSchema,
  type TimelineTranslationSettings,
} from "../../shared/timeline-translation";
import {
  appendTranslationChunk,
  buildTranslationPrompt,
  createTimelineTranslator,
} from "../../server/translation/service";
import type { PaseoApi } from "../../server/paseo-types";

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
  runResult?: { status: string; lastMessage?: string | null; error?: string | null };
  streamChunks?: Array<{ text: string; messageId?: string }>;
  throwOnRun?: boolean;
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
  } = {
    prompts: [],
    workspaceInputs: [],
    agentConfigs: [],
    archived: 0,
    deletedHelpers: [],
    touchedSourceTimeline: false,
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
          entries: [
            { provider, enabled: true, status: "ready" },
          ],
        };
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
          },
          agents: {
            async create(agentInput: unknown) {
              captured.agentConfigs.push(agentInput);
              const handlers: Array<(event: unknown) => void> = [];
              return {
                id: "helper-agent-1",
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

  return { translator, paseo: paseo as unknown as PaseoApi, captured, dir };
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
  it("never accesses source timeline, isolates helper workspace, and sends only selected content", async () => {
    const { translator, paseo, captured, dir } = createMockEnv({
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

  it("recognizes only off, none, and disabled as genuine thinking-off options", () => {
    expect(resolveThinkingCapability([{ id: "off", label: "Off" }]).status).toBe("supported");
    expect(resolveThinkingCapability([{ id: "none", label: "None" }]).status).toBe("supported");
    expect(resolveThinkingCapability([{ id: "disabled", label: "Disabled" }]).status).toBe("supported");
    expect(resolveThinkingCapability([{ id: "minimal", label: "Minimal" }, { id: "low", label: "Low" }]).status).toBe("unsupported_off");
    expect(resolveThinkingCapability([]).status).toBe("none");
  });

  it("does not silently downgrade thinking when model lacks off/none/disabled", async () => {
    const { translator, paseo, captured } = createMockEnv({
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
    const { translator, paseo, captured } = createMockEnv({
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
    const { translator, paseo, captured } = createMockEnv({
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
      },
      paseo,
    );
    const settled = await waitForJob(translator, paseo, "job-fail");
    expect(settled).toEqual({ state: "error", error: "model crashed" });
    expect(captured.archived).toBe(1);
    expect(captured.deletedHelpers).toEqual(["helper-agent-1"]);
  });

  it("rejects translation when disabled in settings", async () => {
    const { translator, paseo } = createMockEnv({
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

    const prompt = buildTranslationPrompt("Translate", "Japanese (ja)", "ja", "reasoning", "Step 1");
    expect(prompt).toContain("Source kind: assistant reasoning");
    expect(prompt).toContain("Step 1");
  });
});
