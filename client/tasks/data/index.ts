import { useMemo, useSyncExternalStore } from "react";
import type {
  PaseoAgent,
  PaseoAgentListOptions,
  PaseoAgentListResult,
  PaseoApi,
  PaseoProject,
  PaseoProjectUpdate,
  PaseoProviderModelsResult,
  PaseoWorkspace,
  PaseoWorkspaceListResult,
} from "@getpaseo/client";
import { doneWindowMs, type DoneWindow } from "../../../shared/tasks-settings";
import { footerModel } from "../../state/footer-model";
import { MARK_IDS } from "../../components/marks";
import { normalizeProvider } from "../../components/provider-logo";
import { classifyAgent } from "../agent-state-bucket";
import { LANE_ORDER, type BoardCounts, type BoardFilters, type LaneId, type LaneModel, type TaskCard, type TaskChild, type TaskLabel } from "../model";

export interface WorkspaceOption {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
}

export interface TasksOptions {
  /** The done lane's time window. */
  doneWindow: DoneWindow;
  /** Page the done lane in; false keeps only the active subscription (the sidebar's case). */
  includeDone: boolean;
}

export interface TasksSnapshot {
  /** Every lane in `LANE_ORDER`, each sorted as the spec's lane table says. Unfiltered. */
  lanes: Record<LaneId, LaneModel>;
  counts: BoardCounts;
  byId: ReadonlyMap<string, TaskCard>;
  /** Filter options: workspaces grouped by project, providers and labels seen on cards. */
  workspaces: WorkspaceOption[];
  providers: { id: string; label: string }[];
  labels: TaskLabel[];
  /** False until the first active snapshot arrives. */
  ready: boolean;
  error: string | null;
}

export interface TasksHandle extends TasksSnapshot {
  /** Fetch the done lane's next page (50). */
  loadMoreDone(): void;
  /** Resolve a parent that is not on the board (archived): `agents.ref(id).refresh()`. */
  resolveParent(agentId: string): void;
  /** Fetch the icon for a visible card's project. */
  requestProjectIcon(projectId: string): void;
}

type AgentPlacement = PaseoAgentListResult["entries"][number]["project"] | null;

interface AgentEntry {
  agent: PaseoAgent;
  placement: AgentPlacement;
}

interface AgentUpdateEnvelope {
  type?: string;
  payload?: {
    subscriptionId?: string;
    kind?: "upsert" | "remove";
    agent?: PaseoAgent;
    project?: AgentPlacement;
    agentId?: string;
  };
}

interface WorkspaceUpdateEnvelope {
  type?: string;
  payload?: { kind?: string; workspace?: PaseoWorkspace; id?: string };
}

interface OptionalLabelsApi {
  listLabels?: (options?: { subscribe?: {} }) => Promise<{
    labels: Array<{ name: string; color: string }>;
    subscription?: {
      ready: Promise<{ labels: Array<{ name: string; color: string }>; subscriptionId?: string }>;
      subscribe(observer: {
        snapshot(snapshot: { labels: Array<{ name: string; color: string }> }): void;
        update(message: unknown): void;
        error?(error: unknown): void;
      }): () => void;
      release(): Promise<void>;
    };
  }>;
}

interface OptionalProjectIconsApi {
  icon?: (projectId: string) => Promise<{
    icon: { data: string; mimeType: string } | null;
    error?: string | null;
  }>;
}

interface OwnedSubscriptionLike {
  ready: Promise<unknown>;
  subscribe(observer: {
    snapshot(snapshot: unknown): void;
    update(message: unknown): void;
    error?(error: unknown): void;
  }): () => void;
  release(): Promise<void>;
}

interface StoreSubscription {
  stopObserver: () => void;
  release: () => void;
}

interface ProjectIconValue {
  revision: string | null;
  uri: string | null;
}

const ACTIVE_SUBSCRIPTIONS: Array<{ key: string; filter: PaseoAgentListOptions["filter"] }> = [
  { key: "active-status", filter: { statuses: ["running", "initializing", "error"] } },
  { key: "active-attention", filter: { requiresAttention: true } },
];
const DONE_SUBSCRIPTION = "done-first";
const PAGE_SIZE = 50;
const LABEL_COLORS: Readonly<Record<string, string>> = {
  violet: "#6d49b5",
  sky: "#3d6985",
  emerald: "#3e6e5d",
  orange: "#845838",
  pink: "#974168",
  indigo: "#5251c2",
  teal: "#3e6d6c",
  red: "#9c4243",
  amber: "#716239",
  blue: "#39649e",
};
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  paseo: "Paseo",
  claude: "Claude",
  codex: "Codex",
  omp: "Oh My Pi",
  pi: "Pi",
  gemini: "Gemini",
  antigravity: "Antigravity",
  copilot: "Copilot",
  opencode: "OpenCode",
  minimax: "MiniMax",
  deepseek: "DeepSeek",
  grok: "Grok",
  cursor: "Cursor",
  ollama: "Ollama",
  generic: "Agent",
};

function oneLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const line = value.split(/\r?\n/, 1)[0]?.trim();
  return line || null;
}

function markFor(provider: string): string | null {
  const normalized = normalizeProvider(provider);
  for (const id of [`provider:${normalized}`, `lobe:${normalized}`]) {
    if (MARK_IDS.has(id)) return id;
  }
  return null;
}

function providerLabel(provider: string): string {
  const normalized = normalizeProvider(provider);
  if (normalized === "generic") {
    return provider.trim().toLowerCase() === "generic" ? PROVIDER_LABELS.generic ?? "Agent" : provider;
  }
  return PROVIDER_LABELS[normalized] ?? normalized;
}

function isDone(agent: PaseoAgent): boolean {
  return agent.status === "idle" || agent.status === "closed";
}

