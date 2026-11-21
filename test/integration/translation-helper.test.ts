/** Real daemon and synthetic provider: no real model or credentials are used. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTimelineTranslator } from "../../server/translation/service";
import { timelineTranslationSettingsSchema, translationConfigSignature } from "../../shared/timeline-translation";
import { connect, createPrivateDaemon, paseo, paseoBin, type Connection, type PrivateDaemon } from "./helpers/real-daemon";

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
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const listed = JSON.parse(await paseo(["provider", "ls", "--home", taskHome, "--json"], 10_000, {}, true)) as Array<{ provider?: string; id?: string; status?: string }>;
      if (listed.some((entry) => (entry.provider ?? entry.id) === PROVIDER && entry.status === "available")) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    cwd = path.join(taskHome, "source");
    fs.mkdirSync(cwd);
    connection = await connect(daemon.host, "better-paseo-integration-translation");
  }, 600_000);

  afterAll(async () => {
    await connection?.close();
    await daemon?.dispose();
    if (taskHome) fs.rmSync(taskHome, { recursive: true, force: true });
  }, 120_000);

  it.each([false, true])("runs and cleans a helper with customModel=%s", async (customModel) => {
    const source = await connection.api.agents.create({ config: { provider: `${PROVIDER}/lanes` }, cwd, title: "translation source" });
    const values = timelineTranslationSettingsSchema.parse({ enabled: true, customModel, provider: PROVIDER, model: "lanes", prompt: "Translate." });
    const deleted: string[] = [];
    const translator = createTimelineTranslator({
      settings: { id: "timeline-translation", read: async () => ({ status: "ready", values, revision: "it" }) } as never,
      directory: path.join(taskHome, "translation-helper"),
      deleteHelper: async (id) => { await connection.daemon.deleteAgent(id); deleted.push(id); },
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
    expect(state).toMatchObject({ state: "done", translation: expect.stringContaining("Text to translate:\ntranslation-test-echo Hello."), provider: PROVIDER, model: "lanes" });
    expect(deleted).toHaveLength(1);
  }, 120_000);
});
