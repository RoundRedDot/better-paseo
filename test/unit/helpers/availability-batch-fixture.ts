import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { vi } from "vitest";
import { titleGenerationSettingsSchema } from "../../../shared/title-generation";
import { fakeWorkspaceDirectory, type FakeWorkspace } from "./fake-workspace-directory";
import type { HostDaemon } from "../../../server/tasks/provider-subagents";

type Source = { agent: { cwd: string; workspaceId: string | undefined; provider: string; model: string }; project: object | null };

/**
 * One availability batch over `workspaces` daemon workspaces and `cards`
 * cards (100 is the RPC maximum). Cards spread over every workspace, so with
 * fewer workspaces than cards several cards share one, and with more than 200
 * some sit on the second page. The first cards cover the special cases:
 * archived, archiving and background workspaces, an id that never existed, a
 * removed directory, no workspace id, a missing agent and a provider that is
 * not ready.
 */
export async function availabilityBatchFixture(options: { workspaces: number; cards?: number }) {
  const cards = options.cards ?? 100;
  const root = await mkdtemp(join(tmpdir(), "task-availability-batch-"));
  const records: FakeWorkspace[] = Array.from({ length: options.workspaces }, (_, index) => ({
    id: `ws-${index}`, activityAt: new Date(Date.UTC(2026, 9, 1) + index * 60_000).toISOString(), archivingAt: null,
  }));
  records[1]!.archivedAt = "2026-10-30T00:00:00Z";
  records[2]!.archivingAt = "2026-10-30T00:00:00Z";
  records[3]!.background = true;
  const sources = new Map<string, Source | null>();
  const ids: string[] = [];
  for (let index = 0; index < cards; index += 1) {
    const id = `agent-${index}`;
    ids.push(id);
    sources.set(id, { agent: { cwd: root, workspaceId: `ws-${Math.floor(index * options.workspaces / cards)}`, provider: "codex", model: "gpt-5.5" }, project: { projectKey: "p" } });
  }
  const set = (index: number, change: (source: Source) => void) => change(sources.get(`agent-${index}`)!);
  set(1, (source) => { source.agent.workspaceId = "ws-1"; });
  set(2, (source) => { source.agent.workspaceId = "ws-2"; });
  set(3, (source) => { source.agent.workspaceId = "ws-3"; });
  set(4, (source) => { source.agent.workspaceId = "ws-never"; });
  set(5, (source) => { source.agent.cwd = join(root, "removed-worktree"); });
  set(6, (source) => { source.agent.workspaceId = undefined; });
  set(8, (source) => { source.agent.provider = "gemini"; });
  sources.set("agent-7", null);

  const directory = fakeWorkspaceDirectory(records);
  const fetchAgent = vi.fn(async (id: string) => structuredClone(sources.get(id) ?? null));
  const snapshot = vi.fn(async () => ({ entries: [{ provider: "codex", enabled: true, status: "ready" }, { provider: "gemini", enabled: true, status: "unavailable" }] }));
  const listModels = vi.fn(async () => ({ error: null, models: [{ id: "gpt-5.5", isSelectable: true }] }));
  const api = {
    agents: { ref: (id: string) => ({ refresh: () => fetchAgent(id) }) },
    workspaces: directory.api,
    providers: { snapshot, listModels },
  } as unknown as PaseoApi;
  const values = titleGenerationSettingsSchema.parse({});
  const settings = { read: vi.fn(async () => ({ status: "ready" as const, revision: "1", values })), subscribe: () => () => {} };
  const inspectWorkspaceRecovery = vi.fn<NonNullable<HostDaemon["inspectWorkspaceRecovery"]>>(async (id) => records.some((entry) => entry.id === id && entry.archivedAt)
    ? { kind: "recoverable", action: "unarchive" }
    : { kind: "unavailable", message: "Workspace missing" });
  const daemon = { inspectWorkspaceRecovery, restoreWorkspace: vi.fn(), close: vi.fn(async () => {}) };
  const connect = vi.fn(async () => daemon);
  const counts = () => ({ fetchAgent: fetchAgent.mock.calls.length, fetchWorkspaces: directory.fetchWorkspaces.mock.calls.length, listModels: listModels.mock.calls.length, providersSnapshot: snapshot.mock.calls.length });
  const reset = () => { for (const spy of [fetchAgent, directory.fetchWorkspaces, listModels, snapshot]) spy.mockClear(); };
  return { root, ids, records, sources, api, settings, connect, daemon, fetchAgent, fetchWorkspaces: directory.fetchWorkspaces, counts, reset, cleanup: () => rm(root, { recursive: true, force: true }) };
}
