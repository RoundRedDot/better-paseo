/**
 * Lanes through real turns: a private daemon runs the test provider
 * (`lane-provider/`), and the board follows each task render by render. A
 * card must never pass through a lane its daemon state does not call for:
 * a running task never shows as done, a finished one never as archived.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PaseoAgentHandle } from "@getpaseo/client";
import { connect, createPrivateDaemon, installDirectoryPlugin, paseo, paseoBin, type Connection, type PrivateDaemon } from "./helpers/real-daemon";
import { mountBoard, type MountedBoard } from "./helpers/mount-board";

vi.mock("react-native", () => import("../unit/helpers/rn-mock"));

const PROVIDER = "bp-lanes";
const providerDir = path.resolve(__dirname, "lane-provider");

describe.skipIf(!paseoBin())("lanes through real turns", () => {
  let daemon: PrivateDaemon;
  let connection: Connection;
  let other: Connection;
  let board: MountedBoard;
  let cwd: string;
  let count = 0;

  beforeAll(async () => {
    daemon = await createPrivateDaemon();
    await daemon.start();
    await installDirectoryPlugin(daemon, providerDir, PROVIDER);
    cwd = path.join(daemon.home, "work");
    fs.mkdirSync(cwd, { recursive: true });
    connection = await connect(daemon.host, "better-paseo-integration-board");
    // Another device: reads and stops land on the board from outside, as from a phone.
    other = await connect(daemon.host, "better-paseo-integration-other");
    board = await mountBoard(connection.api);
    await board.until((current) => expect(current.ready).toBe(true));
  }, 600_000);

  afterAll(async () => {
    await board?.unmount();
    await other?.close();
    await connection?.close();
    await daemon?.dispose();
  }, 120_000);

  async function start(prompt: string, options: { parent?: PaseoAgentHandle } = {}): Promise<PaseoAgentHandle> {
    count += 1;
    const handle = await other.api.agents.create({ config: { provider: `${PROVIDER}/lanes` }, cwd, title: `lanes ${count}: ${prompt}`, prompt, ...(options.parent ? { parent: options.parent } : null) });
    board.track(handle.id);
    return handle;
  }

  const card = (id: string) => board.current.byId.get(id);
  const lane = (id: string, expected: string, status?: string) => board.until(() => {
    expect(card(id)?.lane).toBe(expected);
    if (status) expect(card(id)?.status).toBe(status);
  }, 30_000);
  /** Its lanes, without the moments before its card first showed. */
  const path_ = (id: string) => board.history(id).filter((value, index, all) => !(value === "-" && index === 0 && all.length > 1));

  it("shows a new task running, then in review once its turn ends", async () => {
    const task = await start("hold:2500");
    await lane(task.id, "running", "running");
    await lane(task.id, "review", "unread");
    expect(path_(task.id)).toEqual(["running", "review"]);
  });

  it("asks for input in needs input, and goes on running once answered", async () => {
    const task = await start("hold:300 ask hold:1500");
    await lane(task.id, "needs_input", "needs_input");
    const permission = card(task.id)!.permission!;
    expect(permission.kind).toBe("tool");
    await other.api.agents.ref(task.id).respondToPermission({ requestId: permission.requestId, response: { behavior: "allow" } });
    await lane(task.id, "running");
    await lane(task.id, "review", "unread");
    expect(path_(task.id)).toEqual(["running", "needs_input", "running", "review"]);
  });

  it("puts a failed turn in review as failed", async () => {
    const task = await start("hold:500 fail");
    await lane(task.id, "review", "failed");
    expect(path_(task.id)).toEqual(["running", "review"]);
  });

  it("takes a stopped task out of running", async () => {
    const task = await start("wait");
    await lane(task.id, "running");
    await other.daemon.cancelAgent(task.id);
    await board.until(() => expect(["review", "done"]).toContain(card(task.id)?.lane), 30_000);
    expect(path_(task.id).slice(0, 1)).toEqual(["running"]);
    expect(path_(task.id)).not.toContain("archived");
  });

  it("moves a task read on another device to done, and back to running on its next prompt", async () => {
    const task = await start("hold:300");
    await lane(task.id, "review");
    await other.daemon.clearAgentAttention(task.id);
    await lane(task.id, "done", "done");
    await other.api.agents.ref(task.id).send("hold:2000");
    await lane(task.id, "running");
    await lane(task.id, "review", "unread");
    expect(path_(task.id)).toEqual(["running", "review", "done", "running", "review"]);
  });

  it("archives a task into the archived lane only when it is archived", async () => {
    const task = await start("hold:300");
    await lane(task.id, "review");
    await other.api.agents.ref(task.id).archive();
    await lane(task.id, "archived", "archived");
    expect(path_(task.id)).toEqual(["running", "review", "archived"]);
  });

  it("keeps a parent running while its subtask runs, then puts both in review", async () => {
    const parent = await start("hold:200");
    await lane(parent.id, "review");
    const child = await start("hold:3000", { parent });
    await lane(child.id, "running");
    await lane(parent.id, "running");
    expect(card(parent.id)?.waitingOnSubtasks).toBe(true);
    await lane(child.id, "review");
    await lane(parent.id, "review");
    expect(path_(child.id)).toEqual(["running", "review"]);
  });

  it("moves the tasks of an archived workspace to archived", async () => {
    const dir = path.join(daemon.home, "work-archived");
    fs.mkdirSync(dir, { recursive: true });
    count += 1;
    const task = await other.api.agents.create({ config: { provider: `${PROVIDER}/lanes` }, cwd: dir, title: `lanes ${count}: archived workspace`, prompt: "hold:300" });
    board.track(task.id);
    await lane(task.id, "review");
    const workspaceId = card(task.id)!.location.workspaceId!;
    await paseo(["workspace", "archive", workspaceId, "--home", daemon.home]);
    await board.until(() => expect(["archived", undefined]).toContain(card(task.id)?.lane), 30_000);
    expect(path_(task.id).filter((value) => value !== "-")).not.toContain("done");
  });

  it("keeps many concurrent tasks in their lanes", async () => {
    const tasks = await Promise.all(Array.from({ length: 12 }, (_, index) => start(`hold:${1500 + index * 100}`)));
    await board.until(() => {
      for (const task of tasks) expect(card(task.id)?.lane).toBe("review");
    }, 60_000);
    for (const task of tasks) expect(path_(task.id)).toEqual(["running", "review"]);
  });
});
