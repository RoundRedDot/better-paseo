/**
 * A stand-in for the host's `PaseoApi`, for the Tasks board's tests.
 *
 * It keeps a table of agents, workspaces, projects and label definitions and
 * answers the calls the board makes: `agents.list` (filter, sort, page, and a
 * subscription), `agents.ref(id)` (`respondToPermission`, `refresh`),
 * `workspaces.list` (with a subscription), `projects.list`,
 * `providers.listModels` (with `providerEntries`, also `providers.snapshot`
 * and its subscription), and, when the host is new enough
 * (`withLabelsAndIcons`), `workspaces.listLabels` and `projects.icon` from
 * getpaseo/paseo#7482.
 *
 * Changing the table (`upsertAgent`, `removeAgent`, `upsertWorkspace`) pushes
 * the same `agent_update` / `workspace_update` messages a daemon does to every
 * open subscription. Every changed agent produces an upsert for matching
 * subscriptions and a remove for non-matching subscriptions, even if that
 * subscription never included the agent in its current snapshot.
 *
 * `calls` records every request, so a test can assert how many lists the board
 * opened and with what options.
 */
import type {
  PaseoAgent,
  PaseoAgentListOptions,
  PaseoAgentRespondToPermissionOptions,
  PaseoApi,
  PaseoProject,
  PaseoProviderModelsResult,
  PaseoWorkspace,
  PaseoWorkspaceListOptions,
} from "@getpaseo/client";

type Agent = PaseoAgent;
type Placement = {
  projectKey: string;
  projectName: string;
  workspaceName?: string | null;
  checkout: {
    cwd: string;
    isGit: boolean;
    currentBranch: string | null;
    remoteUrl: string | null;
    worktreeRoot: string | null;
    isPaseoOwnedWorktree: boolean;
    mainRepoRoot: string | null;
  };
};

export interface FakeLabelDefinition {
  name: string;
  color: string;
}

export interface FakeCall {
  method: string;
  input: unknown;
}

interface Observer {
  snapshot(snapshot: unknown): void;
  update(message: unknown): void;
  error?(error: unknown): void;
}

interface AgentSubscription {
  id: string;
  options: PaseoAgentListOptions;
  observers: Set<Observer>;
  members: Set<string>;
  snapshot: () => unknown;
  released: boolean;
}

interface PlainSubscription {
  id: string;
  observers: Set<Observer>;
  snapshot: () => unknown;
  released: boolean;
  workspaceFilter?: PaseoWorkspaceListOptions["filter"];
}

const BASE_TIME = Date.parse("2026-10-20T08:00:00.000Z");

/** An ISO time `minutes` after a fixed base, so fixtures sort predictably. */
export function at(minutes: number): string {
  return new Date(BASE_TIME + minutes * 60_000).toISOString();
}

/** An agent snapshot with sensible defaults; override anything. */
export function makeAgent(overrides: Partial<Agent> & { id: string }): Agent {
  const base = {
    provider: "claude",
    cwd: `/Users/dev/code/project-${overrides.id}`,
    workspaceId: `ws-${overrides.id}`,
    model: "claude-opus-5-5",
    thinkingOptionId: null,
    effectiveThinkingOptionId: "high",
    createdAt: at(0),
    updatedAt: at(10),
    lastUserMessageAt: at(1),
    status: "idle",
    activeTurn: null,
    capabilities: {},
    currentModeId: "default",
    availableModes: [{ id: "default", label: "Default" }],
    pendingPermissions: [],
    persistence: null,
    title: `Task ${overrides.id}`,
    labels: {},
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
  };
  return { ...base, ...overrides } as unknown as Agent;
}

/** A placement matching `makeAgent`'s defaults. */
export function makePlacement(agent: Agent, overrides: Partial<Placement> = {}): Placement {
  return {
    projectKey: `project-${agent.id}`,
    projectName: `project-${agent.id}`,
    workspaceName: null,
    checkout: {
      cwd: agent.cwd,
      isGit: true,
      currentBranch: "main",
      remoteUrl: null,
      worktreeRoot: agent.cwd,
      isPaseoOwnedWorktree: false,
      mainRepoRoot: null,
    },
    ...overrides,
  };
}

