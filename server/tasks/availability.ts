import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import type { PaseoAgentRefetchResult, PaseoApi, PaseoProviderModelsResult, PaseoWorkspace } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { type TaskAvailability, type TaskIssue, unavailableTask } from "../../shared/task-availability";
import { titleGenerationSettingsSchema } from "../../shared/title-generation";
import type { HostDaemon } from "./provider-subagents";

export async function taskDirectoryIssue(cwd: string): Promise<TaskIssue | null> {
  try {
    if (!(await stat(cwd)).isDirectory()) return { code: "directory_not_directory", detail: cwd };
    await access(cwd, constants.R_OK | constants.X_OK);
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { code: "directory_missing", detail: cwd };
    if (code === "ENOTDIR") return { code: "directory_not_directory", detail: cwd };
    if (code === "EACCES" || code === "EPERM") return { code: "directory_inaccessible", detail: cwd };
    throw error;
  }
}

export function taskIssueError(issue: TaskIssue): string {
  return `Task operation unavailable (${issue.code})${issue.detail ? `: ${issue.detail}` : "."}`;
}

type TaskUpdateState = { issue: TaskIssue | null; archivedWorkspaceId: string | null };

/** Everything but the workspace record; `workspaceId` is set when that record still has to be read. */
async function taskPlacementState(source: PaseoAgentRefetchResult | null): Promise<TaskUpdateState & { workspaceId: string | null }> {
  if (!source) return { issue: { code: "agent_missing", detail: null }, archivedWorkspaceId: null, workspaceId: null };
  const directory = await taskDirectoryIssue(source.agent.cwd);
  if (directory) return { issue: directory, archivedWorkspaceId: null, workspaceId: null };
  if (!source.agent.workspaceId) return { issue: { code: "workspace_unavailable", detail: null }, archivedWorkspaceId: null, workspaceId: null };
  return { issue: null, archivedWorkspaceId: null, workspaceId: source.agent.workspaceId };
}

function workspaceState(cwd: string, workspaceId: string, workspace: PaseoWorkspace | null): TaskUpdateState {
  if (!workspace) return { issue: { code: "workspace_unavailable", detail: cwd }, archivedWorkspaceId: workspaceId };
  if (workspace.archivingAt) return { issue: { code: "workspace_unavailable", detail: cwd }, archivedWorkspaceId: null };
  return { issue: null, archivedWorkspaceId: null };
}

/** Metadata and filesystem checks do not load a provider session or read its timeline. */
export async function taskUpdateState(source: PaseoAgentRefetchResult | null, paseo: PaseoApi): Promise<TaskUpdateState> {
  const { workspaceId, ...state } = await taskPlacementState(source);
  if (!workspaceId) return state;
  return workspaceState(source!.agent.cwd, workspaceId, await paseo.workspaces.ref(workspaceId).refresh());
}

/**
 * The workspaces of `ids`, read the way `workspaces.ref(id).refresh()` reads
 * one: pages of 200, background included, stopping once every id has turned
 * up, and to the last page while one has not. Like the SDK's null, a miss
 * can mean an archived record; recovery inspection below resolves those ids.
 * The daemon rebuilds the whole directory for each page, so one scan per
 * batch replaces one per card.
 */