function isArchived(agent: PaseoAgent): boolean {
  return Boolean(agent.archivedAt);
}

function projectFor(entry: AgentEntry, workspace: PaseoWorkspace | undefined, projects: Map<string, PaseoProject>): PaseoProject | undefined {
  const project = workspace ? projects.get(workspace.projectId) : undefined;
  if (project) return project;
  const key = entry.placement?.projectKey;
  return key ? [...projects.values()].find((project) => project.projectKey === key || project.projectId === key) : undefined;
}

function parentIdOf(agent: PaseoAgent): string | null {
  const value = agent.labels?.["paseo.parent-agent-id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function taskLabels(workspace: PaseoWorkspace | undefined, colorNames: ReadonlyMap<string, string>): TaskLabel[] {
  return [...new Set(workspace?.labels ?? [])]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, color: colorNames.get(name) ?? null }));
}

function firstPermissionSummary(permission: PaseoAgent["pendingPermissions"][number]): string | null {
  const input = permission.input as Record<string, unknown> | undefined;
  const detail = permission.detail as Record<string, unknown> | undefined;
  return oneLine(input?.command) ?? oneLine(input?.filePath) ?? oneLine(input?.path) ??
    oneLine(detail?.command) ?? oneLine(detail?.filePath) ?? oneLine(permission.description);
}

function providerCatalog(api: PaseoApi, provider: string): Promise<PaseoProviderModelsResult> {
  return api.providers.listModels(provider);
}

function shallowCardEqual(left: TaskCard | undefined, right: TaskCard): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

function pathTail(path: string): string | null {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1)?.replace(/\//g, "-") ?? null;
}

