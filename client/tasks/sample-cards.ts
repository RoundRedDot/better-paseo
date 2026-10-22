import type { TaskCard } from "./model";

/**
 * Made-up cards: the settings page's preview of the board draws them, and the
 * card and board tests use them. `sampleCards` holds one or two per lane plus
 * a parent with children, so every block of the card shows up somewhere;
 * `previewSampleCards` adds a question and a card stopped from the board, so
 * the preview fills every lane with two.
 *
 * `now` anchors the times, so a timer reads "12m 30s" whenever the preview opens.
 */
function allSamples(now: number): TaskCard[] {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const minute = 60_000;

  const location = {
    projectId: "prj_sample",
    projectKey: "remote:github.com/RoundRedDot/better-paseo",
    projectName: "better-paseo",
    projectIcon: null,
    workspaceId: "wks_sample",
    workspaceName: "tasks-board",
    workspaceTitle: "tasks-board",
    workspaceKind: "worktree" as const,
    branch: "feat/tasks-board",
    git: { dirty: true, ahead: 3, behind: 0 },
    folder: null,
    folderName: "tasks-board",
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
    lastTurnEndedAt: ago(2 * minute),
  };
  const base = {
    provider: "claude",
    providerLabel: "Claude",
    providerMark: "lobe:claude",
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
      id: "sample-question",
      title: "Pick the date format for the CSV export",
      lane: "needs_input",
      status: "needs_input",
      provider: "gemini",
      providerLabel: "Gemini",
      providerMark: "lobe:gemini",
      model: "gemini-3-pro",
      modelLabel: "Gemini 3 Pro",
      thinkingLabel: null,
      location: { ...location, workspaceName: "export-csv", workspaceTitle: "export-csv", branch: "feat/export-csv", git: { dirty: false, ahead: 1, behind: 2 }, pullRequest: null },
      labels: [{ name: "api", color: "#10b981" }],
      timing: { ...timing, attentionAt: ago(1 * minute), turnStartedAt: ago(6 * minute) },
      context: { usedTokens: 38_000, maxTokens: 1_000_000 },
      permission: {
        requestId: "perm-2",
        kind: "question",
        title: "Question",
        summary: "ISO 8601 dates, or the locale's short date?",
        actions: [],
        remaining: 0,
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
      providerMark: "lobe:codex",
      model: "gpt-5.5-codex",
      modelLabel: "GPT-5.5 Codex",
      thinkingLabel: "Medium",
      timing: { ...timing, turnStartedAt: ago(12 * minute + 30_000) },
      context: { usedTokens: 172_000, maxTokens: 200_000 },
      children: [
        { id: "sample-child-1", title: "Measure the sidebar ring", status: "running", provider: "claude", modelLabel: "Opus 4.7", thinkingLabel: "High", modeLabel: "Bypass", context: { usedTokens: 120_000, maxTokens: 200_000 }, lane: "running", timing: { ...timing, turnStartedAt: ago(3 * minute) } },
        { id: "sample-child-2", title: "Write the ring geometry test", status: "running", provider: "codex", lane: "running", timing: { ...timing, turnStartedAt: ago(5 * minute + 12_000) } },
        { id: "sample-child-3", title: "Collect status colours", status: "done", provider: "claude", lane: "done", timing },
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
      parent: { id: "sample-running", title: "Port the status ring to React Native", missing: false, archived: false },
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
      location: { ...location, branch: null, workspaceKind: "directory", git: null, folder: "scratch", folderName: "scratch", pullRequest: null },
      context: null,
    },
    {
      ...base,
      id: "sample-stopped",
      title: "Rewrite the onboarding copy",
      lane: "done",
      status: "done",
      provider: "pi",
      providerLabel: "Pi",
      providerMark: "provider:pi",
      model: "kimi-k2",
      modelLabel: "Kimi K2",
      thinkingLabel: null,
      location: { ...location, workspaceName: "onboarding", workspaceTitle: "onboarding", branch: "copy/onboarding", git: { dirty: true, ahead: 0, behind: 0 }, pullRequest: null },
      labels: [{ name: "copy", color: "#f59e0b" }],
      context: { usedTokens: 41_000, maxTokens: 128_000 },
      error: "Stopped manually",
      stoppedManually: true,
    },
  ];
}

/** Only the preview draws these: the board tests count the others. */
const PREVIEW_ONLY: ReadonlySet<string> = new Set(["sample-question", "sample-stopped"]);

export function sampleCards(now: number = Date.now()): TaskCard[] {
  return allSamples(now).filter((card) => !PREVIEW_ONLY.has(card.id));
}

export function previewSampleCards(now: number = Date.now()): TaskCard[] {
  return allSamples(now);
}