/** A workspace descriptor; override anything. */
export function makeWorkspace(overrides: Partial<PaseoWorkspace> & { id: string }): PaseoWorkspace {
  const base = {
    projectId: `prj-${overrides.id}`,
    projectDisplayName: `project-${overrides.id}`,
    projectRootPath: `/Users/dev/code/project-${overrides.id}`,
    workspaceDirectory: `/Users/dev/code/project-${overrides.id}`,
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    title: null,
    labels: [],
    archivingAt: null,
    status: "done",
    statusEnteredAt: null,
    activityAt: null,
    diffStat: null,
    scripts: [],
    gitRuntime: { currentBranch: "main", isDirty: false, aheadBehind: { ahead: 0, behind: 0 } },
    githubRuntime: null,
  };
  return { ...base, ...overrides } as unknown as PaseoWorkspace;
}

export interface FakeProviderEntry {
  provider: string;
  enabled?: boolean;
  label?: string;
  status?: "ready" | "loading" | "error" | "unavailable";
}

export interface FakePaseoOptions {
  agents?: Agent[];
  placements?: Record<string, Placement>;
  workspaces?: PaseoWorkspace[];
  projects?: PaseoProject[];
  /** Models per provider id. */
  models?: Record<string, PaseoProviderModelsResult["models"]>;
  /** Expose `workspaces.listLabels` and `projects.icon` (getpaseo/paseo#7482). */
  withLabelsAndIcons?: boolean;
  labels?: FakeLabelDefinition[];
  /** `data` (base64) and `mimeType` per project id. */
  projectIcons?: Record<string, { data: string; mimeType: string } | null>;
  /** The providers snapshot's entries; without them the host has no `providers.snapshot`. */
  providerEntries?: FakeProviderEntry[];
  /** Subscriptions never answer, as on a host that has not caught up after a reconnect. */
  stalled?: boolean;
}

const STATUS_PRIORITY: Record<string, number> = { running: 2, initializing: 3, error: 1, idle: 4, closed: 4 };

function matches(agent: Agent, options: PaseoAgentListOptions): boolean {
  const filter = options.filter;
  if (!filter?.includeArchived && agent.archivedAt) return false;
  if (filter?.statuses && !filter.statuses.includes(agent.status)) return false;
  if (filter?.requiresAttention !== undefined && Boolean(agent.requiresAttention) !== filter.requiresAttention) {
    return false;
  }
  if (filter?.labels) {
    for (const [key, value] of Object.entries(filter.labels)) {
      if (agent.labels?.[key] !== value) return false;
    }
  }
  return true;
}

function compare(left: Agent, right: Agent, options: PaseoAgentListOptions): number {
  for (const { key, direction } of options.sort ?? [{ key: "updated_at", direction: "desc" }]) {
    const sign = direction === "asc" ? 1 : -1;
    let delta = 0;
    if (key === "updated_at") delta = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    else if (key === "created_at") delta = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    else if (key === "title") delta = (left.title ?? "").localeCompare(right.title ?? "");
    else if (key === "status_priority") delta = (STATUS_PRIORITY[left.status] ?? 9) - (STATUS_PRIORITY[right.status] ?? 9);
    if (delta !== 0) return sign * delta;
  }
  return left.id.localeCompare(right.id);
}

