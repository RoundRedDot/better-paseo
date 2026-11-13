import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskAvailability, taskDirectoryIssue, taskUpdateIssue } from "../../server/tasks/availability";
import { titleGenerationSettingsSchema } from "../../shared/title-generation";
import { tasksAvailabilityRpc } from "../../shared/task-availability";
import { fakeWorkspaceDirectory, type FakeWorkspace } from "./helpers/fake-workspace-directory";
import type { HostDaemon } from "../../server/tasks/provider-subagents";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) { await chmod(directory, 0o700); await rm(directory, { recursive: true, force: true }); } });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "task-availability-"));
  directories.push(directory);
  const source = { agent: { cwd: directory, workspaceId: "workspace-a", provider: "codex", model: "gpt-5.5" }, project: { projectKey: "project-a" } as object | null };
  const refresh = vi.fn(async () => source as typeof source | null);
  const workspaces: FakeWorkspace[] = [{ id: "workspace-a", activityAt: "2026-10-28T00:00:00Z", archivingAt: null }];
  const directoryApi = fakeWorkspaceDirectory(workspaces);
  const workspace = directoryApi.fetchWorkspaces;
  const timeline = vi.fn();
  const providers = [{ provider: "codex", enabled: true, status: "ready" }, { provider: "claude", enabled: true, status: "ready" }];
  const snapshot = vi.fn(async () => ({ entries: providers }));
  const listModels = vi.fn(async () => ({ error: null as string | null, models: [{ id: "gpt-5.5", isSelectable: true }] }));
  const api = { agents: { ref: () => ({ refresh, timeline: { refetch: timeline } }) }, workspaces: directoryApi.api, providers: { snapshot, listModels } } as unknown as PaseoApi;
  const values = titleGenerationSettingsSchema.parse({});
  const settings = { read: vi.fn(async () => ({ status: "ready" as const, revision: "1", values })), subscribe: () => () => {} };
  const canRename = vi.fn(() => true);
  const canUnarchive = vi.fn(async () => true);
  const inspectWorkspaceRecovery = vi.fn<NonNullable<HostDaemon["inspectWorkspaceRecovery"]>>(async (id) => workspaces.some((entry) => entry.id === id && entry.archivedAt)
    ? { kind: "recoverable", action: "unarchive" }
    : { kind: "unavailable", message: "Workspace missing" });
  const daemon: Pick<HostDaemon, "inspectWorkspaceRecovery" | "restoreWorkspace" | "close"> = { inspectWorkspaceRecovery, restoreWorkspace: vi.fn(), close: vi.fn(async () => {}) };
  const connect = vi.fn(async () => daemon as typeof daemon | null);
  const read = createTaskAvailability(settings, canRename, canUnarchive, connect);
  return { directory, source, refresh, workspaces, workspace, timeline, providers, snapshot, listModels, values, canRename, canUnarchive, inspectWorkspaceRecovery, daemon, connect, api, read };
}