function buildBaseCard(
  entry: AgentEntry,
  workspace: PaseoWorkspace | undefined,
  project: PaseoProject | undefined,
  colorNames: ReadonlyMap<string, string>,
  modelCatalog: PaseoProviderModelsResult | undefined,
  icon: ProjectIconValue | undefined,
): TaskCard {
  const { agent, placement } = entry;
  const pendingPermissions = agent.pendingPermissions ?? [];
  const classification = classifyAgent({
    status: agent.status,
    pendingPermissionCount: pendingPermissions.length,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
  });
  const workspaceName = workspace?.title?.trim() || workspace?.name || placement?.workspaceName || null;
  const projectName = workspace?.projectCustomName?.trim() || workspace?.projectDisplayName ||
    project?.projectCustomName?.trim() || project?.projectDisplayName || placement?.projectName || null;
  const branch = workspace?.gitRuntime?.currentBranch ?? placement?.checkout.currentBranch ?? null;
  const folderCandidate = pathTail(agent.cwd);
  const branchFolder = branch?.replace(/\//g, "-") ?? null;
  const folder = folderCandidate && folderCandidate !== projectName && folderCandidate !== workspaceName && folderCandidate !== branch && folderCandidate !== branchFolder
    ? folderCandidate
    : null;
  const contextUsed = agent.lastUsage?.contextWindowUsedTokens;
  const contextMax = agent.lastUsage?.contextWindowMaxTokens;
  const context = typeof contextUsed === "number" && Number.isFinite(contextUsed) &&
    typeof contextMax === "number" && Number.isFinite(contextMax)
    ? { usedTokens: contextUsed, maxTokens: contextMax }
    : null;
  const effectiveThinkingId = agent.effectiveThinkingOptionId ?? agent.thinkingOptionId ?? null;
  const modelLabels = agent.model && modelCatalog
    ? footerModel(modelCatalog, agent.model, effectiveThinkingId)
    : { modelName: null, thinkingLabel: null };
  const modeLabel = agent.availableModes?.find((mode) => mode.id === agent.currentModeId)?.label ?? null;
  const projectId = workspace?.projectId ?? project?.projectId ?? null;
  const revision = project?.projectIconRevision ?? null;
  const projectIcon = icon?.revision === revision ? icon.uri : null;
  const hasGitState = workspace ? workspace.gitRuntime != null : placement?.checkout.isGit === true;
  const pullRequest = workspace?.githubRuntime?.pullRequest;
  const permission = pendingPermissions[0];
  const timingDelta = agent.lastUserMessageAt ? Date.parse(agent.updatedAt) - Date.parse(agent.lastUserMessageAt) : Number.NaN;

  return {
    id: agent.id,
    title: agent.title?.trim() || "Untitled",
    lane: classification.lane,
    status: classification.status,
    provider: agent.provider,
    providerLabel: providerLabel(agent.provider),
    providerMark: markFor(agent.provider),
    model: agent.model,
    modelLabel: modelLabels.modelName ?? agent.model,
    thinkingLabel: modelLabels.thinkingLabel,
    modeLabel,
    location: {
      projectId,
      projectName,
      projectIcon,
      workspaceId: agent.workspaceId ?? workspace?.id ?? null,
      workspaceName: workspaceName && workspaceName !== projectName && workspaceName !== agent.title &&
        workspaceName !== branch && workspaceName !== branchFolder ? workspaceName : null,
      workspaceKind: workspace?.workspaceKind ?? null,
      branch,
      git: hasGitState
        ? {
            dirty: workspace?.gitRuntime?.isDirty ?? null,
            ahead: workspace?.gitRuntime?.aheadBehind?.ahead ?? null,
            behind: workspace?.gitRuntime?.aheadBehind?.behind ?? null,
          }
        : null,
      folder: folder && folder !== agent.title ? folder : null,
      cwd: agent.cwd,
      pullRequest: pullRequest
        ? { number: pullRequest.number ?? null, title: pullRequest.title, url: pullRequest.url }
        : null,
    },
    labels: taskLabels(workspace, colorNames),
    timing: {
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      turnStartedAt: agent.activeTurn?.startedAt ?? null,
      attentionAt: agent.attentionTimestamp ?? null,
      lastUserMessageAt: agent.lastUserMessageAt,
      lastTurnMs: Number.isFinite(timingDelta) ? timingDelta : null,
    },
    context,
    usage: agent.lastUsage
      ? {
          inputTokens: agent.lastUsage.inputTokens ?? null,
          cachedInputTokens: agent.lastUsage.cachedInputTokens ?? null,
          outputTokens: agent.lastUsage.outputTokens ?? null,
          totalCostUsd: agent.lastUsage.totalCostUsd ?? null,
        }
      : null,
    error: classification.status === "failed" ? agent.lastError ?? null : null,
    permission: permission
      ? {
          requestId: permission.id,
          kind: permission.kind === "tool" || permission.kind === "plan" || permission.kind === "question" || permission.kind === "mode"
            ? permission.kind
            : "other",
          title: permission.title ?? permission.name,
          summary: firstPermissionSummary(permission),
          actions: (permission.actions ?? []).map((action) => ({
            id: action.id,
            label: action.label,
            behavior: action.behavior,
            variant: action.variant ?? null,
          })),
          remaining: Math.max(0, pendingPermissions.length - 1),
        }
      : null,
    parent: null,
    children: [],
    openTab: Object.entries(agent.labels ?? {}).some(([key, value]) => key.startsWith("paseo.open-agent-tab.") && value === "true"),
    stoppable: agent.status === "running" || agent.status === "initializing" || pendingPermissions.length > 0,
  };
}

interface SnapshotCache {
  key: string;
  snapshot: TasksSnapshot;
}

interface TaskStore {
  subscribe(listener: () => void, includeDone: boolean): () => void;
  getSnapshot(options: TasksOptions): TasksHandle;
  loadMoreDone(window: DoneWindow): void;
  resolveParent(id: string): void;
  requestProjectIcon(projectId: string): void;
}

const stores = new WeakMap<PaseoApi, TaskStore>();

function createStore(api: PaseoApi): TaskStore {
  const listeners = new Set<() => void>();
  const entries = new Map<string, AgentEntry>();
  const sourceMembers = new Map<string, Set<string>>();
  const workspaces = new Map<string, PaseoWorkspace>();
  const projects = new Map<string, PaseoProject>();
  const colorNames = new Map<string, string>();
  const modelCatalogs = new Map<string, PaseoProviderModelsResult>();
  const modelRequests = new Set<string>();
  const baseCards = new Map<string, TaskCard>();
  const cards = new Map<string, TaskCard>();
  const childrenByParent = new Map<string, Set<string>>();
  const parentByChild = new Map<string, string>();
  const resolvedParentTitles = new Map<string, string | null>();
  const projectIcons = new Map<string, ProjectIconValue>();
  const iconRequests = new Set<string>();
  const subscriptions = new Map<string, StoreSubscription>();
  const projectUnsubscribes: Array<() => void> = [];
  let consumers = 0;
  let doneConsumers = 0;
  let generation = 0;
  let activeReady = false;
  let loadingDone = false;
  let doneCursor: string | null = null;
  let doneTailAt: string | null = null;
  let error: string | null = null;
  let snapshotCaches: SnapshotCache[] = [];
  let notificationBatchDepth = 0;
  let notificationPending = false;

  const emitNotification = () => {
    snapshotCaches = [];
    for (const listener of listeners) listener();
  };

  const notify = () => {
    if (notificationBatchDepth > 0) {
      notificationPending = true;
      return;
    }
    emitNotification();
  };

  function batchUpdates<T>(update: () => T): T {
    notificationBatchDepth += 1;
    try {
      return update();
    } finally {
      notificationBatchDepth -= 1;
      if (notificationBatchDepth === 0 && notificationPending) {
        notificationPending = false;
        emitNotification();
      }
    }
  }

  const memberSetsContaining = (id: string) => [...sourceMembers.entries()].filter(([, members]) => members.has(id));

  function dropIfUnreferenced(id: string) {
    if (memberSetsContaining(id).length > 0) return;
    removeRecord(id);
  }

  function refreshFinalCard(id: string): boolean {
    const base = baseCards.get(id);
    if (!base) {
      return cards.delete(id);
    }
    const parentAgentId = parentByChild.get(id);
    const parentEntry = parentAgentId ? entries.get(parentAgentId) : undefined;
    const parentTitle = parentAgentId
      ? parentEntry?.agent.title?.trim() || resolvedParentTitles.get(parentAgentId) || null
      : null;
    const childIds = childrenByParent.get(id);
    const next: TaskCard = {
      ...base,
      parent: parentAgentId
        ? { id: parentAgentId, title: parentTitle, missing: !baseCards.has(parentAgentId) }
        : null,
      children: childIds
        ? [...childIds]
            .map((childId): TaskChild | null => {
              const child = cards.get(childId) ?? baseCards.get(childId);
              return child ? { id: child.id, title: child.title, status: child.status } : null;
            })
            .filter((child): child is TaskChild => child !== null)
            .sort((left, right) => left.title.localeCompare(right.title))
        : [],
    };
    const previous = cards.get(id);
    if (shallowCardEqual(previous, next)) return false;
    cards.set(id, next);
    return true;
  }

  function replaceParentLink(id: string, nextParent: string | null) {
    const previousParent = parentByChild.get(id) ?? null;
    if (previousParent === nextParent) return previousParent;
    if (previousParent) {
      const children = childrenByParent.get(previousParent);
      children?.delete(id);
      if (children?.size === 0) childrenByParent.delete(previousParent);
      parentByChild.delete(id);
    }
    if (nextParent) {
      let children = childrenByParent.get(nextParent);
      if (!children) childrenByParent.set(nextParent, children = new Set());
      children.add(id);
      parentByChild.set(id, nextParent);
    }
    return previousParent;
  }

  function updateRecord(agent: PaseoAgent, placement: AgentPlacement) {
    if (isArchived(agent)) {
      for (const members of sourceMembers.values()) members.delete(agent.id);
      removeRecord(agent.id);
      return;
    }
    const oldParent = parentByChild.get(agent.id) ?? null;
    entries.set(agent.id, { agent, placement });
    const newParent = parentIdOf(agent);
    replaceParentLink(agent.id, newParent);
    const workspace = agent.workspaceId ? workspaces.get(agent.workspaceId) : undefined;
    const project = projectFor({ agent, placement }, workspace, projects);
    const projectId = workspace?.projectId ?? project?.projectId ?? null;
    const catalog = modelCatalogs.get(agent.provider);
    const icon = projectId ? projectIcons.get(projectId) : undefined;
    const base = buildBaseCard({ agent, placement }, workspace, project, colorNames, catalog, icon);
    const oldBase = baseCards.get(agent.id);
    if (!shallowCardEqual(oldBase, base)) baseCards.set(agent.id, base);
    else if (!oldBase) baseCards.set(agent.id, base);
    if (agent.model && !modelCatalogs.has(agent.provider) && !modelRequests.has(agent.provider)) {
      requestModelCatalog(agent.provider, generation);
    }
    const affected = new Set<string>([agent.id]);
    if (oldParent) affected.add(oldParent);
    if (newParent) affected.add(newParent);
    for (const childId of childrenByParent.get(agent.id) ?? []) affected.add(childId);
    for (const affectedId of affected) refreshFinalCard(affectedId);
    notify();
  }

  function removeRecord(id: string) {
    const existed = entries.has(id);
    if (!existed) return;
    entries.delete(id);
    const oldParent = replaceParentLink(id, null);
    const affected = new Set<string>([id]);
    if (oldParent) affected.add(oldParent);
    for (const childId of childrenByParent.get(id) ?? []) affected.add(childId);
    baseCards.delete(id);
    cards.delete(id);
    for (const affectedId of affected) refreshFinalCard(affectedId);
    notify();
  }

  function reconcileActiveMembers(agent: PaseoAgent) {
    if (isArchived(agent)) {
      for (const { key } of ACTIVE_SUBSCRIPTIONS) sourceMembers.get(key)?.delete(agent.id);
      return;
    }
    const statusMatches = ["running", "initializing", "error"].includes(agent.status);
    const attentionMatches = Boolean(agent.requiresAttention);
    if (statusMatches) sourceMembers.get("active-status")?.add(agent.id);
    else sourceMembers.get("active-status")?.delete(agent.id);
    if (attentionMatches) sourceMembers.get("active-attention")?.add(agent.id);
    else sourceMembers.get("active-attention")?.delete(agent.id);
  }

  function applyAgentUpdate(sourceKey: string, update: AgentUpdateEnvelope) {
    if (update.type !== "agent_update" || !update.payload) return;
    const payload = update.payload;
    if (payload.kind === "upsert" && payload.agent) {
      const agent = payload.agent;
      if (sourceKey === DONE_SUBSCRIPTION) {
        if (isDone(agent) && !isArchived(agent)) {
          sourceMembers.get(DONE_SUBSCRIPTION)?.add(agent.id);
          reconcileActiveMembers(agent);
        } else {
          sourceMembers.get(DONE_SUBSCRIPTION)?.delete(agent.id);
        }
      } else {
        reconcileActiveMembers(agent);
        if (!isDone(agent)) {
          for (const key of sourceMembers.keys()) if (key.startsWith("done-page-") || key === DONE_SUBSCRIPTION) sourceMembers.get(key)?.delete(agent.id);
        }
      }
      updateRecord(agent, payload.project ?? null);
      return;
    }
    if (payload.kind === "remove" && payload.agentId) {
      sourceMembers.get(sourceKey)?.delete(payload.agentId);
      dropIfUnreferenced(payload.agentId);
    }
  }

  function matchingEntries(result: PaseoAgentListResult | { entries: PaseoAgentListResult["entries"] }) {
    return result.entries.filter(({ agent }) => !isArchived(agent));
  }

  function replaceAgentSnapshot(sourceKey: string, snapshot: PaseoAgentListResult) {
    batchUpdates(() => {
      const nextMembers = new Set<string>();
      for (const entry of matchingEntries(snapshot)) {
        nextMembers.add(entry.agent.id);
        updateRecord(entry.agent, entry.project ?? null);
      }
      sourceMembers.set(sourceKey, nextMembers);
      for (const id of [...entries.keys()]) if (!nextMembers.has(id) && memberSetsContaining(id).length === 0) dropIfUnreferenced(id);
      if (sourceKey.startsWith("active-")) activeReady = true;
      if (sourceKey === DONE_SUBSCRIPTION) {
        doneCursor = snapshot.pageInfo.nextCursor;
        doneTailAt = snapshot.entries.at(-1)?.agent.updatedAt ?? null;
      }
      notify();
    });
  }

  function subscriptionError(caught: unknown) {
    error = caught instanceof Error ? caught.message : String(caught);
    notify();
  }

  async function observeOwned<T extends { subscription?: OwnedSubscriptionLike }>(
    key: string,
    result: T,
    run: number,
    initial: (snapshot: T) => void,
    update: (message: unknown) => void,
  ) {
    const owned = result.subscription;
    if (!owned) {
      if (run === generation) initial(result);
      return;
    }
    if (run !== generation || consumers === 0 || (key === DONE_SUBSCRIPTION && doneConsumers === 0)) {
      await owned.release();
      return;
    }
    const pending: Array<{ kind: "snapshot"; value: T } | { kind: "update"; value: unknown }> = [];
    let initialApplied = false;
    const observer = {
      snapshot(snapshot: unknown) {
        if (initialApplied) initial(snapshot as T);
        else pending.push({ kind: "snapshot", value: snapshot as T });
      },
      update(message: unknown) {
        if (initialApplied) update(message);
        else pending.push({ kind: "update", value: message });
      },
      error: subscriptionError,
    };
    const stopObserver = owned.subscribe(observer);
    subscriptions.set(key, { stopObserver, release: () => { void owned.release(); } });
    try {
      const ready = await owned.ready as T;
      if (run !== generation) return;
      initial(ready);
      initialApplied = true;
      for (const event of pending) {
        if (event.kind === "snapshot") initial(event.value);
        else update(event.value);
      }
    } catch (caught) {
      if (run === generation) subscriptionError(caught);
    }
  }

  function requestModelCatalog(provider: string, run: number) {
    modelRequests.add(provider);
    void providerCatalog(api, provider).then((catalog) => {
      if (run !== generation) return;
      batchUpdates(() => {
        modelCatalogs.set(provider, catalog);
        for (const [id, entry] of entries) {
          if (entry.agent.provider !== provider) continue;
          const workspace = entry.agent.workspaceId ? workspaces.get(entry.agent.workspaceId) : undefined;
          const project = projectFor(entry, workspace, projects);
          const projectId = workspace?.projectId ?? project?.projectId ?? null;
          const base = buildBaseCard(entry, workspace, project, colorNames, catalog, projectId ? projectIcons.get(projectId) : undefined);
          baseCards.set(id, base);
          refreshFinalCard(id);
          for (const child of childrenByParent.get(id) ?? []) refreshFinalCard(child);
        }
        notify();
      });
    }).catch((caught: unknown) => {
      if (run === generation) subscriptionError(caught);
    });
  }

  function activeOptions(filter: PaseoAgentListOptions["filter"]): PaseoAgentListOptions {
    return { filter, subscribe: {} };
  }

  async function openAgentSubscription(key: string, options: PaseoAgentListOptions, run: number) {
    try {
      const result = await api.agents.list(options);
      if (run !== generation || consumers === 0 || (key === DONE_SUBSCRIPTION && doneConsumers === 0)) {
        await result.subscription?.release();
        return;
      }
      await observeOwned(key, result, run,
        (snapshot) => replaceAgentSnapshot(key, snapshot as PaseoAgentListResult),
        (message) => applyAgentUpdate(key, message as AgentUpdateEnvelope));
    } catch (caught) {
      if (run === generation) subscriptionError(caught);
    }
  }

  function updateWorkspace(workspace: PaseoWorkspace) {
    workspaces.set(workspace.id, workspace);
    for (const [id, entry] of entries) {
      if (entry.agent.workspaceId !== workspace.id) continue;
      const project = projects.get(workspace.projectId);
      const base = buildBaseCard(entry, workspace, project, colorNames, modelCatalogs.get(entry.agent.provider), projectIcons.get(workspace.projectId));
      baseCards.set(id, base);
      refreshFinalCard(id);
      for (const childId of childrenByParent.get(id) ?? []) refreshFinalCard(childId);
    }
    notify();
  }

  async function startWorkspaceSubscription(run: number) {
    try {
      const result = await api.workspaces.list({ subscribe: {} });
      if (run !== generation || consumers === 0) {
        await result.subscription?.release();
        return;
      }
      await observeOwned("workspaces", result, run, (snapshot) => {
        batchUpdates(() => {
          const workspaceSnapshot = snapshot as PaseoWorkspaceListResult;
          const next = new Set<string>();
          for (const workspace of workspaceSnapshot.entries) {
            next.add(workspace.id);
            updateWorkspace(workspace);
          }
          const removed = [...workspaces.keys()].filter((id) => !next.has(id));
          for (const id of removed) workspaces.delete(id);
          if (removed.length > 0) {
            const removedIds = new Set(removed);
            for (const [id, entry] of entries) {
              if (!entry.agent.workspaceId || !removedIds.has(entry.agent.workspaceId)) continue;
              const project = projectFor(entry, undefined, projects);
              baseCards.set(id, buildBaseCard(entry, undefined, project, colorNames, modelCatalogs.get(entry.agent.provider), project ? projectIcons.get(project.projectId) : undefined));
              refreshFinalCard(id);
            }
          }
          notify();
        });
      }, (message) => {
        const envelope = message as WorkspaceUpdateEnvelope;
        if (envelope.type !== "workspace_update" || !envelope.payload) return;
        if (envelope.payload.kind === "upsert" && envelope.payload.workspace) updateWorkspace(envelope.payload.workspace);
        else if (envelope.payload.kind === "remove" && envelope.payload.id) {
          workspaces.delete(envelope.payload.id);
          for (const [id, entry] of entries) {
            if (entry.agent.workspaceId !== envelope.payload.id) continue;
            const base = buildBaseCard(entry, undefined, projectFor(entry, undefined, projects), colorNames, modelCatalogs.get(entry.agent.provider), undefined);
            baseCards.set(id, base);
            refreshFinalCard(id);
          }
          notify();
        }
      });
    } catch (caught) {
      if (run === generation) subscriptionError(caught);
    }
  }

  function applyLabelDefinitions(labels: Array<{ name: string; color: string }>) {
    colorNames.clear();
    for (const label of labels) colorNames.set(label.name, LABEL_COLORS[label.color] ?? "#94a3b8");
    for (const [id, entry] of entries) {
      const workspace = entry.agent.workspaceId ? workspaces.get(entry.agent.workspaceId) : undefined;
      const project = projectFor(entry, workspace, projects);
      const projectId = workspace?.projectId ?? project?.projectId ?? null;
      baseCards.set(id, buildBaseCard(entry, workspace, project, colorNames, modelCatalogs.get(entry.agent.provider), projectId ? projectIcons.get(projectId) : undefined));
      refreshFinalCard(id);
    }
    notify();
  }

  async function startLabelSubscription(run: number) {
    const labelApi = api.workspaces as unknown as OptionalLabelsApi;
    if (typeof labelApi.listLabels !== "function") return;
    try {
      const result = await labelApi.listLabels({ subscribe: {} });
      if (run !== generation || consumers === 0) {
        await result.subscription?.release();
        return;
      }
      if (!result.subscription) {
        applyLabelDefinitions(result.labels);
        return;
      }
      const pending: Array<{ kind: "snapshot"; labels: Array<{ name: string; color: string }> } | { kind: "update"; value: unknown }> = [];
      let initialApplied = false;
      const observer = {
        snapshot: (snapshot: { labels: Array<{ name: string; color: string }> }) => {
          if (initialApplied) applyLabelDefinitions(snapshot.labels);
          else pending.push({ kind: "snapshot", labels: snapshot.labels });
        },
        update: (message: unknown) => {
          if (initialApplied) applyLabelUpdate(message);
          else pending.push({ kind: "update", value: message });
        },
        error: subscriptionError,
      };
      const stopObserver = result.subscription.subscribe(observer);
      subscriptions.set("labels", { stopObserver, release: () => { void result.subscription?.release(); } });
      const ready = await result.subscription.ready;
      if (run !== generation) return;
      applyLabelDefinitions(ready.labels);
      initialApplied = true;
      for (const event of pending) {
        if (event.kind === "snapshot") applyLabelDefinitions(event.labels);
        else applyLabelUpdate(event.value);
      }
    } catch (caught) {
      if (run === generation) subscriptionError(caught);
    }
  }

  function applyLabelUpdate(message: unknown) {
    const envelope = message as { type?: string; payload?: { labels?: Array<{ name: string; color: string }> } };
    if (envelope.type === "workspace.label.update" && envelope.payload?.labels) applyLabelDefinitions(envelope.payload.labels);
  }

  function applyProject(project: PaseoProject) {
    const previous = projects.get(project.projectId);
    projects.set(project.projectId, project);
    if (previous?.projectIconRevision !== project.projectIconRevision) {
      const icon = projectIcons.get(project.projectId);
      if (icon && icon.revision !== (project.projectIconRevision ?? null)) projectIcons.delete(project.projectId);
    }
    for (const [id, entry] of entries) {
      const workspace = entry.agent.workspaceId ? workspaces.get(entry.agent.workspaceId) : undefined;
      const projectId = workspace?.projectId ?? projectFor(entry, workspace, projects)?.projectId ?? null;
      if (projectId !== project.projectId) continue;
      baseCards.set(id, buildBaseCard(entry, workspace, project, colorNames, modelCatalogs.get(entry.agent.provider), projectIcons.get(project.projectId)));
      refreshFinalCard(id);
      for (const childId of childrenByParent.get(id) ?? []) refreshFinalCard(childId);
    }
    notify();
  }

  function applyProjectUpdate(update: PaseoProjectUpdate) {
    const payload = update as { kind?: string; project?: PaseoProject; projectId?: string };
    if (payload.kind === "upsert" && payload.project) applyProject(payload.project);
    else if (payload.kind === "remove" && payload.projectId) {
      const removed = projects.get(payload.projectId);
      projects.delete(payload.projectId);
      projectIcons.delete(payload.projectId);
      for (const [id, entry] of entries) {
        const workspace = entry.agent.workspaceId ? workspaces.get(entry.agent.workspaceId) : undefined;
        const matchesProject = workspace?.projectId === payload.projectId || Boolean(removed?.projectKey && entry.placement?.projectKey === removed.projectKey);
        if (!matchesProject) continue;
        baseCards.set(id, buildBaseCard(entry, workspace, undefined, colorNames, modelCatalogs.get(entry.agent.provider), undefined));
        refreshFinalCard(id);
      }
      notify();
    }
  }

  async function startProjects(run: number) {
    const iconsApi = api.projects as PaseoApi["projects"] & OptionalProjectIconsApi;
    if (typeof iconsApi.icon !== "function") return;
    const queued: Array<unknown> = [];
    let initialApplied = false;
    projectUnsubscribes.push(api.projects.subscribe((update) => {
      if (initialApplied) applyProjectUpdate(update);
      else queued.push(update);
    }));
    try {
      const result = await api.projects.list();
      if (run !== generation || consumers === 0) return;
      batchUpdates(() => {
        for (const project of result.projects) applyProject(project);
        initialApplied = true;
        for (const update of queued) applyProjectUpdate(update as PaseoProjectUpdate);
      });
    } catch (caught) {
      if (run === generation) subscriptionError(caught);
    }
  }

  function refreshWorkspaceCards(workspaceId: string) {
    for (const [id, entry] of entries) {
      if (entry.agent.workspaceId !== workspaceId) continue;
      const workspace = workspaces.get(workspaceId);
      const project = workspace ? projects.get(workspace.projectId) : undefined;
      baseCards.set(id, buildBaseCard(entry, workspace, project, colorNames, modelCatalogs.get(entry.agent.provider), project ? projectIcons.get(project.projectId) : undefined));
      refreshFinalCard(id);
      for (const childId of childrenByParent.get(id) ?? []) refreshFinalCard(childId);
    }
  }

  function startActive(run: number) {
    for (const { key, filter } of ACTIVE_SUBSCRIPTIONS) {
      sourceMembers.set(key, new Set());
      void openAgentSubscription(key, activeOptions(filter), run);
    }
    void startWorkspaceSubscription(run);
    void startLabelSubscription(run);
    void startProjects(run);
  }

  function startDone(run: number) {
    sourceMembers.set(DONE_SUBSCRIPTION, new Set());
    void openAgentSubscription(DONE_SUBSCRIPTION, {
      filter: { statuses: ["idle", "closed"] },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: PAGE_SIZE },
      subscribe: {},
    }, run);
  }

  function stopSubscription(key: string) {
    const subscription = subscriptions.get(key);
    if (!subscription) return;
    subscriptions.delete(key);
    subscription.stopObserver();
    subscription.release();
  }

  function stopDone() {
    stopSubscription(DONE_SUBSCRIPTION);
    for (const key of [...sourceMembers.keys()]) if (key === DONE_SUBSCRIPTION || key.startsWith("done-page-")) sourceMembers.delete(key);
    for (const id of [...entries.keys()]) if (memberSetsContaining(id).length === 0) dropIfUnreferenced(id);
    doneCursor = null;
    doneTailAt = null;
    loadingDone = false;
    notify();
  }

  function stopAll() {
    generation += 1;
    for (const key of [...subscriptions.keys()]) stopSubscription(key);
    for (const unsubscribe of projectUnsubscribes.splice(0)) unsubscribe();
    for (const key of [...sourceMembers.keys()]) sourceMembers.delete(key);
    entries.clear();
    baseCards.clear();
    cards.clear();
    childrenByParent.clear();
    parentByChild.clear();
    resolvedParentTitles.clear();
    workspaces.clear();
    projects.clear();
    colorNames.clear();
    modelCatalogs.clear();
    modelRequests.clear();
    projectIcons.clear();
    iconRequests.clear();
    activeReady = false;
    doneCursor = null;
    doneTailAt = null;
    loadingDone = false;
    error = null;
    notify();
  }

  function upsertWorkspacesOptions(): WorkspaceOption[] {
    return [...workspaces.values()]
      .filter((workspace) => !workspace.archivingAt)
      .map((workspace) => ({
        id: workspace.id,
        name: workspace.title?.trim() || workspace.name,
        projectId: workspace.projectId,
        projectName: workspace.projectCustomName?.trim() || workspace.projectDisplayName,
      }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name));
  }

  function getSnapshot(options: TasksOptions): TasksHandle {
    const cacheKey = `${options.includeDone ? "done" : "active"}:${options.doneWindow}`;
    const cached = snapshotCaches.find((entry) => entry.key === cacheKey)?.snapshot;
    if (cached) return cached as TasksHandle;
    const cutoff = doneWindowMs(options.doneWindow);
    const now = Date.now();
    const filteredCards = [...cards.values()].filter((card) => {
      if (card.lane !== "done") return true;
      if (!options.includeDone) return false;
      if (cutoff === null) return true;
      const updatedAt = Date.parse(card.timing.updatedAt);
      return Number.isFinite(updatedAt) && now - updatedAt <= cutoff;
    });
    const byId = new Map(filteredCards.map((card) => [card.id, card]));
    const lanes = {} as Record<LaneId, LaneModel>;
    for (const lane of LANE_ORDER) {
      const laneCards = filteredCards.filter((card) => card.lane === lane);
      laneCards.sort((left, right) => {
        if (lane === "needs_input") return timestamp(left.timing.attentionAt, Number.POSITIVE_INFINITY) - timestamp(right.timing.attentionAt, Number.POSITIVE_INFINITY);
        if (lane === "running") return timestamp(left.timing.turnStartedAt, Number.POSITIVE_INFINITY) - timestamp(right.timing.turnStartedAt, Number.POSITIVE_INFINITY);
        if (lane === "review") return timestamp(right.timing.attentionAt ?? right.timing.updatedAt, Number.NEGATIVE_INFINITY) - timestamp(left.timing.attentionAt ?? left.timing.updatedAt, Number.NEGATIVE_INFINITY);
        return timestamp(right.timing.updatedAt, Number.NEGATIVE_INFINITY) - timestamp(left.timing.updatedAt, Number.NEGATIVE_INFINITY);
      });
      const tailOld = cutoff !== null && doneTailAt !== null && Number.isFinite(Date.parse(doneTailAt)) && now - Date.parse(doneTailAt) > cutoff;
      lanes[lane] = {
        id: lane,
        cards: laneCards,
        hasMore: lane === "done" && options.includeDone && Boolean(doneCursor) && !tailOld,
        loading: lane === "done" && loadingDone,
      };
    }
    const providersById = new Map<string, string>();
    const labelsByName = new Map<string, TaskLabel>();
    for (const card of filteredCards) {
      providersById.set(card.provider, card.providerLabel);
      for (const label of card.labels) labelsByName.set(label.name, label);
    }
    const counts: BoardCounts = {
      needsInput: lanes.needs_input.cards.length,
      running: lanes.running.cards.length,
      review: lanes.review.cards.length,
      done: lanes.done.cards.length,
    };
    const snapshot: TasksHandle = {
      lanes,
      counts,
      byId,
      workspaces: upsertWorkspacesOptions(),
      providers: [...providersById].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
      labels: [...labelsByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
      ready: activeReady,
      error,
      loadMoreDone: () => { if (options.includeDone) loadMoreDone(options.doneWindow); },
      resolveParent,
      requestProjectIcon,
    };
    snapshotCaches.push({ key: cacheKey, snapshot });
    return snapshot;
  }

  function timestamp(value: string | null, missing: number): number {
    if (!value) return missing;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : missing;
  }

  function loadMoreDone(window: DoneWindow) {
    if (loadingDone || !doneCursor || doneConsumers === 0) return;
    const cutoff = doneWindowMs(window);
    const tailTime = doneTailAt ? Date.parse(doneTailAt) : Number.NaN;
    if (cutoff !== null && Number.isFinite(tailTime) && Date.now() - tailTime > cutoff) return;
    const cursor = doneCursor;
    const run = generation;
    loadingDone = true;
    notify();
    void api.agents.list({
      filter: { statuses: ["idle", "closed"] },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: PAGE_SIZE, cursor },
    }).then((result) => {
      if (run !== generation || doneConsumers === 0) return;
      const key = `done-page-${cursor}`;
      batchUpdates(() => {
        const pageMembers = new Set<string>();
        for (const entry of matchingEntries(result)) {
          pageMembers.add(entry.agent.id);
          updateRecord(entry.agent, entry.project ?? null);
        }
        sourceMembers.set(key, pageMembers);
        doneCursor = result.pageInfo.nextCursor;
        doneTailAt = result.entries.at(-1)?.agent.updatedAt ?? doneTailAt;
        notify();
      });
    }).catch(subscriptionError).finally(() => {
      if (run !== generation) return;
      loadingDone = false;
      notify();
    });
  }

  function resolveParent(id: string) {
    if (resolvedParentTitles.has(id)) return;
    resolvedParentTitles.set(id, null);
    const run = generation;
    void api.agents.ref(id).refresh().then((result) => {
      if (run !== generation) return;
      if (!result) return;
      resolvedParentTitles.set(id, result.agent.title?.trim() || null);
      for (const childId of childrenByParent.get(id) ?? []) refreshFinalCard(childId);
      notify();
    }).catch(subscriptionError);
  }

  function requestProjectIcon(projectId: string) {
    const iconApi = api.projects as PaseoApi["projects"] & OptionalProjectIconsApi;
    if (typeof iconApi.icon !== "function") return;
    const revision = projects.get(projectId)?.projectIconRevision ?? null;
    const cached = projectIcons.get(projectId);
    if (cached?.revision === revision) return;
    const requestKey = `${projectId}:${revision ?? ""}`;
    if (iconRequests.has(requestKey)) return;
    iconRequests.add(requestKey);
    const run = generation;
    void iconApi.icon(projectId).then((result) => {
      iconRequests.delete(requestKey);
      if (run !== generation || (projects.get(projectId)?.projectIconRevision ?? null) !== revision) return;
      const data = result.icon;
      const uri = data ? `data:${data.mimeType};base64,${data.data}` : null;
      projectIcons.set(projectId, { revision, uri });
      for (const [id, entry] of entries) {
        const workspace = entry.agent.workspaceId ? workspaces.get(entry.agent.workspaceId) : undefined;
        const entryProjectId = workspace?.projectId ?? projectFor(entry, workspace, projects)?.projectId ?? null;
        if (entryProjectId !== projectId) continue;
        baseCards.set(id, buildBaseCard(entry, workspace, projects.get(projectId), colorNames, modelCatalogs.get(entry.agent.provider), { revision, uri }));
        refreshFinalCard(id);
      }
      notify();
    }).catch((caught: unknown) => {
      iconRequests.delete(requestKey);
      if (run === generation) subscriptionError(caught);
    });
  }

  return {
    subscribe(listener, includeDone) {
      listeners.add(listener);
      consumers += 1;
      if (consumers === 1) {
        const run = ++generation;
        activeReady = false;
        startActive(run);
      }
      if (includeDone) {
        doneConsumers += 1;
        if (doneConsumers === 1) startDone(generation);
      }
      return () => {
        listeners.delete(listener);
        consumers = Math.max(0, consumers - 1);
        if (includeDone) {
          doneConsumers = Math.max(0, doneConsumers - 1);
          if (doneConsumers === 0) stopDone();
        }
        if (consumers === 0) stopAll();
      };
    },
    getSnapshot,
    loadMoreDone,
    resolveParent,
    requestProjectIcon,
  };
}