async function listTaskWorkspaces(paseo: PaseoApi, ids: ReadonlySet<string>): Promise<ReadonlyMap<string, PaseoWorkspace>> {
  const workspaces = new Map<string, PaseoWorkspace>();
  const remaining = new Set(ids);
  let cursor: string | undefined;
  while (remaining.size > 0) {
    const page = await paseo.workspaces.list({ filter: { includeBackground: true }, page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    for (const entry of page.entries) if (remaining.delete(entry.id)) workspaces.set(entry.id, entry);
    cursor = page.pageInfo.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return workspaces;
}

export async function taskUpdateIssue(source: PaseoAgentRefetchResult | null, paseo: PaseoApi): Promise<TaskIssue | null> {
  return (await taskUpdateState(source, paseo)).issue;
}

type RecoveryDaemon = Pick<HostDaemon, "inspectWorkspaceRecovery" | "restoreWorkspace" | "close">;

/** The active directory omits archived records; only the host can distinguish them from missing ones. */
async function inspectArchivedWorkspaces(ids: string[], connect: () => Promise<RecoveryDaemon | null>) {
  const states = new Map<string, TaskIssue["code"]>();
  if (ids.length === 0) return states;
  const daemon = await connect();
  if (!daemon) return new Map(ids.map((id) => [id, "host_unavailable" as const]));
  try {
    if (!daemon.inspectWorkspaceRecovery || !daemon.restoreWorkspace) return new Map(ids.map((id) => [id, "unsupported" as const]));
    for (const id of ids) {
      const recovery = await daemon.inspectWorkspaceRecovery(id);
      states.set(id, recovery.kind === "recoverable" && recovery.action === "unarchive" ? "workspace_archived" : "workspace_unavailable");
    }
    return states;
  } finally {
    await daemon.close().catch(() => {});
  }
}

export function createTaskAvailability(settings: PluginSettings<typeof titleGenerationSettingsSchema>, canRename: () => boolean, canUnarchive: () => Promise<boolean>, connect: () => Promise<RecoveryDaemon | null>) {
  return async (paseo: PaseoApi, agentIds: string[]) => {
    const [config, providers, unarchive] = await Promise.all([settings.read(), paseo.providers.snapshot(), canUnarchive()]);
    const catalogs = new Map<string, Promise<Pick<PaseoProviderModelsResult, "error" | "models">>>();
    const entries = [];
    // Bound daemon requests: agents are read one at a time, then the workspace
    // pages once for the whole batch. Reading it after every agent keeps it
    // at least as new as each agent's workspace id, as the per-card read was.
    const placements = [];
    for (const agentId of [...new Set(agentIds)]) {
      const source = await paseo.agents.ref(agentId).refresh();
      placements.push({ agentId, source, placement: await taskPlacementState(source) });
    }
    const workspaceIds = new Set(placements.flatMap(({ placement }) => placement.workspaceId ? [placement.workspaceId] : []));
    const workspaces = await listTaskWorkspaces(paseo, workspaceIds);
    const recoveries = await inspectArchivedWorkspaces([...workspaceIds].filter((id) => !workspaces.has(id)), connect);
    // Cards share provider catalogs within this batch.
    for (const { agentId, source, placement: { workspaceId, ...placed } } of placements) {
      const { issue, archivedWorkspaceId } = workspaceId ? workspaceState(source!.agent.cwd, workspaceId, workspaces.get(workspaceId) ?? null) : placed;
      if (issue || !source) {
        const availability = unavailableTask(archivedWorkspaceId ? { ...issue!, code: recoveries.get(archivedWorkspaceId)! } : issue!);
        if (source && availability.issue?.code === "workspace_archived") {
          if (!unarchive) availability.blocked.unarchive = { code: "unsupported", detail: null };
          else if (!providers.entries.some((entry) => entry.provider === source.agent.provider && entry.enabled && entry.status === "ready")) {
            availability.blocked.unarchive = { code: "provider_unavailable", detail: source.agent.provider };
          } else delete availability.blocked.unarchive;
          // Archiving is normal task history, not a failed workspace. Keep operation guards until unarchived.
          availability.issue = availability.blocked.unarchive ?? null;
        }
        entries.push({ agentId, availability });
        continue;
      }
      const blocked: TaskAvailability["blocked"] = {};
      if (!canRename()) blocked.rename = blocked.autoTitle = { code: "unsupported", detail: null };
      if (!unarchive) blocked.unarchive = { code: "unsupported", detail: null };
      if (!blocked.unarchive && !providers.entries.some((entry) => entry.provider === source.agent.provider && entry.enabled && entry.status === "ready")) {
        blocked.unarchive = { code: "provider_unavailable", detail: source.agent.provider };
      }
      if (!blocked.autoTitle) {
        if (config.status !== "ready" || config.values.customModel && (!config.values.provider || !config.values.model)) {
          blocked.autoTitle = { code: "title_settings_invalid", detail: null };
        } else if (!source.project) {
          blocked.autoTitle = { code: "project_unavailable", detail: null };
        } else {
          const provider = config.values.customModel ? config.values.provider : source.agent.provider;
          const model = config.values.customModel ? config.values.model : source.agent.model;
          if (!providers.entries.some((entry) => entry.provider === provider && entry.enabled && entry.status === "ready")) {
            blocked.autoTitle = { code: "provider_unavailable", detail: provider };
          } else if (!model) {
            blocked.autoTitle = { code: "model_unavailable", detail: null };
          } else {
            if (!catalogs.has(provider)) catalogs.set(provider, paseo.providers.listModels(provider).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })));
            const catalog = await catalogs.get(provider)!;
            if (catalog.error || !catalog.models?.some((entry) => entry.id === model && entry.isSelectable !== false)) blocked.autoTitle = { code: "model_unavailable", detail: catalog.error ?? model };
          }
        }
      }
      entries.push({ agentId, availability: { issue: blocked.rename ?? blocked.autoTitle ?? blocked.unarchive ?? null, blocked } });
    }
    return { entries };
  };
}