describe("task operation availability", () => {
  it("reads only metadata, shares the catalog and leaves healthy tasks writable", async () => {
    const f = await fixture();
    const result = await f.read(f.api, ["a", "b", "a"]);
    expect(tasksAvailabilityRpc.output.parse(result)).toEqual({ entries: ["a", "b"].map((agentId) => ({ agentId, availability: { issue: null, blocked: {} } })) });
    expect(f.listModels).toHaveBeenCalledTimes(1);
    expect(f.timeline).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("blocks every write for a removed directory and recovers on the next check", async () => {
    const f = await fixture();
    f.source.agent.cwd = join(f.directory, "recycled-worktree");
    const result = await f.read(f.api, ["a"]);
    expect(result.entries[0]?.availability.issue).toEqual({ code: "directory_missing", detail: f.source.agent.cwd });
    expect(Object.keys(result.entries[0]!.availability.blocked)).toEqual(["rename", "autoTitle", "unarchive", "archive", "read", "permission"]);
    expect(f.workspace).not.toHaveBeenCalled();
    f.source.agent.cwd = f.directory;
    expect((await f.read(f.api, ["a"])).entries[0]!.availability).toEqual({ issue: null, blocked: {} });
  });

  it("distinguishes a file path and an inaccessible directory from a removed worktree", async () => {
    const f = await fixture();
    const file = join(f.directory, "not-a-directory");
    await writeFile(file, "fixture");
    expect(await taskDirectoryIssue(file)).toEqual({ code: "directory_not_directory", detail: file });
    expect(await taskDirectoryIssue(join(file, "child"))).toEqual({ code: "directory_not_directory", detail: join(file, "child") });
    await chmod(f.directory, 0o000);
    expect(await taskDirectoryIssue(f.directory)).toEqual({ code: "directory_inaccessible", detail: f.directory });
  });

  it("distinguishes missing records and unavailable or archiving workspaces", async () => {
    const f = await fixture();
    expect(await taskUpdateIssue(null, f.api)).toEqual({ code: "agent_missing", detail: null });
    f.workspaces[0]!.archivedAt = "2026-10-28T00:00:00Z";
    const archived = (await f.read(f.api, ["a"])).entries[0]!.availability;
    expect(archived.issue).toBeNull();
    expect(archived.blocked.unarchive).toBeUndefined();
    expect(archived.blocked.rename?.code).toBe("workspace_archived");
    expect(archived.blocked.autoTitle?.code).toBe("workspace_archived");
    expect(f.inspectWorkspaceRecovery).toHaveBeenCalledWith("workspace-a");
    expect(f.daemon.restoreWorkspace).not.toHaveBeenCalled();
    Object.assign(f.workspaces[0]!, { archivedAt: null, archivingAt: "2026-10-28T00:00:00Z" });
    const archiving = (await f.read(f.api, ["a"])).entries[0]!.availability;
    expect(archiving.blocked.unarchive?.code).toBe("workspace_unavailable");
  });

  it("still checks the CLI, recovery API and provider before unarchiving an archived workspace", async () => {
    const f = await fixture();
    f.workspaces[0]!.archivedAt = "2026-10-28T00:00:00Z";
    f.canUnarchive.mockResolvedValue(false);
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.blocked.unarchive?.code).toBe("unsupported");
    f.canUnarchive.mockResolvedValue(true);
    const restore = f.daemon.restoreWorkspace;
    delete f.daemon.restoreWorkspace;
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.blocked.unarchive?.code).toBe("unsupported");
    f.daemon.restoreWorkspace = restore;
    f.providers[0]!.enabled = false;
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.blocked.unarchive?.code).toBe("provider_unavailable");
  });

  it("does not mistake a missing workspace record or a worktree requiring recreation for normal archiving", async () => {
    const f = await fixture();
    f.workspaces.length = 0;
    const missing = (await f.read(f.api, ["a"])).entries[0]!.availability;
    expect(missing.issue?.code).toBe("workspace_unavailable");
    expect(missing.blocked.unarchive?.code).toBe("workspace_unavailable");
    f.inspectWorkspaceRecovery.mockResolvedValueOnce({ kind: "recoverable", action: "restore" });
    expect((await f.read(f.api, ["a"])).entries[0]!.availability).toEqual(missing);
  });

  it("does not substitute another active workspace at the same directory for the task's own workspace", async () => {
    const f = await fixture();
    f.workspaces[0]!.archivedAt = "2026-10-28T00:00:00Z";
    f.workspaces.push({ id: "other-workspace", activityAt: "2026-10-29T00:00:00Z", archivingAt: null });
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.issue).toBeNull();
    f.workspaces.shift();
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.issue?.code).toBe("workspace_unavailable");
    expect(f.inspectWorkspaceRecovery.mock.calls.map(([id]) => id)).toEqual(["workspace-a", "workspace-a"]);
  });

  it("shares one recovery inspection per workspace in a batch and reads it again next time", async () => {
    const f = await fixture();
    f.workspaces[0]!.archivedAt = "2026-10-28T00:00:00Z";
    const result = await f.read(f.api, ["a", "b", "a"]);
    expect(tasksAvailabilityRpc.output.parse(result).entries.every((entry) => entry.availability.issue === null)).toBe(true);
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.inspectWorkspaceRecovery).toHaveBeenCalledTimes(1);
    expect(f.daemon.close).toHaveBeenCalledTimes(1);
    f.workspaces.length = 0;
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.issue?.code).toBe("workspace_unavailable");
    expect(f.inspectWorkspaceRecovery).toHaveBeenCalledTimes(2);
  });

  it("reports a disconnected host separately and recovers on the next check", async () => {
    const f = await fixture();
    f.workspaces[0]!.archivedAt = "2026-10-28T00:00:00Z";
    f.connect.mockResolvedValueOnce(null);
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.issue?.code).toBe("host_unavailable");
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.issue).toBeNull();
  });

  it("does not conceal recovery inspection failures and always closes the connection", async () => {
    const f = await fixture();
    f.workspaces[0]!.archivedAt = "2026-10-28T00:00:00Z";
    f.inspectWorkspaceRecovery.mockRejectedValueOnce(new Error("inspect_failed"));
    await expect(f.read(f.api, ["a"])).rejects.toThrow("inspect_failed");
    expect(f.daemon.close).toHaveBeenCalledTimes(1);
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.issue).toBeNull();
  });

  it.each(["disabled", "error", "unavailable", "loading"])("preserves metadata edits while a %s provider blocks generation and resume", async (status) => {
    const f = await fixture();
    if (status === "disabled") f.providers[0]!.enabled = false;
    else f.providers[0]!.status = status;
    const state = (await f.read(f.api, ["a"])).entries[0]!.availability;
    expect(Object.keys(state.blocked)).toEqual(["unarchive", "autoTitle"]);
    expect(state.issue?.code).toBe("provider_unavailable");
  });

  it("uses the custom title provider independently of the source provider", async () => {
    const f = await fixture();
    f.providers[0]!.enabled = false;
    Object.assign(f.values, { customModel: true, provider: "claude", model: "gpt-5.5" });
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.blocked.autoTitle).toBeUndefined();
    expect(f.listModels).toHaveBeenCalledWith("claude");
  });

  it("keeps metadata writable when only the model catalog request fails", async () => {
    const f = await fixture();
    f.listModels.mockRejectedValueOnce(new Error("Catalog unavailable"));
    const state = (await f.read(f.api, ["a"])).entries[0]!.availability;
    expect(state).toMatchObject({ issue: { code: "model_unavailable" }, blocked: { autoTitle: { code: "model_unavailable" } } });
    expect(state.blocked.rename).toBeUndefined();
  });

  it("checks settings, project placement, model availability and operation capabilities separately", async () => {
    const f = await fixture();
    f.values.customModel = true;
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.issue?.code).toBe("title_settings_invalid");
    f.values.customModel = false;
    f.source.project = null;
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.issue?.code).toBe("project_unavailable");
    f.source.project = {};
    f.listModels.mockResolvedValueOnce({ error: null, models: [] });
    expect((await f.read(f.api, ["a"])).entries[0]!.availability.issue?.code).toBe("model_unavailable");
    f.canRename.mockReturnValue(false);
    f.canUnarchive.mockResolvedValue(false);
    expect(Object.keys((await f.read(f.api, ["a"])).entries[0]!.availability.blocked)).toEqual(["autoTitle", "rename", "unarchive"]);
  });
});
