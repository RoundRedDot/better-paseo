import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import type { PaseoAgentRefetchResult, PaseoApi, PaseoProviderModelsResult } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { type TaskAvailability, type TaskIssue, unavailableTask } from "../../shared/task-availability";
import { titleGenerationSettingsSchema } from "../../shared/title-generation";

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

/** Metadata and filesystem checks do not load a provider session or read its timeline. */
export async function taskUpdateState(source: PaseoAgentRefetchResult | null, paseo: PaseoApi): Promise<{ issue: TaskIssue | null; archivedWorkspaceId: string | null }> {
  if (!source) return { issue: { code: "agent_missing", detail: null }, archivedWorkspaceId: null };
  const directory = await taskDirectoryIssue(source.agent.cwd);
  if (directory) return { issue: directory, archivedWorkspaceId: null };
  if (!source.agent.workspaceId) return { issue: { code: "workspace_unavailable", detail: null }, archivedWorkspaceId: null };
  const workspace = await paseo.workspaces.ref(source.agent.workspaceId).refresh();
  if (!workspace) return { issue: { code: "workspace_unavailable", detail: source.agent.cwd }, archivedWorkspaceId: source.agent.workspaceId };
  if (workspace.archivingAt) return { issue: { code: "workspace_unavailable", detail: source.agent.cwd }, archivedWorkspaceId: null };
  return { issue: null, archivedWorkspaceId: null };
}

export async function taskUpdateIssue(source: PaseoAgentRefetchResult | null, paseo: PaseoApi): Promise<TaskIssue | null> {
  return (await taskUpdateState(source, paseo)).issue;
}

export function createTaskAvailability(settings: PluginSettings<typeof titleGenerationSettingsSchema>, canRename: () => boolean, canUnarchive: () => Promise<boolean>, canRestore: () => boolean) {
  return async (paseo: PaseoApi, agentIds: string[]) => {
    const [config, providers, unarchive] = await Promise.all([settings.read(), paseo.providers.snapshot(), canUnarchive()]);
    const catalogs = new Map<string, Promise<Pick<PaseoProviderModelsResult, "error" | "models">>>();
    const entries = [];
    // Bound daemon requests; cards share provider catalogs within this batch.
    for (const agentId of [...new Set(agentIds)]) {
      const source = await paseo.agents.ref(agentId).refresh();
      const { issue, archivedWorkspaceId } = await taskUpdateState(source, paseo);
      if (issue || !source) {
        const availability = unavailableTask(issue!);
        if (source && archivedWorkspaceId) {
          if (!unarchive || !canRestore()) availability.blocked.unarchive = { code: "unsupported", detail: null };
          else if (!providers.entries.some((entry) => entry.provider === source.agent.provider && entry.enabled && entry.status === "ready")) {
            availability.blocked.unarchive = { code: "provider_unavailable", detail: source.agent.provider };
          } else delete availability.blocked.unarchive;
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
