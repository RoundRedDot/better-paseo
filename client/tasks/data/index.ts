import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type {
  PaseoAgent,
  PaseoAgentListOptions,
  PaseoAgentListResult,
  PaseoApi,
  PaseoProject,
  PaseoProjectUpdate,
  PaseoProviderModelsResult,
  PaseoProviderSnapshotResult,
  PaseoWorkspace,
  PaseoWorkspaceListResult,
} from "@getpaseo/client";
import { doneWindowMs, type DoneWindow } from "../../../shared/tasks-settings";
import type { LastTurn } from "../../../shared/turn-usage-rpc";
import type { ProviderSubagent } from "../../../shared/tasks-rpc";
import { footerModel } from "../../state/footer-model";
import { MARK_IDS } from "../../components/marks";
import { normalizeProvider } from "../../components/provider-logo";
import { classifyAgent } from "../agent-state-bucket";
import { resolveTasksLanguage } from "../i18n";
import { fallbackLabelColor } from "../label-colors";
import { subagentModel, subagentType } from "../subagent-type";
import { LANE_ORDER, isHistoryLane, settledAt, type BoardCounts, type BoardFilters, type LaneId, type LaneModel, type TaskCard, type TaskChild, type TaskLabel, type TaskTiming, type TaskUsage } from "../model";

export interface WorkspaceOption {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  /** The project's key and loaded icon, so a filter row draws the same icon as the project's cards. */
  projectKey?: string | null;
  projectIcon?: string | null;
  /** The last segment of the workspace's directory, to tell same-named workspaces apart. */
  folder?: string | null;
  /** The project's root directory, the project filter's second line. */
  projectPath?: string | null;
}

export interface TasksOptions {
  /** The done lane's time window. */
  doneWindow: DoneWindow;
  /** Page the done lane in; false keeps only the active lanes. */
  includeDone: boolean;
  /**
   * The archived lane (`board.showArchived`): the done lane's list then
   * includes archived agents, so both lanes page together in one window.
   * Needs `includeDone`.
   */
  includeArchived?: boolean;
}

/** The sidebar row's numbers. */
export interface SidebarCounts {
  needsInput: number;
  running: number;
  review: number;
  /** False until the first active snapshot arrives. */
  ready: boolean;
}

export interface TasksSnapshot {
  /** Every lane in `LANE_ORDER`, each sorted as the spec's lane table says. Unfiltered. */
  lanes: Record<LaneId, LaneModel>;
  counts: BoardCounts;
  byId: ReadonlyMap<string, TaskCard>;
  /** Filter options: workspaces grouped by project, the providers enabled in Paseo (and any other on a card), and the labels Paseo has (and any other on a card). */
  workspaces: WorkspaceOption[];
  providers: { id: string; label: string }[];
  labels: TaskLabel[];
  /** False until the first active snapshot arrives. */
  ready: boolean;
  error: string | null;
}