export function createFakePaseo(options: FakePaseoOptions = {}) {
  const agents = new Map<string, Agent>((options.agents ?? []).map((agent) => [agent.id, agent]));
  const placements = new Map<string, Placement>(Object.entries(options.placements ?? {}));
  const workspaces = new Map<string, PaseoWorkspace>((options.workspaces ?? []).map((ws) => [ws.id, ws]));
  // Without workspaces of its own, a fixture still has each agent's: Paseo
  // lists every workspace that is not archived, and an agent outside the list
  // belongs to an archived one.
  const autoWorkspaces = options.workspaces === undefined;
  const ensureWorkspace = (agent: Agent) => {
    if (!autoWorkspaces || !agent.workspaceId || workspaces.has(agent.workspaceId)) return null;
    const workspace = makeWorkspace({ id: agent.workspaceId });
    workspaces.set(workspace.id, workspace);
    return workspace;
  };
  for (const agent of agents.values()) ensureWorkspace(agent);
  let projects = [...(options.projects ?? [])];
  let labels = [...(options.labels ?? [])];
  const calls: FakeCall[] = [];
  const permissionResponses: Array<{ agentId: string } & PaseoAgentRespondToPermissionOptions> = [];
  const agentSubs = new Set<AgentSubscription>();
  const workspaceSubs = new Set<PlainSubscription>();
  const labelSubs = new Set<PlainSubscription>();
  const projectSubs = new Set<(update: unknown) => void>();
  let nextId = 1;
  /** Holds the ready of subscriptions opened while it is set (`holdReady`); their snapshot is still taken when asked. */
  let readyGate: Promise<void> | null = null;
  /** `agents.list` calls to reject, first match first (`failNextAgentList`). */
  const listFailures: Array<{ match: (options: PaseoAgentListOptions) => boolean; message: string }> = [];

  const placementOf = (agent: Agent) => placements.get(agent.id) ?? makePlacement(agent);

  function matchesAgent(agent: Agent, listOptions: PaseoAgentListOptions): boolean {
    if (!listOptions.filter?.includeBackground && agent.workspaceId && workspaces.get(agent.workspaceId)?.background) return false;
    return matches(agent, listOptions);
  }

  function page(listOptions: PaseoAgentListOptions) {
    const sorted = [...agents.values()].filter((agent) => matchesAgent(agent, listOptions)).sort((a, b) => compare(a, b, listOptions));
    const start = listOptions.page?.cursor ? Number(listOptions.page.cursor) : 0;
    const limit = listOptions.page?.limit ?? sorted.length;
    const slice = sorted.slice(start, start + limit);
    const next = start + limit < sorted.length ? String(start + limit) : null;
    return {
      entries: slice.map((agent) => ({ agent, project: placementOf(agent) })),
      pageInfo: { nextCursor: next, prevCursor: start > 0 ? String(Math.max(0, start - limit)) : null, hasMore: next !== null },
    };
  }

  function makeSubscription<T>(sub: PlainSubscription | AgentSubscription, snapshot: () => T, onRelease: () => void) {
    sub.snapshot = snapshot;
    return {
      get subscriptionId() {
        return sub.released ? null : sub.id;
      },
      ready: options.stalled ? new Promise<never>(() => {}) : (() => {
        const value = { ...snapshot(), subscriptionId: sub.id };
        return (readyGate ?? Promise.resolve()).then(() => value);
      })(),
      subscribe(observer: Observer) {
        sub.observers.add(observer);
        return () => sub.observers.delete(observer);
      },
      async release() {
        sub.released = true;
        sub.observers.clear();
        onRelease();
      },
    };
  }

  function pushAgent(agent: Agent | null, removedId: string | null) {
    for (const sub of agentSubs) {
      const id = agent?.id ?? removedId!;
      const inNow = agent !== null && matchesAgent(agent, sub.options);
      if (inNow) {
        sub.members.add(id);
        const message = { type: "agent_update", payload: { subscriptionId: sub.id, kind: "upsert", agent, project: placementOf(agent!) } };
        for (const observer of sub.observers) observer.update(message);
      } else {
        sub.members.delete(id);
        const message = { type: "agent_update", payload: { subscriptionId: sub.id, kind: "remove", agentId: id } };
        for (const observer of sub.observers) observer.update(message);
      }
    }
  }

  const agentActions = {
    async list(listOptions: PaseoAgentListOptions = {}) {
      calls.push({ method: "agents.list", input: listOptions });
      const failure = listFailures.findIndex((entry) => entry.match(listOptions));
      if (failure >= 0) throw new Error(listFailures.splice(failure, 1)[0]!.message);
      const result = { requestId: `req-${nextId++}`, ...page(listOptions) };
      if (!listOptions.subscribe) return result;
      const sub: AgentSubscription = {
        id: `sub-${nextId++}`,
        options: listOptions,
        observers: new Set(),
        members: new Set([...agents.values()].filter((agent) => matchesAgent(agent, listOptions)).map((agent) => agent.id)),
        snapshot: () => ({ requestId: result.requestId, ...page(listOptions) }),
        released: false,
      };
      agentSubs.add(sub);
      const subscription = makeSubscription(sub, () => ({ requestId: result.requestId, ...page(listOptions) }), () => agentSubs.delete(sub));
      return { ...result, subscriptionId: sub.id, subscription };
    },
    ref(agent: string | Agent) {
      const id = typeof agent === "string" ? agent : agent.id;
      return {
        id,
        current: () => agents.get(id) ?? null,
        async refresh() {
          calls.push({ method: "agents.ref.refresh", input: { agentId: id } });
          const found = agents.get(id);
          return found ? { agent: found, project: placementOf(found) } : null;
        },
        async respondToPermission(input: PaseoAgentRespondToPermissionOptions) {
          calls.push({ method: "agents.ref.respondToPermission", input: { agentId: id, ...input } });
          permissionResponses.push({ agentId: id, ...input });
        },
      };
    },
    subscribe() {
      return () => {};
    },
  };

  const workspaceActions: Record<string, unknown> = {
    async list(listOptions: PaseoWorkspaceListOptions = {}) {
      calls.push({ method: "workspaces.list", input: listOptions });
      const listed = () => [...workspaces.values()].filter((workspace) => listOptions.filter?.includeBackground || !workspace.background);
      const result = {
        requestId: `req-${nextId++}`,
        entries: listed(),
        pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
      };
      if (!listOptions.subscribe) return result;
      const sub: PlainSubscription = {
        id: `sub-${nextId++}`,
        workspaceFilter: listOptions.filter,
        observers: new Set(),
        snapshot: () => ({ requestId: result.requestId, entries: listed(), pageInfo: result.pageInfo }),
        released: false,
      };
      workspaceSubs.add(sub);
      return {
        ...result,
        subscriptionId: sub.id,
        subscription: makeSubscription(sub, () => ({ requestId: result.requestId, entries: listed(), pageInfo: result.pageInfo }), () => workspaceSubs.delete(sub)),
      };
    },
    subscribe() {
      return () => {};
    },
  };

  const projectActions: Record<string, unknown> = {
    async list() {
      calls.push({ method: "projects.list", input: {} });
      return { requestId: `req-${nextId++}`, projects };
    },
    subscribe(handler: (update: unknown) => void) {
      projectSubs.add(handler);
      return () => projectSubs.delete(handler);
    },
  };

  if (options.withLabelsAndIcons) {
    workspaceActions.listLabels = async (listOptions: { subscribe?: {} } = {}) => {
      calls.push({ method: "workspaces.listLabels", input: listOptions });
      const result = { requestId: `req-${nextId++}`, labels: [...labels] };
      if (!listOptions.subscribe) return result;
      const sub: PlainSubscription = {
        id: `sub-${nextId++}`,
        observers: new Set(),
        snapshot: () => ({ requestId: result.requestId, labels: [...labels] }),
        released: false,
      };
      labelSubs.add(sub);
      return {
        ...result,
        subscriptionId: sub.id,
        subscription: makeSubscription(sub, () => ({ requestId: result.requestId, labels: [...labels] }), () => labelSubs.delete(sub)),
      };
    };
    projectActions.icon = async (projectId: string) => {
      calls.push({ method: "projects.icon", input: { projectId } });
      return { projectId, icon: options.projectIcons?.[projectId] ?? null, error: null, requestId: `req-${nextId++}` };
    };
  }

  const providerSubs = new Set<(update: { entries: FakeProviderEntry[] }) => void>();
  let providerEntries = options.providerEntries;
  const providerActions: Record<string, unknown> = {
    async listModels(provider: string, listOptions?: { cwd?: string }) {
      calls.push({ method: "providers.listModels", input: { provider, ...listOptions } });
      return { provider, models: options.models?.[provider] ?? [], error: null, fetchedAt: at(0) } as unknown as PaseoProviderModelsResult;
    },
  };
  if (providerEntries) {
    providerActions.snapshot = async () => {
      calls.push({ method: "providers.snapshot", input: {} });
      return { entries: providerEntries!.map((entry) => ({ status: "ready", ...entry })), generatedAt: at(0), requestId: `req-${nextId++}` };
    };
    providerActions.subscribe = (handler: (update: { entries: FakeProviderEntry[] }) => void) => {
      providerSubs.add(handler);
      return () => providerSubs.delete(handler);
    };
  }

  const paseo = {
    agents: agentActions,
    workspaces: workspaceActions,
    projects: projectActions,
    providers: providerActions,
    async dispose() {},
  } as unknown as PaseoApi;

  return {
    paseo,
    calls,
    permissionResponses,
    /** Open subscriptions, so a test can check that the board released them. */
    openSubscriptions: () => agentSubs.size + workspaceSubs.size + labelSubs.size + projectSubs.size + providerSubs.size,
    /** Change the providers snapshot and push it as a `providers_snapshot_update`. */
    updateProviders(entries: FakeProviderEntry[]) {
      providerEntries = entries;
      for (const handler of providerSubs) handler({ entries: entries.map((entry) => ({ status: "ready", ...entry })) });
    },
    upsertAgent(agent: Agent, placement?: Placement) {
      const workspace = ensureWorkspace(agent);
      if (workspace) this.upsertWorkspace(workspace);
      agents.set(agent.id, agent);
      if (placement) placements.set(agent.id, placement);
      pushAgent(agent, null);
    },
    removeAgent(agentId: string) {
      agents.delete(agentId);
      pushAgent(null, agentId);
    },
    /** Drop an agent without telling any subscription, as a delete made by another client looks to this one. */
    forgetAgent(agentId: string) {
      agents.delete(agentId);
    },
    /** Hold the ready of every subscription opened from now on until the returned function runs, as a slow daemon answers. */
    holdReady(): () => void {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => { open = resolve; });
      readyGate = gate;
      return () => {
        if (readyGate === gate) readyGate = null;
        open();
      };
    },
    /** Open subscriptions without the hold again; those opened under it stay held until its release. */
    stopHolding() {
      readyGate = null;
    },
    /** Reject the next `agents.list` whose options match. */
    failNextAgentList(match: (options: PaseoAgentListOptions) => boolean = () => true, message = "agents.list failed") {
      listFailures.push({ match, message });
    },
    /** Push an agent's updates without changing the table, as a daemon sends a snapshot it took earlier. */
    pushAgentSnapshot(agent: Agent) {
      pushAgent(agent, null);
    },
    removeFromStatusSubscription(agentId: string) {
      for (const sub of agentSubs) {
        if (!sub.options.filter?.statuses?.includes("running")) continue;
        sub.members.delete(agentId);
        const message = { type: "agent_update", payload: { subscriptionId: sub.id, kind: "remove", agentId } };
        for (const observer of sub.observers) observer.update(message);
      }
    },
    removeFromAgentSubscriptions(agentId: string) {
      for (const sub of agentSubs) {
        if (!sub.members.delete(agentId)) continue;
        const message = { type: "agent_update", payload: { subscriptionId: sub.id, kind: "remove", agentId } };
        for (const observer of sub.observers) observer.update(message);
      }
    },
    setAgentSilently(agent: Agent, placement?: Placement) {
      ensureWorkspace(agent);
      agents.set(agent.id, agent);
      if (placement) placements.set(agent.id, placement);
    },
    upsertWorkspace(workspace: PaseoWorkspace) {
      workspaces.set(workspace.id, workspace);
      for (const sub of workspaceSubs) {
        const payload = workspace.background && !sub.workspaceFilter?.includeBackground
          ? { subscriptionId: sub.id, kind: "remove", id: workspace.id }
          : { subscriptionId: sub.id, kind: "upsert", workspace };
        const message = { type: "workspace_update", payload };
        for (const observer of sub.observers) observer.update(message);
      }
    },
    /** Archive a workspace: the list leaves it out, and its agents stay unarchived. */
    removeWorkspace(id: string) {
      workspaces.delete(id);
      for (const sub of workspaceSubs) {
        const message = { type: "workspace_update", payload: { subscriptionId: sub.id, kind: "remove", id } };
        for (const observer of sub.observers) observer.update(message);
      }
    },
    setLabels(next: FakeLabelDefinition[]) {
      labels = [...next];
      for (const sub of labelSubs) {
        const message = { type: "workspace.label.update", payload: { subscriptionId: sub.id, labels } };
        for (const observer of sub.observers) observer.update(message);
      }
    },
    upsertProject(project: PaseoProject) {
      projects = [...projects.filter((entry) => entry.projectId !== project.projectId), project];
      const update = { kind: "upsert", project };
      for (const observer of projectSubs) observer(update);
    },
    removeProject(projectId: string) {
      projects = projects.filter((project) => project.projectId !== projectId);
      const update = { kind: "remove", projectId };
      for (const observer of projectSubs) observer(update);
    },
    reconnectAgentSubscription(index = 0) {
      const sub = [...agentSubs][index];
      if (!sub) return;
      sub.members = new Set([...agents.values()].filter((agent) => matchesAgent(agent, sub.options)).map((agent) => agent.id));
      const snapshot = { ...(sub.snapshot() as object), subscriptionId: sub.id };
      for (const observer of sub.observers) observer.snapshot(snapshot);
    },
    reconnectSubscriptions() {
      for (const sub of agentSubs) {
        if ("members" in sub) sub.members = new Set([...agents.values()].filter((agent) => matchesAgent(agent, sub.options)).map((agent) => agent.id));
      }
      for (const sub of [...agentSubs, ...workspaceSubs, ...labelSubs]) {
        const snapshot = { ...(sub.snapshot() as object), subscriptionId: sub.id };
        for (const observer of sub.observers) observer.snapshot(snapshot);
      }
    },
  };
}

export type FakePaseo = ReturnType<typeof createFakePaseo>;
