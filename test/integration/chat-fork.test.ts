import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chatForkRpc, type ForkCursor } from "../../shared/chat-fork-rpc";
import { connect, createPrivateDaemon, paseoBin, type Connection, type PrivateDaemon } from "./helpers/real-daemon";

describe.skipIf(!paseoBin())("forking a Better Paseo reply", () => {
  let daemon: PrivateDaemon;
  let connection: Connection;
  let agentId: string;
  let workspaceId: string;
  let cursor: ForkCursor;
  const earlier = "history before the selected reply";
  const later = "history after the selected reply";

  beforeAll(async () => {
    daemon = await createPrivateDaemon();
    const configPath = path.join(daemon.home, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.daemon.relay = { enabled: false };
    config.pluginsEnabled = true;
    config.plugins = {
      "bp-lanes": { source: "directory", path: path.join(__dirname, "lane-provider"), enabled: true },
      "better-paseo": { source: "directory", path: path.resolve(__dirname, "../.."), enabled: true },
    };
    fs.writeFileSync(configPath, JSON.stringify(config));
    const cwd = path.join(daemon.home, "work");
    fs.mkdirSync(cwd);
    await daemon.start();
    connection = await connect(daemon.host);
    const workspace = await connection.api.workspaces.create({ source: { kind: "directory", path: cwd } });
    workspaceId = workspace.id;
    const agent = await workspace.agents.create({ config: { provider: "bp-lanes/lanes" } });
    agentId = agent.id;
    for (const message of [earlier, later]) {
      expect((await agent.run(message, { timeoutMs: 15_000 })).status).toBe("idle");
    }
    const page = await agent.timeline.refetch({ direction: "tail", limit: 20, projection: "projected" });
    const replies = page.entries.filter(({ item }) => item.type === "assistant_message");
    expect(replies).toHaveLength(2);
    cursor = { epoch: page.epoch, seq: replies[0]!.seqEnd };
  }, 180_000);

  afterAll(async () => {
    await connection?.close();
    await daemon?.dispose();
  }, 60_000);

  it.each(["tab", "workspace"] as const)("forks into a new %s from the selected reply", async (target) => {
    const prompt = "first message in the fork";
    const input = { agentId, cursor, target, prompt, requestKey: `test-${target}` };
    const invoke = () => connection.daemon.invokePluginRpc("better-paseo", chatForkRpc.name, input);
    const result = chatForkRpc.output.parse(await invoke());
    expect(await invoke()).toEqual(result);

    const fork = connection.api.agents.ref(result.agentId);
    expect((await fork.waitForFinish(15_000)).status).toBe("idle");
    expect(fork.workspaceId).toBeTruthy();
    expect(fork.workspaceId === workspaceId).toBe(target === "tab");
    const page = await fork.timeline.refetch({ direction: "tail", limit: 20, projection: "projected" });
    const prompts = page.entries.filter(({ item }) => item.type === "user_message");
    expect(prompts).toHaveLength(1);
    const text = JSON.stringify(prompts[0]!.item);
    expect(text).toContain(prompt);
    expect(text).toContain(earlier);
    expect(text).not.toContain(later);
  }, 60_000);

  it("rejects a stale timeline cursor", async () => {
    await expect(connection.daemon.invokePluginRpc("better-paseo", chatForkRpc.name, {
      agentId, cursor: { ...cursor, epoch: "stale" }, target: "tab", prompt: "unused", requestKey: "stale",
    })).rejects.toThrow(/timeline position is no longer available/i);
  });
});
