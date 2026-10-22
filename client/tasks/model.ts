/**
 * The Tasks board's view model: what the data layer (`client/tasks/data/`)
 * produces and the cards, board and settings preview draw. Plain data, no
 * host objects, so a card renders the same from live agents and from the
 * samples in `sample-cards.ts`.
 *
 * Times are ISO strings as the daemon sends them; a card computes "12m 30s"
 * against its own clock so one tick does not rebuild the model.
 */

/** The four lanes, left to right: what needs a person first. */
export type LaneId = "needs_input" | "running" | "review" | "done";

export const LANE_ORDER: readonly LaneId[] = ["needs_input", "running", "review", "done"];

/**
 * The status icon a card, lane header, phone tab, sidebar count and subtask
 * row draws. Mirrors Paseo's sidebar workspace indicator:
 * running ring, needs-input CircleAlert, unread green dot, failed red dot,
 * done grey dot at 30% opacity.
 */
export type StatusKind = "needs_input" | "running" | "unread" | "failed" | "done";

/** The icon of a lane's header and phone tab. */
export const LANE_STATUS: Readonly<Record<LaneId, StatusKind>> = {
  needs_input: "needs_input",
  running: "running",
  review: "unread",
  done: "done",
};

/** `workspaceKind` of the workspace descriptor; picks the location row's leading icon. */
export type WorkspaceKind = "local_checkout" | "worktree" | "checkout" | "directory";

export interface TaskLabel {
  name: string;
  /** A resolved colour (hex) from the label definitions, or null for a neutral dot. */
  color: string | null;
}

export interface TaskLocation {
  projectId: string | null;
  projectKey: string | null;
  projectName: string | null;
  /** A `data:` URI of the project's icon, or null for the letter avatar. */
  projectIcon: string | null;
  workspaceId: string | null;
  /** Null when equal to the project name or the task title (spec: 去重). */
  workspaceName: string | null;
  /** Raw display title (`title`, `name`, or placement name), before deduplication. */
  workspaceTitle: string | null;
  workspaceKind: WorkspaceKind | null;
  branch: string | null;
  /** Null when the workspace reports no git state. */
  git: { dirty: boolean | null; ahead: number | null; behind: number | null } | null;
  /** Last segment of `cwd`; null when equal to the project, workspace or branch name. */
  folder: string | null;
  /** Last segment of `cwd` before deduplication. */
  folderName: string | null;
  /** The full `cwd`, shown instead of the folder when `card.path` is on. */
  cwd: string;
  pullRequest: { number: number | null; title: string; url: string } | null;
}

export interface TaskTiming {
  createdAt: string;
  updatedAt: string;
  /** `activeTurn.startedAt`; the running timer counts from it. */
  turnStartedAt: string | null;
  /** `attentionTimestamp`; the needs-input timer counts from it. */
  attentionAt: string | null;
  lastUserMessageAt: string | null;
  /**
   * The latest turn's length in ms, drawn as "约 8m", from the plugin server's
   * record of each turn or a turn end the board saw. Null when neither has the
   * turn: `updatedAt` also moves when the daemon resumes the agent, so it
   * cannot time one.
   */
  lastTurnMs: number | null;
  /** When that turn ended; null with `lastTurnMs`. */
  lastTurnEndedAt: string | null;
}

export interface TaskContext {
  usedTokens: number;
  maxTokens: number;
}

export interface TaskUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalCostUsd: number | null;
}

export type PermissionKind = "tool" | "plan" | "question" | "mode" | "other";

export interface TaskPermissionAction {
  id: string;
  label: string;
  behavior: "allow" | "deny";
  variant: "primary" | "secondary" | "danger" | null;
}

/** The first pending permission request; `remaining` counts the others. */
export interface TaskPermission {
  requestId: string;
  kind: PermissionKind;
  title: string;
  /** The command or file the request is about, one line; null when none. */
  summary: string | null;
  /** The request's own buttons; empty means draw Allow and Deny. */
  actions: TaskPermissionAction[];
  remaining: number;
}

export interface TaskParentRef {
  id: string;
  /** Null until resolved; an archived parent may be fetched with `agents.ref(id).refresh()`. */
  title: string | null;
  /** True when the parent is not on the board: archived, or outside the filters and done window. */
  missing: boolean;
  /**
   * Whether the parent is archived. False on the board; for a missing parent,
   * null until it is read (`resolveParent`). A missing parent that is not
   * archived only fell out of the loaded set (an old done task).
   */
  archived: boolean | null;
}

export interface TaskChild {
  id: string;
  title: string;
  status: StatusKind;
  /**
   * "provider": a subagent the provider runs inside the parent's session
   * (Claude's Agent tool), not a Paseo agent. It has no card or tab, so its
   * row opens the parent. Absent: a Paseo agent with its own card.
   */
  kind?: "agent" | "provider";
  /** A provider row's facts line, written by the provider: subagent type, model, effort, tokens. */
  subtitle?: string | null;
  /** The child's own agent, for its row's mark and facts line (Paseo 0.12's subagent row). */
  provider?: string;
  modelLabel?: string | null;
  thinkingLabel?: string | null;
  modeLabel?: string | null;
  context?: TaskContext | null;
  /** The child's lane and timing, for its row's start and timer as the card footer draws them. */
  lane?: LaneId;
  timing?: TaskTiming;
}

export interface TaskCard {
  id: string;
  /** The agent's title, else a fallback such as the first prompt line or "Untitled". */
  title: string;
  lane: LaneId;
  status: StatusKind;
  /** Provider id as the daemon names it: "claude", "codex", ... */
  provider: string;
  /** Display name of the provider: "Claude". */
  providerLabel: string;
  /** Mark id for `useMarkBitmap`; null draws no brand mark. */
  providerMark: string | null;
  model: string | null;
  /** Display name from `providers.listModels`; falls back to the raw id. */
  modelLabel: string | null;
  thinkingLabel: string | null;
  modeLabel: string | null;
  location: TaskLocation;
  labels: TaskLabel[];
  timing: TaskTiming;
  context: TaskContext | null;
  usage: TaskUsage | null;
  /** `lastError`, or "Stopped manually" after a stop from the board; review and done lanes only. */
  error: string | null;
  /** Stopped from the board and not run since: drawn with the solid stop square. */
  stoppedManually?: boolean;
  permission: TaskPermission | null;
  parent: TaskParentRef | null;
  /** Direct children only; grandchildren unfold on the child's own card. */
  children: TaskChild[];
  /** Some client reports an open tab for it (`paseo.open-agent-tab.*` is "true"). */
  openTab: boolean;
  /** False when the agent is idle or closed; Stop shows only when true. */
  stoppable: boolean;
  /** The daemon has not loaded the agent: reading its timeline would resume it. */
  closed?: boolean;
}

/** One lane's cards in display order, with what the done lane still has to load. */
export interface LaneModel {
  id: LaneId;
  cards: TaskCard[];
  /** Done lane only: another page is available. */
  hasMore: boolean;
  loading: boolean;
}

export interface BoardCounts {
  needsInput: number;
  running: number;
  review: number;
  done: number;
}

/** Board filters; travel in the screen's params (string → string). */
export interface BoardFilters {
  query: string;
  workspaceIds: string[];
  providers: string[];
  labels: string[];
  openTabsOnly: boolean;
  hideSubtasks: boolean;
}

export const EMPTY_FILTERS: BoardFilters = {
  query: "",
  workspaceIds: [],
  providers: [],
  labels: [],
  openTabsOnly: false,
  hideSubtasks: false,
};
