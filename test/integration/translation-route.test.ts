/**
 * Real daemon and synthetic provider: no real model or credentials are used.
 * Better Paseo's translation service runs inside the daemon (the
 * `translation-route` test plugin), so it gets the host's own `paseo` API, as
 * the installed plugin does. Translation must never create a helper agent or
 * workspace, and must refuse unless the host reports a tool-free route.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, createPrivateDaemon, listAllAgents, listAllWorkspaces, paseo, paseoBin, type Connection, type PrivateDaemon } from "./helpers/real-daemon";

const PROVIDER = "bp-lanes";
const ROUTE = "bp-translation-route";
const laneDir = path.resolve(__dirname, "lane-provider");
const routeFixture = path.resolve(__dirname, "translation-route");
const repoRoot = path.resolve(__dirname, "../..");
/** The real modules the route plugin runs; the daemon bundles only files inside a plugin. */
const ROUTE_SOURCES = [
  "server/translation/service.ts",
  "server/translation/text-generation.ts",
  "server/paseo-types.ts",
  "shared/timeline-translation.ts",
  "shared/translation-languages.ts",
  "shared/model-catalog.ts",
];
/** TEST ONLY: Better Paseo's translation service with fixed settings, behind one RPC. */
const ROUTE_ENTRY = `import { defineRpc } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { createTimelineTranslator } from "./server/translation/service";
import { timelineTranslationSettingsSchema, translationConfigSignature } from "./shared/timeline-translation";

const probeRpc = defineRpc({
  name: "probe.translate",
  input: z.object({ agentId: z.string(), provider: z.string(), model: z.string(), text: z.string() }),
  output: z.unknown(),
});

export default function contribute(server: PluginServerContext) {
  const stop: unknown = server.handle(probeRpc, async ({ agentId, provider, model, text }, { paseo }) => {
    const values = timelineTranslationSettingsSchema.parse({ enabled: true, customModel: true, provider, model, prompt: "Translate." });
    const translator = createTimelineTranslator({
      settings: { id: "timeline-translation", read: async () => ({ status: "ready", values, revision: "it" }) } as never,
      timeoutMs: 30_000,
    });
    const started = translator.request({ action: "start", agentId, text, sourceKind: "assistant_message", interfaceLanguage: "en",
      configSignature: translationConfigSignature(values, "en", { provider, model }) }, paseo);
    const handle = started.state === "running" ? started.handle ?? "" : "";
    const deadline = Date.now() + 60_000;
    let state = translator.request({ action: "status", handle }, paseo);
    while (state.state === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = translator.request({ action: "status", handle }, paseo);
    }
    const providers = paseo.providers as unknown as { generateText?: unknown };
    return { state, hostHasTextApi: typeof providers.generateText === "function" };
  });
  return typeof stop === "function" ? stop : () => undefined;
}
`;

/** The route plugin, assembled in `home` from the fixture manifest and the real sources. */
function assembleRoutePlugin(home: string): string {
  const dir = path.join(home, "translation-route");
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ["paseo-plugin.json", "package.json"]) fs.copyFileSync(path.join(routeFixture, file), path.join(dir, file));
  for (const file of ROUTE_SOURCES) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, file), path.join(dir, file));
  }
  fs.writeFileSync(path.join(dir, "index.server.ts"), ROUTE_ENTRY);
  return dir;
}
const builtins = ["claude", "codex", "copilot", "opencode", "pi", "omp", "antigravity", "grok", "fx", "goose", "hoplite", "muse"];
/** `1`/`0`: the daemon under test must (not) offer one-shot text generation. Unset: either. */
const expectTextApi = process.env.BP_EXPECT_TEXT_API;
/**
 * JSON argv of a confined OpenCode 2 binary (for example a sandbox wrapper). When set, OpenCode
 * is enabled on the private daemon with temporary XDG directories, to check its refusal.
 */
const opencodeCommand = process.env.BP_OPENCODE_COMMAND ? (JSON.parse(process.env.BP_OPENCODE_COMMAND) as string[]) : null;

async function waitForProvider(home: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const listed = JSON.parse(await paseo(["provider", "ls", "--home", home, "--json"], 10_000, {}, true)) as Array<{ provider?: string; id?: string; status?: string }>;
    if (listed.some((entry) => (entry.provider ?? entry.id) === PROVIDER && entry.status === "available")) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`provider ${PROVIDER} never became available`);
}