export interface TasksHandle extends TasksSnapshot {
  /** Fetch the done lane's next page (50), which the archived lane shares. */
  loadMoreDone(): void;
  /** Resolve a parent that is not on the board (archived, or an old done task): `agents.ref(id).refresh()`. */
  resolveParent(agentId: string): void;
  /** Read the parent again, as after an unarchive: whether it is archived, or null when it is gone. */
  refreshParent(agentId: string): Promise<boolean | null>;
  /** Read the server's read marks again, as after a Mark read. */
  refreshReads(): void;
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

/**
 * The agents in flight; the sidebar's running and needs-input counts: an
 * agent that waits for a permission is mid-turn, so it is running. Both
 * daemons (0.11, 0.12) store attention only for "finished" and "error"; a
 * "permission" reason survives only on records from older daemons, and the
 * board's attention subscription still lists those.
 */
const STATUS_KEY = "active-status";
const STATUS_FILTER: PaseoAgentListOptions["filter"] = { statuses: ["running", "initializing", "error"] };
/**
 * The unread and failed agents, opened only while a board is open or the
 * sidebar shows its review count. Unread agents are most of a busy daemon's
 * active records, and each one is a full snapshot.
 */
const ATTENTION_KEY = "active-attention";
const ATTENTION_FILTER: PaseoAgentListOptions["filter"] = { requiresAttention: true };
const DONE_SUBSCRIPTION = "done-first";
const PAGE_SIZE = 50;
/**
 * A label color name as Paseo draws its label dots, in either theme: the
 * light set its identity colors keep for dark surfaces, which Paseo's label
 * list and sidebar use on light ones too.
 */
const LABEL_COLORS: Readonly<Record<string, string>> = {
  violet: "#a392d5",
  sky: "#6aa6ce",
  emerald: "#6cae96",
  orange: "#cc8f64",
  pink: "#d87da3",
  indigo: "#9299d5",
  teal: "#6cacab",
  red: "#d88381",
  amber: "#b29d64",
  blue: "#7ba1d5",
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
    .map((name) => ({ name, color: colorNames.get(name) ?? fallbackLabelColor(name) }));
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

/** Each agent's latest turn the plugin server recorded; agents without one are left out. */
export type LastTurnLoader = (agentIds: string[]) => Promise<LastTurn[]>;

let lastTurnLoader: LastTurnLoader | null = null;
/** The most agents one `turns.last` call asks about. */
const LAST_TURN_BATCH = 200;
/** How long after a turn the board saw end it asks the plugin server how the turn ended. */
const TURN_END_ASK_DELAY_MS = 1_500;
/** When a closed agent is looked up for a delete: soon after it closed, then once more for a slow delete. */
const GONE_CHECK_DELAYS_MS = [1_000, 3_000];

/** `contribute` sets the loader, since only the plugin context can call RPCs outside a component. */
export function setLastTurnLoader(next: LastTurnLoader | null): void {
  lastTurnLoader = next;
}

interface TurnSpan {
  startedAt: number | null;
  endedAt: number;
}

interface TurnError {
  endedAt: number;
  message: string;
}

/** `tasks.subagents`: the provider subagents, or null while `since` is still the server's version. */
export type SubagentLoader = (since?: string) => Promise<{ version: string; subagents: ProviderSubagent[] | null }>;

let subagentLoader: SubagentLoader | null = null;
/** How often the provider subagents are read again: a board shows them, the sidebar only counts their parents. */
const SUBAGENT_POLL_BOARD_MS = 15_000;
const SUBAGENT_POLL_MS = 60_000;
/** Agent updates often travel together; one read follows a burst. */
const SUBAGENT_SETTLE_MS = 1_500;
/** A parent off the board that this many failures bring in, at most; the rest wait for the board. */
const SUBAGENT_PARENTS_FETCHED = 20;
const SUBAGENT_KEY = "provider-subagents";

/** `contribute` sets the loader, as the last turn's. */
export function setSubagentLoader(next: SubagentLoader | null): void {
  subagentLoader = next;
}

/** `tasks.reads`: the agents marked read from a board, with when. */
export type ReadMarksLoader = () => Promise<Array<{ agentId: string; readAt: string }>>;

let readMarksLoader: ReadMarksLoader | null = null;

/** `contribute` sets the loader; the marks are read with the subagents and after a Mark read. */
export function setReadMarksLoader(next: ReadMarksLoader | null): void {
  readMarksLoader = next;
}

/** `tasks.labels`: the daemon's label definitions, for a host whose API lists none; null when the server cannot read them. */
export type LabelDefinitionsLoader = () => Promise<Array<{ name: string; color: string }> | null>;

let labelDefinitionsLoader: LabelDefinitionsLoader | null = null;

/** `contribute` sets the loader; a board reads the definitions when it opens. */
export function setLabelDefinitionsLoader(next: LabelDefinitionsLoader | null): void {
  labelDefinitionsLoader = next;
}

/** `tasks.project-icons`: the projects' icons, for a host whose API has no icon call; null when the server cannot read them. */
export type ProjectIconsLoader = (projectIds: string[]) => Promise<Array<{ projectId: string; icon: { data: string; mimeType: string } | null }> | null>;

let projectIconsLoader: ProjectIconsLoader | null = null;

/** `contribute` sets the loader; icons are read when a card or a filter row first draws a project. */
export function setProjectIconsLoader(next: ProjectIconsLoader | null): void {
  projectIconsLoader = next;
}

function epoch(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * A parent's provider subagents worth a row: the running ones, and the
 * failures since its latest prompt. A prompt after a failure is the person
 * acting on it, so the failure leaves the card then.
 */
export function shownSubagents(subagents: readonly ProviderSubagent[] | undefined, lastUserMessageAt: string | null): ProviderSubagent[] {
  if (!subagents?.length) return [];
  const prompted = epoch(lastUserMessageAt);
  return subagents
    .filter((subagent) => subagent.status === "running" || epoch(subagent.updatedAt) > prompted)
    .sort((left, right) => epoch(left.createdAt) - epoch(right.createdAt));
}

function subagentError(count: number): string {
  if (resolveTasksLanguage() === "zh") return `${count} 个 subagent 失败`;
  return count === 1 ? "1 subagent failed" : `${count} subagents failed`;
}

/** A provider subagent as a subtask row: no card or tab of its own, so the row opens its parent. */
function subagentChild(subagent: ProviderSubagent, parent: TaskCard): TaskChild {
  const running = subagent.status === "running";
  const startedAt = epoch(subagent.createdAt);
  const endedAt = epoch(subagent.updatedAt);
  return {
    id: subagent.id,
    title: subagent.description?.trim() || subagent.title?.trim() || "Subagent",
    status: running ? "running" : "failed",
    kind: "provider",
    subtitle: subagent.subtitle,
    subagentType: subagentType(subagent.title, subagent.subtitle),
    provider: parent.provider,
    lane: running ? "running" : "review",
    timing: {
      createdAt: subagent.createdAt,
      updatedAt: subagent.updatedAt,
      turnStartedAt: running ? subagent.createdAt : null,
      attentionAt: null,
      lastUserMessageAt: null,
      lastTurnMs: !running && Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt ? endedAt - startedAt : null,
      lastTurnEndedAt: running ? null : subagent.updatedAt,
    },
  };
}

/**
 * The card with its provider subagents: their rows after the Paseo
 * children, and a failure since the latest prompt marks a finished parent
 * failed and moves it to review. A parent still at work keeps its lane;
 * its rows say what failed.
 */
export function withSubagents(card: TaskCard, subagents: readonly ProviderSubagent[] | undefined): TaskCard {
  const shown = shownSubagents(subagents, card.timing.lastUserMessageAt);
  if (shown.length === 0) return card;
  const failed = shown.filter((subagent) => subagent.status === "failed").length;
  const finished = card.lane === "review" || card.lane === "done";
  return {
    ...card,
    ...(failed > 0 && finished
      ? { lane: "review" as const, status: "failed" as const, error: card.error ?? subagentError(failed) }
      : null),
    children: [...card.children, ...shown.map((subagent) => subagentChild(subagent, card))],
  };
}

function timestamp(value: string | null, missing: number): number {
  if (!value) return missing;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : missing;
}

/** A lane's default order: waiting and running oldest first, the rest newest first. */
function laneCompare(lane: LaneId): (left: TaskCard, right: TaskCard) => number {
  if (lane === "needs_input") return (left, right) => timestamp(left.timing.attentionAt, Number.POSITIVE_INFINITY) - timestamp(right.timing.attentionAt, Number.POSITIVE_INFINITY);
  if (lane === "running") return (left, right) => timestamp(left.timing.turnStartedAt, Number.POSITIVE_INFINITY) - timestamp(right.timing.turnStartedAt, Number.POSITIVE_INFINITY);
  if (lane === "review") return (left, right) => timestamp(right.timing.attentionAt ?? right.timing.updatedAt, Number.NEGATIVE_INFINITY) - timestamp(left.timing.attentionAt ?? left.timing.updatedAt, Number.NEGATIVE_INFINITY);
  if (lane === "done") return (left, right) => timestamp(settledAt(right.timing), Number.NEGATIVE_INFINITY) - timestamp(settledAt(left.timing), Number.NEGATIVE_INFINITY);
  return (left, right) => timestamp(right.timing.updatedAt, Number.NEGATIVE_INFINITY) - timestamp(left.timing.updatedAt, Number.NEGATIVE_INFINITY);
}

// One list per parent card, so a subagent's card keeps its identity while its parent's does.
const subagentCardCache = new WeakMap<TaskCard, TaskCard[]>();

/** A parent's provider subagents as read-only cards, in the workspace, labels and agent of the parent. */
function subagentCardsOf(parent: TaskCard): TaskCard[] {
  const cached = subagentCardCache.get(parent);
  if (cached) return cached;
  const out = parent.children
    .filter((child) => child.kind === "provider" && child.lane && child.timing)
    .map((child): TaskCard => {
      const facts = subagentModel(child.subtitle, child.subagentType);
      return {
        id: child.id,
        title: child.title,
        lane: child.lane!,
        status: child.status,
        provider: parent.provider,
        providerLabel: parent.providerLabel,
        providerMark: parent.providerMark,
        model: null,
        // The model and effort its facts line names, drawn as an agent's are; an inherited model is not named.
        modelLabel: facts?.model ?? null,
        thinkingLabel: facts?.thinking ?? null,
        modeLabel: null,
        location: parent.location,
        labels: parent.labels,
        timing: child.timing!,
        context: null,
        usage: null,
        error: null,
        permission: null,
        parent: { id: parent.id, title: parent.title, missing: false, archived: false },
        children: [],
        openTab: false,
        stoppable: false,
        subagent: { subtitle: child.subtitle ?? null, type: child.subagentType ?? null },
      };
    });
  subagentCardCache.set(parent, out);
  return out;
}

/**
 * The lanes with a read-only card for each provider subagent a card lists,
 * merged into its lane in the lane's order. An archived parent's are left
 * out. `filterLanes` then treats them as any subtask: hidden subtasks keep
 * them on their parent's card while it shares their lane. Returns `lanes`
 * itself while no card has one.
 */
export function withSubagentCards(lanes: Record<LaneId, LaneModel>): Record<LaneId, LaneModel> {
  const added = new Map<LaneId, TaskCard[]>();
  for (const id of LANE_ORDER) {
    if (id === "archived") continue;
    for (const card of lanes[id].cards) {
      if (!card.children.some((child) => child.kind === "provider")) continue;
      for (const sub of subagentCardsOf(card)) {
        const list = added.get(sub.lane);
        if (list) list.push(sub);
        else added.set(sub.lane, [sub]);
      }
    }
  }
  if (added.size === 0) return lanes;
  const out = { ...lanes };
  for (const [id, cards] of added) out[id] = { ...lanes[id], cards: [...lanes[id].cards, ...cards].sort(laneCompare(id)) };
  return out;
}

/**
 * The card's timing with its latest turn. A turn that ended before the latest
 * prompt is an earlier one: while the agent works that is its last turn, after
 * it the prompt's own turn is not known. A turn without a recorded start is
 * timed from the prompt it followed.
 */
export function withLastTurn(timing: TaskTiming, turn: TurnSpan | undefined, working: boolean): TaskTiming {
  if (!turn) return timing;
  const prompted = timing.lastUserMessageAt ? Date.parse(timing.lastUserMessageAt) : Number.NaN;
  if (!working && turn.endedAt < prompted) return timing;
  const startedAt = turn.startedAt ?? (prompted <= turn.endedAt ? prompted : null);
  if (startedAt === null || startedAt > turn.endedAt) return timing;
  return { ...timing, lastTurnMs: turn.endedAt - startedAt, lastTurnEndedAt: new Date(turn.endedAt).toISOString() };
}

/**
 * The card's usage with the cost the plugin server recorded when its latest
 * costed turn ended, when the agent reports none of its own: Claude's context
 * updates while it works replace the daemon's usage and drop the cost.
 */
export function withRecordedCost(usage: TaskUsage | null, cost: number | undefined): TaskUsage | null {
  if (cost === undefined || usage?.totalCostUsd != null) return usage;
  return { inputTokens: usage?.inputTokens ?? null, cachedInputTokens: usage?.cachedInputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalCostUsd: cost };
}

/**
 * A card whose latest turn stopped on an error (Claude's session limit, which
 * the daemon passes off as a finished turn) is a failed task, not a done one:
 * the review lane's red dot with the error as its reason. A prompt since that
 * turn, or the agent working again, drops it.
 */
export function withTurnError(card: TaskCard, turnError: TurnError | undefined): TaskCard {
  if (!turnError || card.status === "failed" || (card.lane !== "done" && card.lane !== "review")) return card;
  const prompted = card.timing.lastUserMessageAt ? Date.parse(card.timing.lastUserMessageAt) : Number.NaN;
  if (turnError.endedAt < prompted) return card;
  return { ...card, lane: "review", status: "failed", error: turnError.message };
}

/**
 * The card with its read mark. A mark taken since the latest prompt moves a
 * review card to done, its reason kept in grey, unless a turn or a provider
 * subagent failed after the mark (`failedAt`, the latest failure the board
 * knows the time of). Every review card can be marked read; no other can.
 */
export function withReadMark(card: TaskCard, readAt: number | undefined, failedAt: number): TaskCard {
  if (card.lane !== "review") return card.readable ? { ...card, readable: false } : card;
  if (readAt !== undefined && readAt >= epoch(card.timing.lastUserMessageAt) && failedAt <= readAt) {
    return { ...card, lane: "done", status: "done", readable: false };
  }
  return card.readable ? card : { ...card, readable: true };
}

/**
 * A finished parent whose subtasks still run or wait for input is not done:
 * it moves to the running lane with the running ring, so the board does not
 * read it as finished while its work goes on. Its own turn has ended
 * (`waitingOnSubtasks`), so it gets no Stop of its own, and its timer counts
 * its subtasks' work instead of a turn. A failed parent stays in review: its
 * failure needs a person first.
 */
export function withActiveSubtasks(card: TaskCard): TaskCard {
  if ((card.lane !== "review" && card.lane !== "done") || card.status === "failed") return card;
  if (!card.children.some((child) => child.status === "running" || child.status === "needs_input")) return card;
  return { ...card, lane: "running", status: "running", readable: false, waitingOnSubtasks: true };
}

/**
 * An archived task, or one of an archived workspace, in the archived lane:
 * the box icon, and no Mark read. It keeps its Stop while its agent still
 * runs (an archived workspace's agent can).
 */
export function withArchived(card: TaskCard, archived: "agent" | "workspace" | null): TaskCard {
  if (!archived) return card;
  const { waitingOnSubtasks: _waiting, ...rest } = card;
  return { ...rest, lane: "archived", status: "archived", readable: false, archived };
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
    lastError: agent.lastError,
  });
  const workspaceTitle = workspace?.title?.trim() || workspace?.name || placement?.workspaceName || null;
  const projectName = workspace?.projectCustomName?.trim() || workspace?.projectDisplayName ||
    project?.projectCustomName?.trim() || project?.projectDisplayName || placement?.projectName || null;
  const branch = workspace?.gitRuntime?.currentBranch ?? placement?.checkout.currentBranch ?? null;
  const folderCandidate = pathTail(agent.cwd);
  const branchFolder = branch?.replace(/\//g, "-") ?? null;
  const folder = folderCandidate && folderCandidate !== projectName && folderCandidate !== workspaceTitle && folderCandidate !== branch && folderCandidate !== branchFolder
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
  const projectKey = placement?.projectKey || project?.projectKey || null;
  const revision = project?.projectIconRevision ?? null;
  const projectIcon = icon?.revision === revision ? icon.uri : null;
  const hasGitState = workspace ? workspace.gitRuntime != null : placement?.checkout.isGit === true;
  const pullRequest = workspace?.githubRuntime?.pullRequest;
  const permission = pendingPermissions[0];

  return {
    id: agent.id,
    title: agent.title?.trim() || (resolveTasksLanguage() === "zh" ? "未命名" : "Untitled"),
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
      projectKey,
      projectName,
      projectIcon,
      workspaceId: agent.workspaceId ?? workspace?.id ?? null,
      workspaceName: workspaceTitle && workspaceTitle !== projectName && workspaceTitle !== agent.title &&
        workspaceTitle !== branch && workspaceTitle !== branchFolder ? workspaceTitle : null,
      workspaceTitle,
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
      folderName: folderCandidate,
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
      lastTurnMs: null,
      lastTurnEndedAt: null,
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
    // A closed agent with attention that Mark read (or a tab) resumes is
    // initializing for a moment while it stays in review: it is loading, not
    // working, so it gets no Stop to flash in Mark read's place.
    stoppable: agent.status === "running" || (agent.status === "initializing" && classification.lane === "running") || pendingPermissions.length > 0,
    closed: agent.status === "closed",
  };
}

interface SnapshotCache {
  key: string;
  snapshot: TasksSnapshot;
}

/**
 * What a consumer needs: the counts alone (the sidebar), the counts with the
 * review lane's, the board, the board with its done lane.
 */
interface TasksDemand {
  board: boolean;
  done: boolean;
  /** The unread and failed agents without a board; a board always has them. */
  attention?: boolean;
}

/**
 * Subscriptions belong to a tier: `base` while anything is mounted,
 * `attention` while a board or the sidebar's review count is, `board` while
 * a board is, `done` while a board shows its done lane. A run is the tier's
 * generation when a request left, so a late answer for a closed tier is
 * released instead of applied.
 */
interface Run {
  generation: number;
  tier: "base" | "attention" | "board" | "done";
  tierRun: number;
}

/** Everything a board subscribes to; a warm hold asks for the same, so a board opened meanwhile sends nothing. */
const BOARD_DEMAND: TasksDemand = { board: true, done: true };

/** Why the board's data is kept without a board: the user is about to open one, or just closed one. */
export type TasksHoldReason = "intent" | "linger";

interface WarmHold {
  release: () => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface TaskStore {
  subscribe(listener: () => void, demand: TasksDemand): () => void;
  /** Keep the board's subscriptions open for `reason`: until `ms` from now, or with no deadline when null. */
  hold(reason: TasksHoldReason, ms: number | null): void;
  hasHold(reason: TasksHoldReason): boolean;
  dropHolds(): void;
  getSnapshot(options: TasksOptions): TasksHandle;
  getCounts(): SidebarCounts;
  setArchivedLane(on: boolean): void;
  loadMoreDone(window: DoneWindow): void;
  resolveParent(id: string): void;
  refreshParent(id: string): Promise<boolean | null>;
  refreshReads(): void;
  requestProjectIcon(projectId: string): void;
}

const stores = new WeakMap<PaseoApi, TaskStore>();
/** Stores with a warm hold, so turning the board off can drop them all. */
const heldStores = new Set<TaskStore>();

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
  /** Cards whose parent is being refreshed for them, so a parent loop cannot recurse. */
  const refreshingParents = new Set<string>();
  const parentByChild = new Map<string, string>();
  /** Parents read by id because they are not on the board: their title and whether they are archived. */
  const resolvedParents = new Map<string, { title: string | null; archived: boolean | null }>();
  const parentReads = new Set<string>();
  const projectIcons = new Map<string, ProjectIconValue>();
  const iconRequests = new Set<string>();
  /** Icons asked of the server's loader in this task, sent together as one `tasks.project-icons` call. */
  let iconBatch: Map<string, Array<(icon: { data: string; mimeType: string } | null) => void>> | null = null;
  const lastTurns = new Map<string, TurnSpan>();
  /** The plugin server's error for each agent's latest recorded turn, when it had one. */
  const turnErrors = new Map<string, TurnError>();
  /** The cost each agent's latest costed turn ended on, as the plugin server recorded it. */
  const turnCosts = new Map<string, number>();
  /** The prompt (and whether the agent worked) each agent's turn was last asked for, so it is asked once. */
  const lastTurnAsked = new Map<string, string>();
  let lastTurnQueue = new Set<string>();
  /** The running turns' starts, by agent, so the update that ends one can time it. */
  const workingSince = new Map<string, number | null>();
  /** Agents whose closing is being checked for a delete (`checkGone`). */
  const goneChecks = new Set<string>();
  /** Provider subagents by parent, as `tasks.subagents` last answered. */
  const subagentsByParent = new Map<string, ProviderSubagent[]>();
  let subagentVersion: string | undefined;
  let subagentTimer: ReturnType<typeof setTimeout> | null = null;
  let subagentReading = false;
  /** The server's read marks (`tasks.reads`), as epoch ms by agent. */
  const readMarks = new Map<string, number>();
  /** Failed parents asked for by id, once per version of the list. */
  const subagentParentsAsked = new Set<string>();
  const subscriptions = new Map<string, StoreSubscription>();
  const projectUnsubscribes: Array<() => void> = [];
  /** The providers enabled in Paseo, by id, with their names: the Agent filter lists them all, cards or not. */
  const enabledProviders = new Map<string, string>();
  const providerUnsubscribes: Array<() => void> = [];
  let consumers = 0;
  let attentionConsumers = 0;
  let boardConsumers = 0;
  let doneConsumers = 0;
  let generation = 0;
  let attentionRun = 0;
  let boardRun = 0;
  let doneRun = 0;
  let statusReady = false;
  let attentionReady = false;
  let workspacesReady = false;
  /** The workspace list itself arrived, not a failed read: only then does a missing workspace mean archived. */
  let workspacesListed = false;
  let countsCache: SidebarCounts | null = null;
  let countsDirty = true;
  let loadingDone = false;
  /**
   * The archived lane is asked for: the done list includes archived agents,
   * whose records stay. Kept while the board closes, so a warm hold reads
   * the same list as the board it stands in for.
   */
  let archivedAsked = false;
  /**
   * The archived lane is drawn: archived agents, and an archived workspace's,
   * get cards in it instead of none. Off as soon as it is turned off; on once
   * the done list with archived agents lands, so the lane fills in one step.
   */
  let archivedLane = false;
  /** The done list is read again with another filter: its cards stay until the new list replaces them. */
  let doneReloading = false;
  let doneCursor: string | null = null;
  let doneTailAt: string | null = null;
  let error: string | null = null;
  let snapshotCaches: SnapshotCache[] = [];
  let notificationBatchDepth = 0;
  let notificationPending = false;

  const emitNotification = () => {
    snapshotCaches = [];
    countsDirty = true;
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

  /**
   * An agent of an archived workspace, or of an archived project's, is not
   * archived itself when Paseo leaves it be, and the agent lists keep it
   * (Paseo 0.12, `AgentDirectory.list`), but Paseo shows it nowhere. The
   * workspace list leaves those workspaces out, so this is known only while
   * the board's workspace subscription is open.
   */
  function inArchivedWorkspace(id: string): boolean {
    const workspaceId = entries.get(id)?.agent.workspaceId;
    if (!workspacesListed || !workspaceId) return false;
    const workspace = workspaces.get(workspaceId);
    return !workspace || Boolean(workspace.archivingAt);
  }

  /** Archived itself, or of an archived workspace: the archived lane's, and no card while it is off. */
  function archivedRecord(id: string): boolean {
    const entry = entries.get(id);
    return entry !== undefined && (isArchived(entry.agent) || inArchivedWorkspace(id));
  }

  /** Has a card on the board: a record, not archived unless the archived lane is on. */
  function onBoard(id: string): boolean {
    return baseCards.has(id) && (archivedLane || !archivedRecord(id));
  }

  /** A card, its parent's list of children, and its children's parent row. */
  function refreshWithKin(id: string) {
    refreshFinalCard(id);
    const parentId = parentByChild.get(id);
    if (parentId) refreshFinalCard(parentId);
    for (const childId of childrenByParent.get(id) ?? []) refreshFinalCard(childId);
  }

  function refreshFinalCard(id: string): boolean {
    const base = baseCards.get(id);
    if (!base || !onBoard(id)) {
      return cards.delete(id);
    }
    const archived = archivedRecord(id);
    const archivedKind = archived ? (isArchived(entries.get(id)!.agent) ? "agent" : "workspace") : null;
    const parentAgentId = parentByChild.get(id);
    const parentEntry = parentAgentId ? entries.get(parentAgentId) : undefined;
    const parentTitle = parentAgentId
      ? parentEntry?.agent.title?.trim() || resolvedParents.get(parentAgentId)?.title || null
      : null;
    const parentMissing = parentAgentId ? !onBoard(parentAgentId) : false;
    if (parentAgentId && parentMissing && !parentEntry) queueParentRead(parentAgentId);
    const parentArchivedAs = !parentAgentId
      ? null
      : parentEntry
        ? isArchived(parentEntry.agent) ? "agent" : inArchivedWorkspace(parentAgentId) ? "workspace" : null
        : resolvedParents.get(parentAgentId)?.archived ? "agent" : null;
    const childIds = childrenByParent.get(id);
    const next: TaskCard = withArchived(withActiveSubtasks(withReadMark(withSubagents({
      ...withTurnError(base, turnErrors.get(id)),
      usage: withRecordedCost(base.usage, turnCosts.get(id)),
      timing: withLastTurn(base.timing, lastTurns.get(id), base.lane === "running" || base.lane === "needs_input"),
      parent: parentAgentId
        ? {
            id: parentAgentId,
            title: parentTitle,
            missing: parentMissing,
            archived: !parentMissing ? false : parentEntry ? isArchived(parentEntry.agent) : (resolvedParents.get(parentAgentId)?.archived ?? null),
            ...(parentArchivedAs ? { archivedAs: parentArchivedAs } : null),
          }
        : null,
      children: childIds
        ? [...childIds]
            .map((childId): TaskChild | null => {
              // An archived child stays off a live parent's card, as it was before the lane.
              const child = !onBoard(childId) || (archivedRecord(childId) && !archived) ? undefined : cards.get(childId) ?? baseCards.get(childId);
              return child
                ? {
                    id: child.id,
                    title: child.title,
                    status: child.status,
                    provider: child.provider,
                    modelLabel: child.modelLabel,
                    thinkingLabel: child.thinkingLabel,
                    modeLabel: child.modeLabel,
                    context: child.context,
                    lane: child.lane,
                    timing: child.timing,
                    ...(child.waitingOnSubtasks ? { waitingOnSubtasks: true } : null),
                  }
                : null;
            })
            .filter((child): child is TaskChild => child !== null)
            .sort((left, right) => left.title.localeCompare(right.title))
        : [],
    }, subagentsByParent.get(id)), readMarks.get(id), latestFailure(id))), archivedKind);
    const previous = cards.get(id);
    if (shallowCardEqual(previous, next)) return false;
    cards.set(id, next);
    // A parent's row and lane follow its children's status: a child that
    // starts or stops waiting on its own subtasks reaches up the chain.
    if (parentAgentId && (previous?.status !== next.status || previous?.lane !== next.lane) && !refreshingParents.has(parentAgentId)) {
      refreshingParents.add(id);
      try {
        refreshFinalCard(parentAgentId);
      } finally {
        refreshingParents.delete(id);
      }
    }
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
    if (isArchived(agent) && !keepsArchived(agent)) {
      for (const members of sourceMembers.values()) members.delete(agent.id);
      removeRecord(agent.id);
      return;
    }
    const oldParent = parentByChild.get(agent.id) ?? null;
    // A turn seen ending: the update that ends it carries its end. The agent
    // can leave the running subscription before it joins another, so its
    // start outlives its entry.
    if (agent.status === "running") {
      const startedAt = agent.activeTurn?.startedAt ? Date.parse(agent.activeTurn.startedAt) : Number.NaN;
      workingSince.set(agent.id, Number.isFinite(startedAt) ? startedAt : null);
    } else if (workingSince.has(agent.id)) {
      const startedAt = workingSince.get(agent.id)!;
      workingSince.delete(agent.id);
      const endedAt = Date.parse(agent.updatedAt);
      if (Number.isFinite(endedAt)) lastTurns.set(agent.id, { startedAt, endedAt });
      askAfterTurnEnd(agent.id);
    }
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
    requestModelCatalogFor(agent);
    requestLastTurnFor(agent);
    const affected = new Set<string>([agent.id]);
    if (oldParent) affected.add(oldParent);
    if (newParent) affected.add(newParent);
    for (const childId of childrenByParent.get(agent.id) ?? []) affected.add(childId);
    for (const affectedId of affected) refreshFinalCard(affectedId);
    // A prompt after the failure is the person acting on it: the parent may go.
    const subagentMembers = sourceMembers.get(SUBAGENT_KEY);
    if (subagentsByParent.has(agent.id) && subagentMembers) {
      if (failsBySubagent(agent.id, agent.lastUserMessageAt)) subagentMembers.add(agent.id);
      else subagentMembers.delete(agent.id);
    }
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

  /** An archived agent the archived lane holds: settled, as the done list it came in reads them. */
  function keepsArchived(agent: PaseoAgent): boolean {
    return archivedAsked && doneConsumers > 0 && isDone(agent);
  }

  function reconcileActiveMembers(agent: PaseoAgent) {
    if (isArchived(agent)) {
      for (const key of [STATUS_KEY, ATTENTION_KEY]) sourceMembers.get(key)?.delete(agent.id);
      return;
    }
    const statusMatches = ["running", "initializing", "error"].includes(agent.status);
    const attentionMatches = Boolean(agent.requiresAttention);
    if (statusMatches) sourceMembers.get(STATUS_KEY)?.add(agent.id);
    else sourceMembers.get(STATUS_KEY)?.delete(agent.id);
    if (attentionMatches) sourceMembers.get(ATTENTION_KEY)?.add(agent.id);
    else sourceMembers.get(ATTENTION_KEY)?.delete(agent.id);
  }

  function applyAgentUpdate(sourceKey: string, update: AgentUpdateEnvelope) {
    if (update.type !== "agent_update" || !update.payload) return;
    // A subagent's start or end usually moves its parent too.
    scheduleSubagents(SUBAGENT_SETTLE_MS);
    const payload = update.payload;
    if (payload.kind === "upsert" && payload.agent) {
      const agent = payload.agent;
      if (sourceKey === DONE_SUBSCRIPTION) {
        if (isDone(agent) && (!isArchived(agent) || keepsArchived(agent))) {
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
      if (agent.status === "closed") checkGone(agent.id);
      return;
    }
    if (payload.kind === "remove" && payload.agentId) {
      sourceMembers.get(sourceKey)?.delete(payload.agentId);
      // Held for a subagent failure, it stays; the list it left had its latest state, so read it again.
      if (sourceMembers.get(SUBAGENT_KEY)?.has(payload.agentId)) fetchSubagentParent(payload.agentId, generation);
      dropIfUnreferenced(payload.agentId);
      if (entries.has(payload.agentId)) checkGone(payload.agentId);
    }
  }

  /**
   * A delete reaches only the client that made it: every other client sees
   * the agent close and hears nothing more (Paseo 0.12, `deleteAgent` in the
   * daemon's session), so its card would stay until a reload. A closed agent
   * that stays on the board is looked up once its delete has had time to
   * land, and again a little later in case the delete was slow; one that is
   * gone leaves every lane. A daemon restart closes agents too, and those
   * are found and kept. An archive reaches the lists only as a remove, so a
   * card a done page read still holds is let go when the look finds it
   * archived.
   */
  function checkGone(id: string, attempt = 0) {
    if (goneChecks.has(id)) return;
    goneChecks.add(id);
    const run = generation;
    setTimeout(() => {
      if (run !== generation) return;
      if (!entries.has(id)) {
        goneChecks.delete(id);
        return;
      }
      void api.agents.ref(id).refresh().then((result) => {
        if (run !== generation) return;
        goneChecks.delete(id);
        if (result && !isArchived(result.agent)) {
          if (result.agent.status === "closed" && attempt + 1 < GONE_CHECK_DELAYS_MS.length) checkGone(id, attempt + 1);
          return;
        }
        // Archived while the archived lane is on: the card moves there, held by the list that read it.
        if (result && keepsArchived(result.agent) && memberSetsContaining(id).length > 0) {
          updateRecord(result.agent, result.project ?? null);
          return;
        }
        for (const members of sourceMembers.values()) members.delete(id);
        removeRecord(id);
      }).catch(() => {
        if (run === generation) goneChecks.delete(id);
      });
    }, GONE_CHECK_DELAYS_MS[attempt]);
  }

  function matchingEntries(result: PaseoAgentListResult | { entries: PaseoAgentListResult["entries"] }) {
    return result.entries.filter(({ agent }) => !isArchived(agent) || keepsArchived(agent));
  }

  function replaceAgentSnapshot(sourceKey: string, snapshot: PaseoAgentListResult) {
    batchUpdates(() => {
      const nextMembers = new Set<string>();
      for (const entry of matchingEntries(snapshot)) {
        nextMembers.add(entry.agent.id);
        updateRecord(entry.agent, entry.project ?? null);
      }
      sourceMembers.set(sourceKey, nextMembers);
      // The done lane starts over from its first page, as `doneCursor` below
      // does: a page read once hears of no archive made while disconnected.
      if (sourceKey === DONE_SUBSCRIPTION) for (const key of [...sourceMembers.keys()]) if (key.startsWith("done-page-")) sourceMembers.delete(key);
      for (const id of [...entries.keys()]) if (!nextMembers.has(id) && memberSetsContaining(id).length === 0) dropIfUnreferenced(id);
      if (sourceKey === STATUS_KEY) statusReady = true;
      if (sourceKey === ATTENTION_KEY) attentionReady = true;
      if (sourceKey === DONE_SUBSCRIPTION) {
        doneCursor = snapshot.pageInfo.nextCursor;
        doneTailAt = snapshot.entries.at(-1)?.agent.updatedAt ?? null;
        doneListLanded();
      }
      notify();
    });
  }

  function subscriptionError(caught: unknown) {
    error = caught instanceof Error ? caught.message : String(caught);
    notify();
  }

  function isCurrent(run: Run): boolean {
    if (run.generation !== generation || consumers === 0) return false;
    if (run.tier === "attention") return attentionConsumers > 0 && run.tierRun === attentionRun;
    if (run.tier === "board") return boardConsumers > 0 && run.tierRun === boardRun;
    if (run.tier === "done") return doneConsumers > 0 && run.tierRun === doneRun;
    return true;
  }

  async function observeOwned<T extends { subscription?: OwnedSubscriptionLike }>(
    key: string,
    result: T,
    run: Run,
    initial: (snapshot: T) => void,
    update: (message: unknown) => void,
  ) {
    const owned = result.subscription;
    if (!owned) {
      if (isCurrent(run)) initial(result);
      return;
    }
    if (!isCurrent(run)) {
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
      if (!isCurrent(run)) return;
      initial(ready);
      initialApplied = true;
      for (const event of pending) {
        if (event.kind === "snapshot") initial(event.value);
        else update(event.value);
      }
    } catch (caught) {
      if (isCurrent(run)) subscriptionError(caught);
    }
  }

  /**
   * Model names show on cards only, so a catalog is read while a board is
   * open, once per provider; it is kept when the board closes.
   */
  function requestModelCatalogFor(agent: PaseoAgent) {
    if (boardConsumers === 0 || !agent.model || modelCatalogs.has(agent.provider) || modelRequests.has(agent.provider)) return;
    requestModelCatalog(agent.provider, generation);
  }

  /**
   * The last turn shows on cards only, so it is read while a board is open:
   * once per agent and prompt, unless the board saw the turn end. Asks wait
   * a tick so one snapshot's agents go together.
   */
  function requestLastTurnFor(agent: PaseoAgent) {
    if (!lastTurnLoader || boardConsumers === 0) return;
    const prompt = agent.lastUserMessageAt ?? "";
    const working = agent.status === "running";
    const known = lastTurns.get(agent.id);
    if (known && (working || !(known.endedAt < Date.parse(prompt)))) return;
    // Asked while the agent worked, the answer was the turn before: ask again once it is done.
    const ask = working ? `${prompt} running` : prompt;
    if (lastTurnAsked.get(agent.id) === ask) return;
    lastTurnAsked.set(agent.id, ask);
    if (lastTurnQueue.size === 0) {
      const run = generation;
      setTimeout(() => { if (run === generation) flushLastTurns(run); }, 0);
    }
    lastTurnQueue.add(agent.id);
  }

  /**
   * A turn the board saw end is timed already, but only the plugin server knows
   * whether it ended on an error. Ask once it has had a moment to record it;
   * `turns.last` waits for a record still being written.
   */
  function askAfterTurnEnd(agentId: string) {
    if (!lastTurnLoader || boardConsumers === 0) return;
    const run = generation;
    setTimeout(() => {
      if (run !== generation || !entries.has(agentId)) return;
      if (lastTurnQueue.size === 0) setTimeout(() => { if (run === generation) flushLastTurns(run); }, 0);
      lastTurnQueue.add(agentId);
    }, TURN_END_ASK_DELAY_MS);
  }

  function flushLastTurns(run: number) {
    const loader = lastTurnLoader;
    const ids = [...lastTurnQueue];
    lastTurnQueue = new Set();
    if (!loader) return;
    for (let start = 0; start < ids.length; start += LAST_TURN_BATCH) {
      void loader(ids.slice(start, start + LAST_TURN_BATCH)).then((turns) => {
        if (run !== generation) return;
        batchUpdates(() => {
          for (const turn of turns) {
            const knownError = turnErrors.get(turn.agentId);
            const errorChanged = turn.error
              ? knownError?.message !== turn.error || knownError.endedAt !== turn.endedAt
              : knownError !== undefined && knownError.endedAt <= turn.endedAt;
            if (errorChanged) {
              if (turn.error) turnErrors.set(turn.agentId, { endedAt: turn.endedAt, message: turn.error });
              else turnErrors.delete(turn.agentId);
            }
            const costChanged = turn.totalCostUsd !== undefined && turnCosts.get(turn.agentId) !== turn.totalCostUsd;
            if (costChanged) turnCosts.set(turn.agentId, turn.totalCostUsd!);
            const known = lastTurns.get(turn.agentId);
            const newer = !known || known.endedAt < turn.endedAt;
            if (newer) lastTurns.set(turn.agentId, { startedAt: turn.startedAt ?? null, endedAt: turn.endedAt });
            if (!newer && !errorChanged && !costChanged) continue;
            refreshFinalCard(turn.agentId);
            const parent = parentByChild.get(turn.agentId);
            if (parent) refreshFinalCard(parent);
          }
          notify();
        });
      }).catch(() => {
        // An older server without `turns.last`, or a failed read: the cards say "—".
      });
    }
  }

  /**
   * Reads the provider subagents again in `delay`, unless a read is due
   * sooner. A burst of agent updates moves it up to `SUBAGENT_SETTLE_MS`;
   * a read schedules the next poll.
   */
  let subagentDueAt = Number.POSITIVE_INFINITY;
  function scheduleSubagents(delay: number) {
    if (!subagentLoader || consumers === 0) return;
    const due = Date.now() + delay;
    if (subagentTimer !== null && subagentDueAt <= due) return;
    if (subagentTimer !== null) clearTimeout(subagentTimer);
    subagentDueAt = due;
    const run = generation;
    subagentTimer = setTimeout(() => {
      subagentTimer = null;
      subagentDueAt = Number.POSITIVE_INFINITY;
      if (run === generation) void readSubagents(run);
    }, delay);
  }

  async function readSubagents(run: number) {
    const loader = subagentLoader;
    if (!loader || subagentReading) return;
    subagentReading = true;
    try {
      await readReads(run);
      const result = await loader(subagentVersion);
      if (run !== generation) return;
      if (result.subagents) applySubagents(result.version, result.subagents);
      else subagentVersion = result.version;
    } catch {
      // An older server without `tasks.subagents`, or a failed read: no rows until the next one.
    } finally {
      subagentReading = false;
      if (run === generation) scheduleSubagents(boardConsumers > 0 ? SUBAGENT_POLL_BOARD_MS : SUBAGENT_POLL_MS);
    }
  }

  function applySubagents(version: string, subagents: ProviderSubagent[]) {
    subagentVersion = version;
    subagentParentsAsked.clear();
    const affected = new Set(subagentsByParent.keys());
    subagentsByParent.clear();
    for (const subagent of subagents) {
      let list = subagentsByParent.get(subagent.parentAgentId);
      if (!list) subagentsByParent.set(subagent.parentAgentId, list = []);
      list.push(subagent);
      affected.add(subagent.parentAgentId);
    }
    batchUpdates(() => {
      for (const id of affected) {
        refreshFinalCard(id);
        const parent = parentByChild.get(id);
        if (parent) refreshFinalCard(parent);
      }
      syncSubagentParents();
      notify();
    });
  }

  /** Whether the agent's card would show a provider subagent failure: one since its prompt, and since a read mark taken after it. */
  function failsBySubagent(id: string, lastUserMessageAt: string | null): boolean {
    const readAt = readMarks.get(id);
    const seen = readAt !== undefined && readAt >= epoch(lastUserMessageAt) ? readAt : Number.NEGATIVE_INFINITY;
    return shownSubagents(subagentsByParent.get(id), lastUserMessageAt).some((subagent) => subagent.status === "failed" && epoch(subagent.updatedAt) > seen);
  }

  /** The latest failure the board knows the time of: the last turn's error, or a provider subagent's. */
  function latestFailure(id: string): number {
    let at = turnErrors.get(id)?.endedAt ?? Number.NEGATIVE_INFINITY;
    for (const subagent of subagentsByParent.get(id) ?? []) {
      if (subagent.status === "failed") at = Math.max(at, epoch(subagent.updatedAt));
    }
    return at;
  }

  /** The server's read marks; a changed one moves its card (and lets a failed parent go). */
  async function readReads(run: number) {
    const loader = readMarksLoader;
    if (!loader) return;
    try {
      const marks = await loader();
      if (run !== generation) return;
      const next = new Map<string, number>();
      for (const mark of marks) {
        const at = Date.parse(mark.readAt);
        if (Number.isFinite(at)) next.set(mark.agentId, at);
      }
      const changed = new Set<string>();
      for (const [id, at] of next) if (readMarks.get(id) !== at) changed.add(id);
      for (const id of readMarks.keys()) if (!next.has(id)) changed.add(id);
      if (changed.size === 0) return;
      readMarks.clear();
      for (const [id, at] of next) readMarks.set(id, at);
      batchUpdates(() => {
        for (const id of changed) {
          refreshFinalCard(id);
          const parent = parentByChild.get(id);
          if (parent) refreshFinalCard(parent);
        }
        syncSubagentParents();
        notify();
      });
    } catch {
      // An older server without `tasks.reads`, or a failed read: the marks stay as they were.
    }
  }

  /**
   * Keeps every parent with a failure since its latest prompt on the board,
   * and in the sidebar's review count, whether or not a list holds it: one
   * the lists do not hold is fetched by id. A parent whose failures are gone
   * or acted on is let go.
   */
  function syncSubagentParents() {
    let members = sourceMembers.get(SUBAGENT_KEY);
    if (!members) sourceMembers.set(SUBAGENT_KEY, members = new Set());
    for (const id of [...members]) {
      const entry = entries.get(id);
      if (entry && failsBySubagent(id, entry.agent.lastUserMessageAt)) continue;
      members.delete(id);
      dropIfUnreferenced(id);
    }
    let budget = SUBAGENT_PARENTS_FETCHED;
    for (const [id, subagents] of subagentsByParent) {
      if (!subagents.some((subagent) => subagent.status === "failed")) continue;
      const entry = entries.get(id);
      if (entry) {
        if (failsBySubagent(id, entry.agent.lastUserMessageAt)) members.add(id);
        continue;
      }
      if (subagentParentsAsked.has(id) || budget <= 0) continue;
      subagentParentsAsked.add(id);
      budget -= 1;
      fetchSubagentParent(id, generation);
    }
  }

  /** A failed parent no list holds, or one a list let go: read by id, kept while its failure shows. */
  function fetchSubagentParent(id: string, run: number) {
    void api.agents.ref(id).refresh().then((result) => {
      if (run !== generation) return;
      const members = sourceMembers.get(SUBAGENT_KEY);
      if (!result || isArchived(result.agent) || !failsBySubagent(id, result.agent.lastUserMessageAt)) {
        if (members?.delete(id)) dropIfUnreferenced(id);
        return;
      }
      members?.add(id);
      updateRecord(result.agent, result.project ?? null);
    }).catch(() => {
      // Gone meanwhile: the next list drops it.
    });
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

  async function openAgentSubscription(key: string, options: PaseoAgentListOptions, run: Run) {
    try {
      const result = await api.agents.list(options);
      if (!isCurrent(run)) {
        await result.subscription?.release();
        return;
      }
      await observeOwned(key, result, run,
        (snapshot) => replaceAgentSnapshot(key, snapshot as PaseoAgentListResult),
        (message) => applyAgentUpdate(key, message as AgentUpdateEnvelope));
    } catch (caught) {
      if (isCurrent(run)) {
        // A failed list must not hold the board on its skeleton.
        if (key === ATTENTION_KEY) attentionReady = true;
        if (key === DONE_SUBSCRIPTION) doneListLanded();
        subscriptionError(caught);
      }
    }
  }

  function updateWorkspace(workspace: PaseoWorkspace) {
    workspaces.set(workspace.id, workspace);
    for (const [id, entry] of entries) {
      if (entry.agent.workspaceId !== workspace.id) continue;
      const project = projects.get(workspace.projectId);
      const base = buildBaseCard(entry, workspace, project, colorNames, modelCatalogs.get(entry.agent.provider), projectIcons.get(workspace.projectId));
      baseCards.set(id, base);
      refreshWithKin(id);
    }
    notify();
  }

  /**
   * The board's own workspace subscription. It repeats the host's: the
   * daemon sends `workspace_update` once per subscription, and a plugin
   * cannot reach the host's. `workspace_update` is no session event
   * (`observeEvents`), `workspaces.subscribe` relays only this API's own
   * lists, and `useWorkspace` reads one id with no git, pull request or
   * labels, outside screens and sidebar items at that. It runs with the
   * attention list: an unread agent whose workspace was archived keeps its
   * attention for good, and only the workspace list tells it from a live one.
   */
  async function startWorkspaceSubscription(run: Run) {
    try {
      const result = await api.workspaces.list({ subscribe: {} });
      if (!isCurrent(run)) {
        await result.subscription?.release();
        return;
      }
      await observeOwned("workspaces", result, run, (snapshot) => {
        batchUpdates(() => {
          workspacesReady = true;
          const workspaceSnapshot = snapshot as PaseoWorkspaceListResult;
          const next = new Set<string>();
          for (const workspace of workspaceSnapshot.entries) {
            next.add(workspace.id);
            updateWorkspace(workspace);
          }
          workspacesListed = true;
          const removedIds = new Set([...workspaces.keys()].filter((id) => !next.has(id)));
          for (const id of removedIds) workspaces.delete(id);
          // Gone from the list, or never in it: archived, and its cards leave.
          for (const [id, entry] of entries) {
            if (!entry.agent.workspaceId || next.has(entry.agent.workspaceId)) continue;
            if (removedIds.has(entry.agent.workspaceId)) {
              const project = projectFor(entry, undefined, projects);
              baseCards.set(id, buildBaseCard(entry, undefined, project, colorNames, modelCatalogs.get(entry.agent.provider), project ? projectIcons.get(project.projectId) : undefined));
            }
            refreshWithKin(id);
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
            refreshWithKin(id);
          }
          notify();
        }
      });
    } catch (caught) {
      if (isCurrent(run)) {
        workspacesReady = true;
        subscriptionError(caught);
      }
    }
  }

  function applyLabelDefinitions(labels: Array<{ name: string; color: string }>) {
    colorNames.clear();
    for (const label of labels) colorNames.set(label.name, LABEL_COLORS[label.color] ?? fallbackLabelColor(label.name));
    for (const [id, entry] of entries) {
      const workspace = entry.agent.workspaceId ? workspaces.get(entry.agent.workspaceId) : undefined;
      const project = projectFor(entry, workspace, projects);
      const projectId = workspace?.projectId ?? project?.projectId ?? null;
      baseCards.set(id, buildBaseCard(entry, workspace, project, colorNames, modelCatalogs.get(entry.agent.provider), projectId ? projectIcons.get(projectId) : undefined));
      refreshFinalCard(id);
    }
    notify();
  }

  async function startLabelSubscription(run: Run) {
    const labelApi = api.workspaces as unknown as OptionalLabelsApi;
    if (typeof labelApi.listLabels !== "function") {
      await readLabelDefinitions(run);
      return;
    }
    try {
      const result = await labelApi.listLabels({ subscribe: {} });
      if (!isCurrent(run)) {
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
      if (!isCurrent(run)) return;
      applyLabelDefinitions(ready.labels);
      initialApplied = true;
      for (const event of pending) {
        if (event.kind === "snapshot") applyLabelDefinitions(event.labels);
        else applyLabelUpdate(event.value);
      }
    } catch (caught) {
      if (isCurrent(run)) subscriptionError(caught);
    }
  }

  /**
   * Without the host's label list, the plugin server reads the definitions
   * off the daemon, once per board; a label added or recolored meanwhile
   * shows on the next board. Without either, labels keep stand-in colors.
   */
  async function readLabelDefinitions(run: Run) {
    const loader = labelDefinitionsLoader;
    if (!loader) return;
    try {
      const labels = await loader();
      if (labels && isCurrent(run)) applyLabelDefinitions(labels);
    } catch {
      // The stand-in colors stay.
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
      // A drawn project's icon changed (or loaded before its project did): fetch the new one.
      if (icon && icon.revision !== (project.projectIconRevision ?? null)) {
        projectIcons.delete(project.projectId);
        requestProjectIcon(project.projectId);
      }
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

  async function startProjects(run: Run) {
    const queued: Array<unknown> = [];
    let initialApplied = false;
    projectUnsubscribes.push(api.projects.subscribe((update) => {
      if (!isCurrent(run)) return;
      if (initialApplied) applyProjectUpdate(update);
      else queued.push(update);
    }));
    try {
      const result = await api.projects.list();
      if (!isCurrent(run)) return;
      batchUpdates(() => {
        for (const project of result.projects) applyProject(project);
        initialApplied = true;
        for (const update of queued) applyProjectUpdate(update as PaseoProjectUpdate);
      });
    } catch (caught) {
      if (isCurrent(run)) subscriptionError(caught);
    }
  }

  function applyProviderEntries(entries: PaseoProviderSnapshotResult["entries"]) {
    enabledProviders.clear();
    for (const entry of entries) {
      if (entry.enabled === false) continue;
      enabledProviders.set(entry.provider, entry.label ?? providerLabel(entry.provider));
    }
    notify();
  }

  /** The enabled providers, kept current; a host without the snapshot leaves the filter to the cards' providers. */
  async function startProviders(run: Run) {
    if (typeof api.providers?.snapshot !== "function") return;
    let initialApplied = false;
    if (typeof api.providers.subscribe === "function") {
      providerUnsubscribes.push(api.providers.subscribe((update) => {
        if (isCurrent(run) && initialApplied && update.entries.length > 0) applyProviderEntries(update.entries);
      }));
    }
    try {
      const result = await api.providers.snapshot();
      if (!isCurrent(run)) return;
      initialApplied = true;
      applyProviderEntries(result.entries);
    } catch {
      // The cards' providers still fill the filter.
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

  function startBase() {
    const run: Run = { generation, tier: "base", tierRun: 0 };
    statusReady = false;
    sourceMembers.set(STATUS_KEY, new Set());
    void openAgentSubscription(STATUS_KEY, activeOptions(STATUS_FILTER), run);
    scheduleSubagents(0);
  }

  function startAttention() {
    const run: Run = { generation, tier: "attention", tierRun: ++attentionRun };
    attentionReady = false;
    workspacesReady = false;
    workspacesListed = false;
    sourceMembers.set(ATTENTION_KEY, new Set());
    void openAgentSubscription(ATTENTION_KEY, activeOptions(ATTENTION_FILTER), run);
    void startWorkspaceSubscription(run);
  }

  function startBoard() {
    const run: Run = { generation, tier: "board", tierRun: ++boardRun };
    void startLabelSubscription(run);
    void startProjects(run);
    void startProviders(run);
    for (const entry of entries.values()) {
      requestModelCatalogFor(entry.agent);
      requestLastTurnFor(entry.agent);
    }
    scheduleSubagents(0);
  }

  /** The done lane's list; with the archived lane it includes archived agents, which sort among the rest. */
  function doneFilter(): PaseoAgentListOptions["filter"] {
    return archivedAsked ? { statuses: ["idle", "closed"], includeArchived: true } : { statuses: ["idle", "closed"] };
  }

  /**
   * Turn the archived lane on or off: the done list is read again with or
   * without archived agents. The cards on the board stay until it lands, so
   * the count moves once: off, the archived cards leave at once; on, they
   * come with the new list.
   */
  function setArchivedLane(on: boolean) {
    if (archivedAsked === on) return;
    archivedAsked = on;
    batchUpdates(() => {
      if (doneConsumers > 0 && consumers > 0) {
        doneRun += 1;
        stopSubscription(DONE_SUBSCRIPTION);
        // A page in flight belongs to the old list, and the old cursor to its filter.
        loadingDone = false;
        doneReloading = true;
        openDoneList();
      }
      if (!on || !doneReloading) showArchivedLane(on);
      notify();
    });
  }

  /** The done list arrived, or could not: the archived lane follows what was asked. */
  function doneListLanded() {
    doneReloading = false;
    showArchivedLane(archivedAsked);
  }

  /** Draw the archived lane or not: the cards of archived agents and archived workspaces come or go. */
  function showArchivedLane(on: boolean) {
    if (archivedLane === on) return;
    archivedLane = on;
    for (const id of entries.keys()) refreshFinalCard(id);
    notify();
  }

  function startDone() {
    sourceMembers.set(DONE_SUBSCRIPTION, new Set());
    openDoneList();
  }

  function openDoneList() {
    const run: Run = { generation, tier: "done", tierRun: ++doneRun };
    void openAgentSubscription(DONE_SUBSCRIPTION, {
      filter: doneFilter(),
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
    doneRun += 1;
    stopSubscription(DONE_SUBSCRIPTION);
    for (const key of [...sourceMembers.keys()]) if (key === DONE_SUBSCRIPTION || key.startsWith("done-page-")) sourceMembers.delete(key);
    for (const id of [...entries.keys()]) if (memberSetsContaining(id).length === 0) dropIfUnreferenced(id);
    doneCursor = null;
    doneTailAt = null;
    loadingDone = false;
    doneListLanded();
    notify();
  }

  /**
   * Neither a board nor the review count left: the records only the
   * attention list held go, and the rest lose their workspace details.
   */
  function stopAttention() {
    attentionRun += 1;
    stopSubscription(ATTENTION_KEY);
    stopSubscription("workspaces");
    sourceMembers.delete(ATTENTION_KEY);
    attentionReady = false;
    workspacesReady = false;
    workspacesListed = false;
    workspaces.clear();
    batchUpdates(() => {
      for (const id of [...entries.keys()]) dropIfUnreferenced(id);
      for (const [id, entry] of entries) {
        baseCards.set(id, buildBaseCard(entry, undefined, undefined, colorNames, modelCatalogs.get(entry.agent.provider), undefined));
      }
      for (const id of entries.keys()) refreshFinalCard(id);
      notify();
    });
  }

  /**
   * The last board closed: back to the counts' subscriptions. Records only
   * the board listed go, and the rest lose the project details that would go
   * stale; a board opened later reads them again. The workspaces stay with
   * the attention list.
   */
  function stopBoard() {
    boardRun += 1;
    stopSubscription("labels");
    for (const unsubscribe of projectUnsubscribes.splice(0)) unsubscribe();
    for (const unsubscribe of providerUnsubscribes.splice(0)) unsubscribe();
    enabledProviders.clear();
    projects.clear();
    colorNames.clear();
    projectIcons.clear();
    iconRequests.clear();
    batchUpdates(() => {
      for (const id of [...entries.keys()]) dropIfUnreferenced(id);
      for (const [id, entry] of entries) {
        const workspace = entry.agent.workspaceId ? workspaces.get(entry.agent.workspaceId) : undefined;
        baseCards.set(id, buildBaseCard(entry, workspace, undefined, colorNames, modelCatalogs.get(entry.agent.provider), undefined));
      }
      for (const id of entries.keys()) refreshFinalCard(id);
      notify();
    });
  }

  function stopAll() {
    generation += 1;
    for (const key of [...subscriptions.keys()]) stopSubscription(key);
    for (const unsubscribe of projectUnsubscribes.splice(0)) unsubscribe();
    for (const unsubscribe of providerUnsubscribes.splice(0)) unsubscribe();
    enabledProviders.clear();
    for (const key of [...sourceMembers.keys()]) sourceMembers.delete(key);
    entries.clear();
    baseCards.clear();
    cards.clear();
    childrenByParent.clear();
    parentByChild.clear();
    resolvedParents.clear();
    parentReads.clear();
    workspaces.clear();
    projects.clear();
    colorNames.clear();
    modelCatalogs.clear();
    modelRequests.clear();
    projectIcons.clear();
    iconRequests.clear();
    lastTurns.clear();
    turnErrors.clear();
    turnCosts.clear();
    lastTurnAsked.clear();
    lastTurnQueue = new Set();
    workingSince.clear();
    goneChecks.clear();
    if (subagentTimer !== null) clearTimeout(subagentTimer);
    subagentTimer = null;
    subagentDueAt = Number.POSITIVE_INFINITY;
    subagentsByParent.clear();
    subagentParentsAsked.clear();
    subagentVersion = undefined;
    readMarks.clear();
    statusReady = false;
    attentionReady = false;
    workspacesReady = false;
    workspacesListed = false;
    doneCursor = null;
    doneTailAt = null;
    loadingDone = false;
    doneReloading = false;
    archivedLane = archivedAsked;
    error = null;
    notify();
  }

  function upsertWorkspacesOptions(): WorkspaceOption[] {
    return [...workspaces.values()]
      .filter((workspace) => !workspace.archivingAt)
      .map((workspace) => {
        const project = projects.get(workspace.projectId);
        const icon = projectIcons.get(workspace.projectId);
        return {
          id: workspace.id,
          name: workspace.title?.trim() || workspace.name,
          projectId: workspace.projectId,
          projectName: workspace.projectCustomName?.trim() || workspace.projectDisplayName,
          projectKey: project?.projectKey || null,
          projectIcon: icon && icon.revision === (project?.projectIconRevision ?? null) ? icon.uri : null,
          folder: typeof workspace.workspaceDirectory === "string" ? pathTail(workspace.workspaceDirectory) : null,
          projectPath: project?.projectRootPath || workspace.projectRootPath || null,
        };
      })
      .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name));
  }

  function getSnapshot(options: TasksOptions): TasksHandle {
    const showArchived = options.includeDone && options.includeArchived === true && archivedAsked;
    const cacheKey = `${options.includeDone ? "done" : "active"}:${options.doneWindow}:${showArchived ? "archived" : ""}`;
    const cached = snapshotCaches.find((entry) => entry.key === cacheKey)?.snapshot;
    if (cached) return cached as TasksHandle;
    const cutoff = doneWindowMs(options.doneWindow);
    const now = Date.now();
    const filteredCards = [...cards.values()].filter((card) => {
      if (!isHistoryLane(card.lane)) return true;
      if (!options.includeDone || (card.lane === "archived" && !showArchived)) return false;
      if (cutoff === null) return true;
      // Archiving moves `updatedAt`; a done card's own end ignores the daemon loading it.
      const at = Date.parse(card.lane === "done" ? settledAt(card.timing) : card.timing.updatedAt);
      return Number.isFinite(at) && now - at <= cutoff;
    });
    const byId = new Map(filteredCards.map((card) => [card.id, card]));
    const lanes = {} as Record<LaneId, LaneModel>;
    for (const lane of LANE_ORDER) {
      const laneCards = filteredCards.filter((card) => card.lane === lane);
      laneCards.sort(laneCompare(lane));
      const tailOld = cutoff !== null && doneTailAt !== null && Number.isFinite(Date.parse(doneTailAt)) && now - Date.parse(doneTailAt) > cutoff;
      const paged = lane === "done" ? options.includeDone : lane === "archived" && showArchived;
      lanes[lane] = {
        id: lane,
        cards: laneCards,
        hasMore: paged && Boolean(doneCursor) && !tailOld,
        // The archived lane waits on its first list while the done lane keeps its cards.
        loading: paged && (loadingDone || (lane === "archived" && doneReloading)),
      };
    }
    // Every enabled provider, then any other a card was run with (one disabled since).
    const providersById = new Map<string, string>(enabledProviders);
    // Every label Paseo defines or a live workspace carries, then any other on a card.
    const labelsByName = new Map<string, TaskLabel>([...colorNames].map(([name, color]) => [name, { name, color }]));
    for (const workspace of workspaces.values()) {
      if (workspace.archivingAt) continue;
      for (const name of workspace.labels ?? []) if (!labelsByName.has(name)) labelsByName.set(name, { name, color: fallbackLabelColor(name) });
    }
    for (const card of filteredCards) {
      if (!providersById.has(card.provider)) providersById.set(card.provider, card.providerLabel);
      for (const label of card.labels) labelsByName.set(label.name, label);
    }
    const counts: BoardCounts = {
      needsInput: lanes.needs_input.cards.length,
      running: lanes.running.cards.length,
      review: lanes.review.cards.length,
      done: lanes.done.cards.length,
      archived: lanes.archived.cards.length,
    };
    const snapshot: TasksHandle = {
      lanes,
      counts,
      byId,
      workspaces: upsertWorkspacesOptions(),
      providers: [...providersById].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
      labels: [...labelsByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
      ready: statusReady && attentionReady && workspacesReady,
      error,
      loadMoreDone: () => { if (options.includeDone) loadMoreDone(options.doneWindow); },
      resolveParent,
      refreshParent,
      refreshReads,
      requestProjectIcon,
    };
    snapshotCaches.push({ key: cacheKey, snapshot });
    return snapshot;
  }

  function getCounts(): SidebarCounts {
    if (countsDirty || !countsCache) {
      countsDirty = false;
      let needsInput = 0;
      let running = 0;
      let review = 0;
      // Until both lists land the review count is unknown, not the unread
      // agents of archived workspaces: it stays hidden instead of jumping down.
      const reviewKnown = attentionReady && workspacesReady;
      const count = (lane: LaneId) => {
        if (lane === "needs_input") needsInput += 1;
        else if (lane === "running") running += 1;
        else if (lane === "review" && reviewKnown) review += 1;
      };
      for (const card of cards.values()) {
        count(card.lane);
        // A provider subagent's card counts in its lane, as the board draws it (`withSubagentCards`).
        if (card.lane !== "archived" && card.children.some((child) => child.kind === "provider")) {
          for (const sub of subagentCardsOf(card)) count(sub.lane);
        }
      }
      // The same object while the numbers hold, so a streaming agent does not re-render the row.
      if (
        !countsCache ||
        countsCache.needsInput !== needsInput ||
        countsCache.running !== running ||
        countsCache.review !== review ||
        countsCache.ready !== statusReady
      ) {
        countsCache = { needsInput, running, review, ready: statusReady };
      }
    }
    return countsCache;
  }

  function loadMoreDone(window: DoneWindow) {
    if (loadingDone || doneReloading || !doneCursor || doneConsumers === 0) return;
    const cutoff = doneWindowMs(window);
    const tailTime = doneTailAt ? Date.parse(doneTailAt) : Number.NaN;
    if (cutoff !== null && Number.isFinite(tailTime) && Date.now() - tailTime > cutoff) return;
    const cursor = doneCursor;
    const run: Run = { generation, tier: "done", tierRun: doneRun };
    loadingDone = true;
    notify();
    void api.agents.list({
      filter: doneFilter(),
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: PAGE_SIZE, cursor },
    }).then((result) => {
      if (!isCurrent(run)) return;
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
      if (!isCurrent(run)) return;
      loadingDone = false;
      notify();
    });
  }

  /**
   * A parent off the board is read once, so its children's cards can say
   * whether it is archived. Read after the current batch: a list can bring a
   * child before its parent.
   */
  function queueParentRead(id: string) {
    if (resolvedParents.has(id) || parentReads.has(id)) return;
    parentReads.add(id);
    if (parentReads.size > 1) return;
    const run = generation;
    void Promise.resolve().then(() => {
      const ids = [...parentReads];
      parentReads.clear();
      if (run !== generation) return;
      for (const parentId of ids) if (!entries.has(parentId)) resolveParent(parentId);
    });
  }

  function resolveParent(id: string) {
    if (resolvedParents.has(id)) return;
    refreshParent(id).catch(subscriptionError);
  }

  function refreshReads(): void {
    void readReads(generation);
  }

  function refreshParent(id: string): Promise<boolean | null> {
    if (!resolvedParents.has(id)) resolvedParents.set(id, { title: null, archived: null });
    const run = generation;
    return api.agents.ref(id).refresh().then((result) => {
      const archived = result ? isArchived(result.agent) : null;
      if (run !== generation || !result) return archived;
      resolvedParents.set(id, { title: result.agent.title?.trim() || null, archived });
      for (const childId of childrenByParent.get(id) ?? []) refreshFinalCard(childId);
      notify();
      return archived;
    });
  }

  /**
   * One project's icon: from the host's API where it has the call, else from
   * the plugin server, batched with the other projects asked for in the same
   * task (opening a filter menu asks for every project at once).
   */
  function fetchProjectIcon(projectId: string): Promise<{ data: string; mimeType: string } | null> {
    const iconApi = api.projects as PaseoApi["projects"] & OptionalProjectIconsApi;
    if (typeof iconApi.icon === "function") return iconApi.icon(projectId).then((result) => result.icon);
    return new Promise((resolve) => {
      if (!iconBatch) {
        const batch = new Map<string, Array<(icon: { data: string; mimeType: string } | null) => void>>();
        iconBatch = batch;
        setTimeout(() => {
          if (iconBatch === batch) iconBatch = null;
          const settle = (icons: Map<string, { data: string; mimeType: string } | null>) => {
            for (const [id, waiting] of batch) for (const done of waiting) done(icons.get(id) ?? null);
          };
          const loader = projectIconsLoader;
          if (!loader) return settle(new Map());
          // A server that cannot read the icons leaves the generated ones: an icon is not worth a board error.
          loader([...batch.keys()]).then(
            (icons) => settle(new Map((icons ?? []).map((entry) => [entry.projectId, entry.icon]))),
            () => settle(new Map()),
          );
        }, 0);
      }
      iconBatch.set(projectId, [...(iconBatch.get(projectId) ?? []), resolve]);
    });
  }

  function requestProjectIcon(projectId: string) {
    const iconApi = api.projects as PaseoApi["projects"] & OptionalProjectIconsApi;
    if (typeof iconApi.icon !== "function" && !projectIconsLoader) return;
    const revision = projects.get(projectId)?.projectIconRevision ?? null;
    const cached = projectIcons.get(projectId);
    if (cached?.revision === revision) return;
    const requestKey = `${projectId}:${revision ?? ""}`;
    if (iconRequests.has(requestKey)) return;
    iconRequests.add(requestKey);
    const run = generation;
    void fetchProjectIcon(projectId).then((data) => {
      iconRequests.delete(requestKey);
      if (run !== generation) return;
      // The project arrived or changed its icon meanwhile; the card asks only once, so ask again for the new revision.
      if ((projects.get(projectId)?.projectIconRevision ?? null) !== revision) {
        requestProjectIcon(projectId);
        return;
      }
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

  function subscribe(listener: () => void, demand: TasksDemand): () => void {
    const done = demand.board && demand.done;
    const attention = demand.board || demand.attention === true;
    listeners.add(listener);
    consumers += 1;
    if (consumers === 1) {
      generation += 1;
      startBase();
    }
    if (attention) {
      attentionConsumers += 1;
      if (attentionConsumers === 1) startAttention();
    }
    if (demand.board) {
      boardConsumers += 1;
      if (boardConsumers === 1) startBoard();
    }
    if (done) {
      doneConsumers += 1;
      if (doneConsumers === 1) startDone();
    }
    return () => {
      listeners.delete(listener);
      consumers = Math.max(0, consumers - 1);
      if (done) {
        doneConsumers = Math.max(0, doneConsumers - 1);
        if (doneConsumers === 0 && consumers > 0) stopDone();
      }
      if (demand.board) {
        boardConsumers = Math.max(0, boardConsumers - 1);
        if (boardConsumers === 0 && consumers > 0) stopBoard();
      }
      if (attention) {
        attentionConsumers = Math.max(0, attentionConsumers - 1);
        if (attentionConsumers === 0 && consumers > 0) stopAttention();
      }
      if (consumers === 0) stopAll();
    };
  }

  /**
   * A warm hold is one more board consumer without a listener: the tiers'
   * ref counts do the rest, so a board mounted while a hold is up, or a hold
   * taken while a board is open, starts nothing, and the last of them to go
   * closes the board's subscriptions. One hold per reason; taking it again
   * only moves its deadline.
   */
  const holds = new Map<TasksHoldReason, WarmHold>();

  function hold(reason: TasksHoldReason, ms: number | null) {
    let held = holds.get(reason);
    if (!held) {
      held = { release: subscribe(() => {}, BOARD_DEMAND), timer: null };
      holds.set(reason, held);
      heldStores.add(store);
    }
    if (held.timer !== null) clearTimeout(held.timer);
    held.timer = ms === null ? null : setTimeout(() => dropHold(reason), ms);
  }

  function dropHold(reason: TasksHoldReason) {
    const held = holds.get(reason);
    if (!held) return;
    holds.delete(reason);
    if (held.timer !== null) clearTimeout(held.timer);
    if (holds.size === 0) heldStores.delete(store);
    held.release();
  }

  const store: TaskStore = {
    subscribe,
    hold,
    hasHold: (reason) => holds.has(reason),
    dropHolds() {
      for (const reason of [...holds.keys()]) dropHold(reason);
    },
    getSnapshot,
    getCounts,
    setArchivedLane,
    loadMoreDone,
    resolveParent,
    refreshParent,
    refreshReads,
    requestProjectIcon,
  };
  return store;
}

function getStore(api: PaseoApi): TaskStore {
  let store = stores.get(api);
  if (!store) {
    store = createStore(api);
    stores.set(api, store);
  }
  return store;
}

/**
 * All lanes, all subscriptions. The board screen calls this once.
 * `beforeRelease` runs as the board lets go, before its subscriptions could
 * close: a warm hold taken there keeps them open.
 */
export function useTasks(paseo: PaseoApi, options: TasksOptions, beforeRelease?: (paseo: PaseoApi) => void): TasksHandle {
  const store = getStore(paseo);
  const archived = options.includeDone && options.includeArchived === true;
  // Before the subscription (a layout effect runs ahead of it), so a first
  // board reads the done list once, with archived agents or without; after,
  // a switch reads it again without letting go of the board.
  useLayoutEffect(() => store.setArchivedLane(archived), [store, archived]);
  const subscribe = useMemo(() => (listener: () => void) => {
    const release = store.subscribe(listener, { board: true, done: options.includeDone });
    return () => {
      beforeRelease?.(paseo);
      release();
    };
  }, [store, paseo, options.includeDone, beforeRelease]);
  const getSnapshot = useMemo(() => () => store.getSnapshot(options), [store, options.doneWindow, options.includeDone, options.includeArchived]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Open the board's subscriptions ahead of a board, or keep them after one:
 * a warm hold for `reason`, released `ms` from now (null: no deadline until
 * the next call). Taking a held reason again moves its deadline and sends
 * nothing.
 */
export function holdTasks(paseo: PaseoApi, reason: TasksHoldReason, ms: number | null): void {
  getStore(paseo).hold(reason, ms);
}

export function hasTasksHold(paseo: PaseoApi, reason: TasksHoldReason): boolean {
  return stores.get(paseo)?.hasHold(reason) ?? false;
}

/** Drop every warm hold now (the board was turned off). Open boards keep their own subscriptions. */
export function releaseTasksHolds(): void {
  for (const store of [...heldStores]) store.dropHolds();
}

/**
 * The sidebar's counts. Alone it opens the agents in flight (running,
 * initializing, error), and with `review` the unread and failed ones too;
 * nothing else: no workspaces, projects, labels or model names. It counts
 * the cards an unfiltered board draws, a provider subagent's included.
 * Re-renders only when a number changes.
 */
export function useTaskCounts(paseo: PaseoApi, review: boolean): SidebarCounts {
  const store = getStore(paseo);
  const subscribe = useMemo(
    () => (listener: () => void) => store.subscribe(listener, { board: false, done: false, attention: review }),
    [store, review],
  );
  return useSyncExternalStore(subscribe, store.getCounts, store.getCounts);
}

/**
 * The lanes after the filter bar and search; pure. Hidden subtasks stay on
 * their parent's card; a running, waiting or failed one keeps its own card
 * unless its parent's card is in the same lane and already shows it.
 */
export function filterLanes(lanes: Record<LaneId, LaneModel>, filters: BoardFilters): Record<LaneId, LaneModel> {
  const query = filters.query.trim().toLowerCase();
  const matches = (card: TaskCard) => {
    const searchable = [card.title, card.location.projectName, card.location.workspaceName, card.location.branch]
      .filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
    return (!query || searchable.includes(query)) &&
      (filters.workspaceIds.length === 0 || (card.location.workspaceId !== null && filters.workspaceIds.includes(card.location.workspaceId))) &&
      (filters.providers.length === 0 || filters.providers.includes(card.provider)) &&
      (filters.labels.length === 0 || card.labels.some((label) => filters.labels.includes(label.name)));
  };
  const byId = new Map<string, TaskCard>();
  if (filters.hideSubtasks) for (const id of LANE_ORDER) for (const card of lanes[id].cards) byId.set(card.id, card);
  const keep = (card: TaskCard) => {
    if (!matches(card)) return false;
    if (!filters.hideSubtasks || card.parent === null) return true;
    if (card.status !== "running" && card.status !== "needs_input" && card.status !== "failed") return false;
    // A parent left on the lane shows it as a row, or its own parent does.
    const parent = byId.get(card.parent.id);
    return !(parent && parent.lane === card.lane && matches(parent));
  };
  const out = {} as Record<LaneId, LaneModel>;
  for (const id of LANE_ORDER) out[id] = { ...lanes[id], cards: lanes[id].cards.filter(keep) };
  return out;
}
