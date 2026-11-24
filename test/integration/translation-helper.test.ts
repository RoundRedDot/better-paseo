/** Real daemon and synthetic provider: no real model or credentials are used. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTimelineTranslator } from "../../server/translation/helper-service";
import { timelineTranslationSettingsSchema, translationConfigSignature } from "../../shared/translation-helper-legacy";
import { connect, createPrivateDaemon, listAllAgents, listAllWorkspaces, paseo, paseoBin, type Connection, type PrivateDaemon } from "./helpers/real-daemon";

const PROVIDER = "bp-lanes";
const providerDir = path.resolve(__dirname, "lane-provider");
const builtins = ["claude", "codex", "copilot", "opencode", "pi", "omp", "antigravity", "grok", "fx", "goose", "hoplite", "muse"];

describe.skipIf(!paseoBin())("ordinary translation helper with a private daemon", () => {
  let daemon: PrivateDaemon;
  let connection: Connection;
  let taskHome: string;
  let cwd: string;

  beforeAll(async () => {
    taskHome = fs.mkdtempSync(path.join(os.tmpdir(), "bp-it-ordinary-translation-"));
    const claudeConfig = path.join(taskHome, "claude-config");
    fs.mkdirSync(claudeConfig);
    daemon = await createPrivateDaemon({
      home: taskHome,
      config: { daemon: { usage: { enabled: false } }, agents: { providers: Object.fromEntries(builtins.map((id) => [id, { enabled: false }])) } },
      env: { CLAUDE_CONFIG_DIR: claudeConfig }, cleanEnv: true,
    });
    await daemon.start();
    const configPath = path.join(taskHome, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.pluginsEnabled = true;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await daemon.restart();
    await paseo(["plugin", "install", providerDir, "--home", taskHome], 180_000, {}, true);
    cwd = path.join(taskHome, "source");
    fs.mkdirSync(cwd);
    connection = await connect(daemon.host, "better-paseo-integration-translation");
    await vi.waitFor(async () => {
      const snapshot = await connection.api.providers.snapshot();
      expect(snapshot.entries.filter((entry) => entry.enabled).map((entry) => entry.provider)).toEqual([PROVIDER]);
      expect(snapshot.entries.find((entry) => entry.provider === PROVIDER)?.status).toBe("ready");
    }, { timeout: 60_000, interval: 500 });
  }, 600_000);

  afterAll(async () => {
    await connection?.close();
    await daemon?.dispose();
    if (taskHome) fs.rmSync(taskHome, { recursive: true, force: true });
  }, 120_000);

  it.each([
    { customModel: false, model: "lanes" },
    { customModel: true, model: "translation" },
  ])("runs and cleans a helper with customModel=$customModel", async ({ customModel, model }) => {
    const source = await connection.api.agents.create({ config: { provider: `${PROVIDER}/lanes` }, cwd, title: "translation source" });
    const values = timelineTranslationSettingsSchema.parse({ enabled: true, customModel, provider: PROVIDER, model, targetLanguage: "zh-CN", prompt: "Translate." });
    const deleted: { id: string; provider?: string; model?: string | null; workspaceId?: string | null }[] = [];
    const translator = createTimelineTranslator({
      settings: { id: "timeline-translation", read: async () => ({ status: "ready", values, revision: "it" }) } as never,
      directory: path.join(taskHome, "translation-helper"),
      deleteHelper: async (id) => {
        const helper = await connection.api.agents.ref(id).refresh();
        await connection.daemon.deleteAgent(id);
        deleted.push({ id, provider: helper?.agent.provider, model: helper?.agent.model, workspaceId: helper?.agent.workspaceId });
      },
      timeoutMs: 60_000,
    });
    const jobId = `translation-${String(customModel)}`;
    translator.request({ action: "start", jobId, agentId: source.id, text: "translation-test-echo Hello.", sourceKind: "assistant_message", interfaceLanguage: "en",
      configSignature: translationConfigSignature(values, "en", { provider: PROVIDER, model: "lanes" }) }, connection.api);
    const deadline = Date.now() + 90_000;
    let state = translator.request({ action: "status", jobId }, connection.api);
    while (state.state === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = translator.request({ action: "status", jobId }, connection.api);
    }
    expect(state).toMatchObject({
      state: "done", provider: PROVIDER, model, targetLanguageCode: "zh-CN",
      translation: expect.stringMatching(/^Translate\.\n\nTarget language: .*\(zh-CN\)\nSource kind: assistant reply\n\nText to translate:\ntranslation-test-echo Hello\.$/),
    });
    expect(deleted).toEqual([{ id: expect.any(String), provider: PROVIDER, model, workspaceId: expect.any(String) }]);
    const agents = await listAllAgents(connection.api, { includeArchived: true, includeBackground: true });
    expect(agents.map((agent) => agent.id)).toContain(source.id);
    expect(agents.map((agent) => agent.id)).not.toContain(deleted[0]?.id);
    const workspaces = await listAllWorkspaces(connection.api);
    expect(workspaces.filter((workspace) => workspace.id === deleted[0]?.workspaceId && !workspace.archivingAt)).toEqual([]);
  }, 120_000);
});