describe.skipIf(!paseoBin())("translation on a private daemon", () => {
  let daemon: PrivateDaemon;
  let connection: Connection;
  let taskHome: string;
  let cwd: string;

  beforeAll(async () => {
    taskHome = fs.mkdtempSync(path.join(os.tmpdir(), "bp-it-translation-route-"));
    const claudeConfig = path.join(taskHome, "claude-config");
    fs.mkdirSync(claudeConfig);
    daemon = await createPrivateDaemon({
      home: taskHome,
      config: { daemon: { usage: { enabled: false } }, agents: { providers: {
        ...Object.fromEntries(builtins.map((id) => [id, { enabled: false }])),
        ...(opencodeCommand ? { opencode: { enabled: true, command: { mode: "replace", argv: opencodeCommand }, env: {
          XDG_CONFIG_HOME: path.join(taskHome, "oc-config"), XDG_DATA_HOME: path.join(taskHome, "oc-data"),
          XDG_STATE_HOME: path.join(taskHome, "oc-state"), XDG_CACHE_HOME: path.join(taskHome, "oc-cache"),
          OPENCODE_CONFIG_DIR: path.join(taskHome, "oc-opencode-config"),
          OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: "mock/mock-model", providers: { mock: { name: "Synthetic", package: "@ai-sdk/openai-compatible",
            settings: { baseURL: "http://127.0.0.1:9/v1", apiKey: "synthetic-not-a-secret" }, models: { "mock-model": { name: "Mock", capabilities: { tools: true, input: ["text"], output: ["text"] } } } } } }),
        } } } : {}),
      } } },
      env: { CLAUDE_CONFIG_DIR: claudeConfig }, cleanEnv: true,
    });
    await daemon.start();
    const configPath = path.join(taskHome, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.pluginsEnabled = true;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await daemon.restart();
    await paseo(["plugin", "install", laneDir, "--home", taskHome], 180_000, {}, true);
    await paseo(["plugin", "install", assembleRoutePlugin(taskHome), "--home", taskHome], 180_000, {}, true);
    await waitForProvider(taskHome);
    cwd = path.join(taskHome, "source");
    fs.mkdirSync(cwd);
    connection = await connect(daemon.host, "better-paseo-integration-translation-route");
  }, 600_000);

  afterAll(async () => {
    await connection?.close();
    await daemon?.dispose();
    if (taskHome) fs.rmSync(taskHome, { recursive: true, force: true });
  }, 120_000);

  it("refuses a provider without a tool-free route, sending nothing and creating no helper", async () => {
    const source = await connection.api.agents.create({ config: { provider: `${PROVIDER}/lanes` }, cwd, title: "translation source" });
    const agentIds = async () => (await listAllAgents(connection.api, { includeArchived: true, includeBackground: true })).map((agent) => agent.id).sort();
    const before = await agentIds();
    const workspacesBefore = (await listAllWorkspaces(connection.api)).length;
    const answer = await connection.daemon.invokePluginRpc(ROUTE, "probe.translate", {
      agentId: source.id, provider: PROVIDER, model: "lanes", text: "translation-test-echo SYNTHETIC",
    }) as { state: { state: string; error?: string }; hostHasTextApi: boolean };
    const expected = answer.hostHasTextApi
      ? `${PROVIDER} cannot translate with no tools on this Paseo, so nothing was sent.`
      : "Translation needs a Paseo version that can generate text with no tools. This Paseo does not provide it, so nothing was sent.";
    if (expectTextApi) expect(answer.hostHasTextApi).toBe(expectTextApi === "1");
    expect(answer.state).toEqual({ state: "error", error: expected });
    // No helper agent and no helper workspace appeared.
    expect(await agentIds()).toEqual(before);
    expect((await listAllWorkspaces(connection.api)).length).toBe(workspacesBefore);
  }, 180_000);

  it.skipIf(!opencodeCommand)("refuses OpenCode, which Paseo cannot run without the user's extensions", async () => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const snapshot = await connection.api.providers.snapshot();
      if (snapshot.entries.some((entry) => entry.provider === "opencode" && entry.status === "ready")) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    const source = await connection.api.agents.create({ config: { provider: `${PROVIDER}/lanes` }, cwd, title: "opencode translation source" });
    const before = (await listAllAgents(connection.api, { includeArchived: true, includeBackground: true })).length;
    const answer = await connection.daemon.invokePluginRpc(ROUTE, "probe.translate", {
      agentId: source.id, provider: "opencode", model: "mock/mock-model", text: "SYNTHETIC-OPENCODE",
    }) as { state: { state: string; error?: string }; hostHasTextApi: boolean };
    expect(answer.hostHasTextApi).toBe(true);
    expect(answer.state).toEqual({
      state: "error",
      error: "Paseo cannot run opencode for translation without loading your OpenCode plugins, MCP servers or other extensions, so nothing was sent.",
    });
    expect((await listAllAgents(connection.api, { includeArchived: true, includeBackground: true })).length).toBe(before);
  }, 240_000);
});
