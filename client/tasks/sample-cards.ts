import type { TaskCard } from "./model";

/**
 * Made-up cards: the settings page's live preview draws them, and the card and
 * board slices use them until the data layer is wired in. One per lane plus a
 * parent with children, so every block of the card shows up somewhere.
 *
 * `now` anchors the times, so a timer reads "12m 30s" whenever the preview opens.
 */
export function sampleCards(now: number = Date.now()): TaskCard[] {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const minute = 60_000;

  const location = {
    projectId: "prj_sample",
    projectName: "better-paseo",
    projectIcon: null,
    workspaceId: "wks_sample",
    workspaceName: "tasks-board",
    workspaceKind: "worktree" as const,
    branch: "feat/tasks-board",
    git: { dirty: true, ahead: 3, behind: 0 },
    folder: null,
    cwd: "/Users/dev/code/better-paseo/.worktrees/tasks-board",
    pullRequest: { number: 42, title: "feat: Tasks board", url: "https://github.com/RoundRedDot/better-paseo/pull/42" },
  };
  const timing = {
    createdAt: ago(90 * minute),
    updatedAt: ago(2 * minute),
    turnStartedAt: null,
    attentionAt: null,
    lastUserMessageAt: ago(20 * minute),
    lastTurnMs: 18 * minute,
  };
  const base = {
    provider: "claude",
    providerLabel: "Claude",
    providerMark: "claude",
    model: "claude-opus-5-5",
    modelLabel: "Opus 5.5",
    thinkingLabel: "High",
    modeLabel: "Bypass",
    location,
    labels: [
      { name: "frontend", color: "#8b5cf6" },
      { name: "p1", color: "#ef4444" },
      { name: "board", color: null },
    ],
    timing,
    context: { usedTokens: 92_000, maxTokens: 200_000 },
    usage: { inputTokens: 182_000, cachedInputTokens: 120_000, outputTokens: 14_200, totalCostUsd: 1.84 },
    error: null,
    permission: null,
    parent: null,
    children: [],
    openTab: true,
    stoppable: false,
  };

  return [
    {
      ...base,
      id: "sample-input",
      title: "Run the migration against the staging database",
      lane: "needs_input",
      status: "needs_input",
      timing: { ...timing, attentionAt: ago(4 * minute), turnStartedAt: ago(9 * minute) },
      permission: {
        requestId: "perm-1",
        kind: "tool",
        title: "Bash",
        summary: "npm run db:migrate -- --env staging",
        actions: [],
        remaining: 1,
      },
      stoppable: true,
    },
    {
      ...base,
      id: "sample-running",
      title: "Port the status ring to React Native",
      lane: "running",
      status: "running",
      provider: "codex",
      providerLabel: "Codex",
      providerMark: "codex",
      model: "gpt-5.5-codex",
      modelLabel: "GPT-5.5 Codex",
      thinkingLabel: "Medium",
      timing: { ...timing, turnStartedAt: ago(12 * minute + 30_000) },
      context: { usedTokens: 172_000, maxTokens: 200_000 },
      children: [
        { id: "sample-child-1", title: "Measure the sidebar ring", status: "running" },
        { id: "sample-child-2", title: "Write the ring geometry test", status: "running" },
        { id: "sample-child-3", title: "Collect status colours", status: "done" },
      ],
      stoppable: true,
    },
    {
      ...base,
      id: "sample-child-1",
      title: "Measure the sidebar ring",
      lane: "running",
      status: "running",
      labels: [],
      timing: { ...timing, turnStartedAt: ago(3 * minute) },
      parent: { id: "sample-running", title: "Port the status ring to React Native", missing: false },
      stoppable: true,
    },
    {
      ...base,
      id: "sample-failed",
      title: "Regenerate the Shiki baselines",
      lane: "review",
      status: "failed",
      location: { ...location, workspaceName: null, workspaceKind: "local_checkout", branch: "main", git: null, pullRequest: null },
      error: "Provider exited with code 1: rate limit reached",
    },
    {
      ...base,
      id: "sample-unread",
      title: "Summarise yesterday's QA notes",
      lane: "review",
      status: "unread",
      labels: [{ name: "docs", color: "#0ea5e9" }],
    },
    {
      ...base,
      id: "sample-done",
      title: "Bump the plugin SDK to 0.12",
      lane: "done",
      status: "done",
      location: { ...location, branch: null, workspaceKind: "directory", git: null, folder: "scratch", pullRequest: null },
      context: null,
    },
  ];
}