function getStore(api: PaseoApi): TaskStore {
  let store = stores.get(api);
  if (!store) {
    store = createStore(api);
    stores.set(api, store);
  }
  return store;
}

/** All lanes, all subscriptions. The board screen calls this once. */
export function useTasks(paseo: PaseoApi, options: TasksOptions): TasksHandle {
  const store = getStore(paseo);
  const subscribe = useMemo(() => (listener: () => void) => store.subscribe(listener, options.includeDone), [store, options.includeDone]);
  const getSnapshot = useMemo(() => () => store.getSnapshot(options), [store, options.doneWindow, options.includeDone]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Counts from the active subscription only; the sidebar entry calls this. */
export function useTaskCounts(paseo: PaseoApi): BoardCounts & { ready: boolean } {
  const snapshot = useTasks(paseo, { doneWindow: "24h", includeDone: false });
  return { ...snapshot.counts, ready: snapshot.ready };
}

/** The lanes after the filter bar and search; pure. Hidden subtasks stay on their parent's card. */
export function filterLanes(lanes: Record<LaneId, LaneModel>, filters: BoardFilters): Record<LaneId, LaneModel> {
  const query = filters.query.trim().toLowerCase();
  const keep = (card: TaskCard) => {
    const searchable = [card.title, card.location.projectName, card.location.workspaceName, card.location.branch]
      .filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
    return (!query || searchable.includes(query)) &&
      (filters.workspaceIds.length === 0 || (card.location.workspaceId !== null && filters.workspaceIds.includes(card.location.workspaceId))) &&
      (filters.providers.length === 0 || filters.providers.includes(card.provider)) &&
      (filters.labels.length === 0 || card.labels.some((label) => filters.labels.includes(label.name))) &&
      (!filters.openTabsOnly || card.openTab) &&
      (!filters.hideSubtasks || card.parent === null);
  };
  const out = {} as Record<LaneId, LaneModel>;
  for (const id of LANE_ORDER) out[id] = { ...lanes[id], cards: lanes[id].cards.filter(keep) };
  return out;
}
