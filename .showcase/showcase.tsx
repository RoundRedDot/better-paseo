/**
 * Offline showcase used only to capture README screenshots.
 *
 * It mounts the plugin's presentational components against mock data and the
 * same theme tokens the host feeds them, so a capture shows the real component
 * rather than a drawing of one.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { Text, View } from "react-native";

import { embedFonts } from "../client/components/embed-fonts";
import { installFrostedGlass } from "../client/components/frosted";
import { buildThemeTokens } from "../client/components/theme-tokens";
import { ToolCallout } from "../client/components/tool-callouts";
import { ReasoningCard, ReasoningTrace } from "../client/components/reasoning-trace";
import { reasoningText, segmentReasoning } from "../client/reasoning/segment";
import { TaskList } from "../client/components/task-list";
import { ApprovalCard } from "../client/components/approval-card";
import { UserMessage } from "../client/components/user-message";
import { HubCallout } from "../client/components/hub-callout";
import { SyntaxHighlightBlock } from "../client/components/syntax-highlight";
import { BeautifulChatSettingsPage } from "../client/settings-page";
import { buildHubData } from "../client/hub-details";
import { NoticeCallout } from "../client/components/notice-callout";
import { SystemCard } from "../client/components/system-card";
import { AssistantFooter } from "../client/components/turn-footer";
import { MARKDOWN_VARIANTS, MarkdownView } from "../client/components/markdown/markdown-view";
import { parseSystemEnvelope } from "../client/system-envelope";
import { HERO_REPLY, MD_SAMPLER, REASONING_PROSE, REASONING_SECTIONS, REPLY } from "./markdown-corpus";
import { installPointerGlow } from "../client/components/glow";
import type { ToolCalloutData } from "../shared/contracts";
import { DEFAULT_PREFERENCES } from "../client/preferences";
import type { ExtendedThemeTokens } from "../client/components/theme-tokens";
import { DisclosureHeader } from "../client/ui/disclosure-header";
import { CopyButton } from "../client/ui/copy-button";
import { ActionMenuList, ActionMenuTrigger } from "../client/ui/action-menu";
import { PathContext, PathText, type PathContextValue } from "../client/ui/path-text";
import { RunningDot } from "../client/ui/running-dot";
import { Glyph } from "../client/components/glyph";
import { classifyTool, type ToolCallPayload, type ToolCallView } from "../client/tools/classify";

const DARK = {
  surface0: "#0f0f11",
  surface1: "#17171a",
  surface2: "#1f1f23",
  border: "#2a2a30",
  foreground: "#f2f3f5",
  foregroundMuted: "#a3a6ad",
  accent: "#7aa2f7",
  accentForeground: "#0f0f11",
  statusSuccess: "#4cb782",
  statusWarning: "#d9a53f",
  statusDanger: "#f2555a",
};

const LIGHT = {
  surface0: "#ffffff",
  surface1: "#f6f6f7",
  surface2: "#ededef",
  border: "#e2e2e6",
  foreground: "#18181b",
  foregroundMuted: "#62626b",
  accent: "#2563eb",
  accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b",
  statusWarning: "#a36a00",
  statusDanger: "#d92d20",
};

/**
 * `?theme=light` captures the whole page on the light palette; the
 * `*-dark`/`*-light` shots below keep their fixed theme either way.
 */
const THEME =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("theme") === "light"
    ? "light"
    : "dark";
const BASE = THEME === "light" ? LIGHT : DARK;

// The shipped defaults (no frost, no glow), as a reader first sees them.
const tokens = buildThemeTokens(BASE, DEFAULT_PREFERENCES, { platform: "web" });

const bash: ToolCalloutData = {
  id: "bash",
  tool: "bash",
  title: "npm run typecheck",
  status: "completed",
  durationMs: 4253,
  exitCode: 0,
  command: "npm run typecheck",
  shell: {
    command: "npm run typecheck",
    cwd: "~/code/beautiful-chat",
    exitCode: 0,
    stdout: "> beautiful-chat@0.1.0 typecheck\n> tsc --noEmit\n\nChecked 34 files in 4.2s",
  },
};

const git: ToolCalloutData = {
  id: "git",
  tool: "git",
  title: "Git commit",
  status: "completed",
  durationMs: 812,
  command: 'git commit -m "feat: reveal tool file paths"',
  shell: {
    command: 'git commit -m "feat: reveal tool file paths"',
    stdout: "[main 421f5e8] feat: reveal tool file paths\n 6 files changed, 155 insertions(+)",
  },
};

const read: ToolCalloutData = {
  id: "read",
  tool: "read",
  title: "Read theme-tokens.ts",
  status: "completed",
  durationMs: 41,
  filePath: "client/components/theme-tokens.ts",
  lineRange: "150-166",
  language: "typescript",
  code: `export function buildThemeTokens(
  colors: PluginSurfaceColors,
  preferences: EnhancerPreferences = DEFAULT_PREFERENCES,
): ExtendedThemeTokens {
  const isDark = isDarkSurface(colors.surface0);
  const accent = ACCENT_PRESETS[preferences.accent] ?? colors.accent;
  return { isDark, surface0: colors.surface0, accent };
}`,
};

const readImage: ToolCalloutData = {
  id: "read-image",
  tool: "read",
  title: "Read hero.png",
  status: "completed",
  durationMs: 28,
  filePath: "images/hero.png",
  code: "// [Image file: 1175x1150]",
};

/**
 * The bytes for the image card.
 *
 * In the app these arrive from the plugin's daemon-side RPC, which a capture
 * cannot reach. The capture script therefore sets `__bcImageUri` before the
 * bundle evaluates; without it the panel still renders, reporting that the
 * file could not be read, which is the honest offline state.
 */
const sampleImage = {
  dataUri: (globalThis as { __bcImageUri?: string }).__bcImageUri ?? null,
  width: 1175,
  height: 1150,
  bytes: 122632,
  error: "No daemon in the offline showcase",
};

const githubCalls: ToolCalloutData[] = [
  {
    id: "gh-file",
    tool: "github",
    title: "file_read omercnet/paseo-plugins paseo-shared-browser/paseo-plugin.json",
    status: "completed",
    durationMs: 412,
    github: {
      op: "file_read",
      repo: "omercnet/paseo-plugins",
      subject: "paseo-shared-browser/paseo-plugin.json",
      request:
        '{"op":"file_read","repo":"omercnet/paseo-plugins","path":"paseo-shared-browser/paseo-plugin.json"}',
      file: {
        name: "paseo-shared-browser/paseo-plugin.json",
        language: "json",
        code: `{
  "id": "shared-browser",
  "requirements": { "paseo": "^0.8.0" },
  "build": [
    ["npm", "ci", "--include=dev"],
    ["npm", "run", "prepare:runtime"]
  ]
}`,
      },
    },
  },
  {
    id: "gh-pr",
    tool: "github",
    title: "pr_create paseo-cafe/paseo-cafe Add beautiful-chat",
    status: "completed",
    durationMs: 2430,
    github: {
      op: "pr_create",
      repo: "paseo-cafe/paseo-cafe",
      subject: "Add beautiful-chat",
      request:
        '{"op":"pr_create","repo":"paseo-cafe/paseo-cafe","base":"main","head":"ABorakati:add-beautiful-chat","title":"Add beautiful-chat"}',
      rows: [
        { label: "pull request", value: "#125 Add beautiful-chat" },
        { label: "base", value: "main ← ABorakati:add-beautiful-chat" },
      ],
      link: "https://github.com/paseo-cafe/paseo-cafe/pull/125",
    },
  },
  {
    id: "gh-run",
    tool: "github",
    title: "run_watch paseo-cafe/paseo-cafe 34955871731",
    status: "completed",
    durationMs: 61200,
    github: {
      op: "run_watch",
      repo: "paseo-cafe/paseo-cafe",
      subject: "34955871731",
      request: '{"op":"run_watch","repo":"paseo-cafe/paseo-cafe","run":"34955871731"}',
      rows: [
        { label: "Registry admission", value: "pass 15s", tone: "ok" as const },
        { label: "App", value: "pass 36s", tone: "ok" as const },
        { label: "Plugin (matrix.os)", value: "skipping" },
        { label: "CodeRabbit", value: "pass", tone: "ok" as const },
      ],
    },
  },
  {
    id: "gh-search",
    tool: "github",
    title: "search_code omercnet/paseo-plugins defineRpc",
    status: "completed",
    durationMs: 986,
    github: {
      op: "search_code",
      repo: "omercnet/paseo-plugins",
      subject: "defineRpc",
      request: '{"op":"search_code","repo":"omercnet/paseo-plugins","query":"defineRpc"}',
      rows: [
        { label: "paseo-shared-browser/shared/rpc.ts", value: "2" },
        { label: "paseo-omp/shared/bridge.ts", value: "1" },
      ],
    },
  },
];

const edit: ToolCalloutData = {
  id: "edit",
  tool: "edit",
  title: "Edit user-message.tsx",
  status: "completed",
  durationMs: 66,
  filePath: "client/components/user-message.tsx",
  diff: `@@ -99,10 +99,12 @@ const styles = useMemo(
         container: {
           borderRadius: radius.card,
-          backgroundColor: "#E9EBEE",
-          borderColor: "rgba(0,0,0,0.12)",
+          borderTopRightRadius: radius.chip,
+          backgroundColor: tokens.userSurface,
+          borderColor: tokens.userBorder,
+          ...tokens.boxShadow,
         },
         body: { flex: 1, gap: 3 },`,
};

const thinking: ToolCalloutData = {
  id: "thinking",
  tool: "thinking",
  title: "Reasoning",
  status: "completed",
  durationMs: 2100,
  thinking: {
    text: "The host maps the stream item before any transformer runs, so pasted images never reach plugin code. A chip would have to guess, so the bubble becomes a setting instead.",
    status: "completed",
    tokenCount: 412,
    steps: [
      "Read the transform call site in the app bundle",
      "Confirm the daemon row stores the same item",
      "Offer the host bubble as a preference",
    ],
  },
};

const mcp: ToolCalloutData = {
  id: "mcp",
  tool: "mcp",
  title: "codedb_search",
  status: "completed",
  durationMs: 935,
  mcp: {
    server: "devnav",
    tool: "codedb_search",
    transport: "stdio",
    arguments: { project_root: "~/code/paseo", query: "buildThemeTokens" },
    result: "2 results\n  client/components/theme-tokens.ts:165\n  client/live-renderers.tsx:289",
  },
};

const evalCall: ToolCalloutData = {
  id: "eval",
  tool: "eval",
  title: "Eval kernel",
  status: "completed",
  durationMs: 180,
  cells: [
    {
      title: "resolve paths",
      language: "javascript",
      code: `const target = isAbsolute(clean) ? clean : resolve(cwd, clean);\nconsole.log(target);`,
      output: "C:\\Users\\dev\\code\\paseo\\package.json",
    },
  ],
};

const ask: ToolCalloutData = {
  id: "ask",
  tool: "ask",
  title: "User decision",
  status: "completed",
  askOptions: [
    {
      id: "keep",
      label: "Keep enhanced bubble",
      description: "Token usage and copy stay. Pasted images stay hidden.",
    },
    {
      id: "host",
      label: "Use the host bubble",
      description: "Paseo draws prompts, so image previews return.",
      recommended: true,
    },
  ],
  askAnswer: ["Use the host bubble"],
};

const task: ToolCalloutData = {
  id: "task",
  tool: "task",
  title: "3 subagents",
  status: "running",
  subagent: {
    context: "Goal: capture one screenshot per component against real mock data.",
    agents: [
      {
        name: "ShotBuilder",
        agentType: "task",
        task: "Build the offline showcase page and capture one screenshot per component.",
        status: "running",
      },
      {
        name: "MarkdownFixes",
        agentType: "task",
        task: "Size the ordered marker column from the whole marker, and measure table cells in the mono face.",
        status: "completed",
      },
      {
        name: "SurfaceMarkers",
        agentType: "sonic",
        task: "Add the selection surface spread to every card root.",
        status: "completed",
      },
    ],
  },
};

// Built by the plugin's own mapper from the arguments and output of real
// `hub` calls, so the capture proves the mapping rather than a mock.
const hubStart = buildHubData(
  {
    op: "start",
    name: "shots-server",
    application: "node",
    args: ["-e", "http.createServer(...)"],
    ready: { log: "shots ready", port: 4173 },
  },
  "Started shots-server: ready pid=33368 uptime=172ms restarts=0\nReady log matched: shots ready",
  {
    content: [{ type: "text", text: "Started shots-server: ready pid=33368" }],
    details: {
      op: "start",
      timedOut: false,
      daemon: {
        name: "shots-server",
        id: "d-1",
        state: "ready",
        pid: 33368,
        restartCount: 0,
        readyMatch: "shots ready",
        persist: false,
        detached: false,
      },
    },
  },
);

const hubPs = buildHubData({ op: "ps" }, undefined, {
  content: [{ type: "text", text: "- omp.lsp.mux: ready pid=72044 uptime=19h22m restarts=0" }],
  details: {
    op: "list",
    daemons: [
      { name: "omp.lsp.mux", state: "ready", pid: 72044, restartCount: 0 },
      { name: "omp.browser.headless", state: "ready", pid: 53972, restartCount: 0 },
      { name: "shots-server", state: "exited", pid: 33368, exitCode: 1, restartCount: 0 },
    ],
  },
});

const hubMessage = buildHubData(
  { op: "send", to: "ShotBuilder", message: "Capture the dark theme first. Light theme after." },
  "Delivered to 1 peer(s):\n- ShotBuilder: injected",
  {
    content: [{ type: "text", text: "Delivered to 1 peer(s):\n- ShotBuilder: injected" }],
    details: {
      op: "send",
      from: "Main",
      to: "ShotBuilder",
      receipts: [{ to: "ShotBuilder", outcome: "injected" }],
    },
  },
);

// The case that used to print the raw envelope: a job snapshot answers with an
// empty text block and puts everything in `details`.
const hubWait = buildHubData({ op: "wait" }, "", {
  content: [{ type: "text", text: "" }],
  details: {
    op: "wait",
    jobs: [
      {
        id: "NoticeCallout",
        type: "task",
        status: "running",
        label: "NoticeCallout",
        durationMs: 466244,
        resolvedModel: "anthropic/claude-opus-5:high",
      },
      {
        id: "bash_a1b2c3",
        type: "bash",
        status: "completed",
        label: "npm run typecheck",
        durationMs: 4253,
        resultText: "Checked 34 files in 4.2s",
      },
    ],
    agents: [
      { id: "ShotBuilder", parentId: "Main", activity: "capturing", ageMs: 92000, live: true },
    ],
  },
});

const hubPeers = buildHubData({ op: "list" }, undefined, {
  content: [
    { type: "text", text: "2 peer(s) (running 1, idle 1, parked 0; shown 2, truncated 0):" },
  ],
  details: {
    op: "list",
    from: "Main",
    peers: [
      {
        id: "ShotBuilder",
        displayName: "ShotBuilder",
        kind: "sub",
        status: "running",
        unread: 0,
        lastActivity: Date.now() - 12000,
        activity: "capturing the syntax block",
      },
      {
        id: "NoticeCallout",
        displayName: "NoticeCallout",
        kind: "sub",
        status: "idle",
        unread: 2,
        lastActivity: Date.now() - 65000,
      },
    ],
    counts: { running: 1, idle: 1, parked: 0, shown: 2, truncated: 0 },
  },
});

const paseoTool = {
  id: "paseo",
  tool: "create_agent" as const,
  durationMs: 640,
  createAgent: {
    title: "Screenshot builder",
    provider: "claude",
    model: "claude-opus-5",
    initialPrompt: "Capture every component of the Beautiful Chat plugin.",
    agentId: "agent-8f21",
    status: "running" as const,
  },
};

const reasoning = {
  id: "trace",
  agentModel: "claude-opus-5",
  durationMs: 8400,
  totalTokens: 1180,
  status: "completed" as const,
  steps: [
    {
      id: "s1",
      number: 1,
      title: "Locate the transform call site",
      summary: "The host maps stream items to plugin items before transformers run.",
      status: "completed" as const,
      durationMs: 2100,
      tokenCount: 320,
      content:
        "The app converts a stream item into the protocol item, and the user message mapping keeps only text.",
    },
    {
      id: "s2",
      number: 2,
      title: "Check the daemon row",
      summary: "AgentTimelineRow stores the same item, so a server RPC cannot recover images.",
      status: "completed" as const,
      durationMs: 1600,
      tokenCount: 260,
      content: "Attachments live in the client attachment store, which plugins cannot read.",
      codeSnippet: {
        language: "typescript" as const,
        filename: "agent-timeline-store-types.ts",
        code: "export interface AgentTimelineRow {\n  seq: number;\n  item: AgentTimelineItem;\n}",
      },
    },
    {
      id: "s3",
      number: 3,
      title: "Offer the host bubble",
      summary: "A preference trades the enhanced bubble for image previews.",
      status: "active" as const,
      content: "The transformer reads the preference and declines interception when it is off.",
    },
  ],
};

const tasks = {
  id: "tasks",
  phaseName: "Screenshots",
  tasks: [
    {
      id: "t1",
      title: "Rename plugin to Beautiful Chat",
      phase: "Rename",
      status: "completed" as const,
      duration: "6m",
    },
    {
      id: "t2",
      title: "Build the offline showcase page",
      phase: "Screenshots",
      status: "in_progress" as const,
    },
    {
      id: "t3",
      title: "Capture every component",
      phase: "Screenshots",
      status: "pending" as const,
    },
    {
      id: "t4",
      title: "Open the file editor from a path",
      phase: "Docs",
      status: "blocked" as const,
      blockerReason: "Paseo exposes no file navigation to plugins",
    },
  ],
};

const approval = {
  id: "approval",
  toolName: "bash",
  title: "Delete the build output",
  riskLevel: "high" as const,
  rationale: "The command removes a directory that is not tracked by Git.",
  command: "rm -rf dist",
  targetPath: "~/code/beautiful-chat/dist",
  cwd: "~/code/beautiful-chat",
  timeoutSeconds: 60,
  status: "pending" as const,
  timestamp: new Date("2026-09-14T10:24:29Z").toISOString(),
};

function Shot({
  id,
  width = 900,
  background = BASE.surface0,
  children,
}: {
  id: string;
  width?: number;
  background?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} style={{ width, padding: 20, backgroundColor: background }}>
      <View style={{ gap: 10 }}>{children}</View>
    </div>
  );
}

/**
 * One conversation, in the order the timeline draws it: the prompt, the
 * model's thinking, its tool calls, the checklist, a background job landing,
 * and the reply that closes the turn. Every card here is the real component.
 */
const JOB_NOTICE = `<system-notice>
Background job MarkdownFixes has completed. Resume your work using the result below.
<task-result id="MarkdownFixes" agent="task" status="completed" duration="6m12s">
<meta lines="44" size="2.1KB" />
<preview full-output="agent://MarkdownFixes">
{
  "files": { "edited": "client/components/markdown/parse.ts" },
  "defects": ["ordered marker column sized from digits", "table cells under-measured"],
  "verification": [{ "check": "typecheck", "result": "pass" }]
}
</preview>
</task-result>
</system-notice>`;


function Thread() {
  const envelope = parseSystemEnvelope(JOB_NOTICE);
  return (
    <View style={{ gap: 12 }}>
      <UserMessage
        text="I can't click on URLs in the assistant responses."
        timestamp={new Date("2026-09-15T22:41:00Z")}
        tokens={tokens}
        usage={{ inputTokens: 270, cachedInputTokens: 36211627, outputTokens: 62024 }}
      />
      <ReasoningTrace data={reasoning} tokens={tokens} defaultExpanded />
      <ToolCallout data={bash} tokens={tokens} />
      <ToolCallout data={read} tokens={tokens} onRevealPath={() => {}} />
      <ToolCallout data={edit} tokens={tokens} onRevealPath={() => {}} />
      <ToolCallout data={task} tokens={tokens} />
      <TaskList data={tasks} tokens={tokens} />
      <HubCallout data={hubWait} tokens={tokens} />
      {envelope ? <SystemCard envelope={envelope} tokens={tokens} /> : null}
      <NoticeCallout
        data={{ id: "n1", level: "warning", message: "The daemon restarted twice in 30s." }}
        tokens={tokens}
      />
      <ApprovalCard request={approval} tokens={tokens} />
      <View>
        <MarkdownView text={REPLY} tokens={tokens} variant="document" />
        <AssistantFooter text={REPLY} at={new Date("2026-09-15T22:47:12Z")} tokens={tokens} />
      </View>
    </View>
  );
}


/**
 * One screenful for the top of the README: a prompt, a tool call with a
 * highlighted file, a finished background job, and the reply that closes the
 * turn. Short enough to read at a glance, and every card is the real one.
 */
function Hero() {
  const envelope = parseSystemEnvelope(JOB_NOTICE);
  return (
    <View style={{ gap: 12 }}>
      <UserMessage
        text="I can't click on URLs in the assistant responses."
        timestamp={new Date("2026-09-15T22:41:00Z")}
        tokens={tokens}
        usage={{ inputTokens: 270, cachedInputTokens: 36211627, outputTokens: 62024 }}
      />
      <ToolCallout data={read} tokens={tokens} onRevealPath={() => {}} />
      {envelope ? <SystemCard envelope={envelope} tokens={tokens} /> : null}
      <View>
        <MarkdownView text={HERO_REPLY} tokens={tokens} variant="document" />
        <AssistantFooter text={HERO_REPLY} at={new Date("2026-09-15T22:47:12Z")} tokens={tokens} />
      </View>
    </View>
  );
}


/**
 * The shared primitives from slice S1, on the v2 defaults (no frost, no glow)
 * in both themes. Hover-only states cannot be captured headless, so the
 * header actions are pinned visible on one row instead.
 */


const v2Dark = buildThemeTokens(DARK, DEFAULT_PREFERENCES, { platform: "web" });
const v2Light = buildThemeTokens(LIGHT, DEFAULT_PREFERENCES, { platform: "web" });

const PATHS: PathContextValue = {
  roots: [
    { path: "/Users/me/code/beautiful-chat/.worktrees/s1" },
    { path: "/Users/me/code/beautiful-chat", label: "beautiful-chat" },
  ],
  cwd: "/Users/me/code/beautiful-chat/.worktrees/s1",
  mode: "relative",
  reveal: () => {},
};

function Caption({ tokens, children }: { tokens: ExtendedThemeTokens; children: string }) {
  return (
    <Text style={{ color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: 11, marginTop: 6 }}>
      {children}
    </Text>
  );
}

// --- Reasoning v2 states (plan §3.4) ---------------------------------------



function ReasoningState({
  tokens,
  label,
  text,
  streaming,
  expanded,
  durationMs = null,
  cut,
}: {
  tokens: ExtendedThemeTokens;
  label: string;
  text: string;
  streaming: boolean;
  expanded: boolean;
  durationMs?: number | null;
  /** Streaming states show the text cut here, mid-word. */
  cut?: number;
}) {
  const visible = cut === undefined ? text : text.slice(0, cut);
  const segmentation = segmentReasoning(visible, { streaming });
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: tokens.foregroundSubtle, fontSize: 11, fontFamily: tokens.fontUi }}>
        {label}
      </Text>
      <ReasoningCard
        segmentation={segmentation}
        streaming={streaming}
        durationMs={durationMs}
        expanded={expanded}
        onToggle={() => {}}
        tokens={tokens}
        storeKey={`showcase:${label}`}
        copyText={reasoningText(segmentation)}
      />
    </View>
  );
}

function ReasoningStates({ tokens }: { tokens: ExtendedThemeTokens }) {
  const titleCut = REASONING_SECTIONS.indexOf("**Checking") + 40;
  return (
    <View style={{ gap: 14 }}>
      <ReasoningState tokens={tokens} label="streaming · sections · collapsed" text={REASONING_SECTIONS} streaming expanded={false} cut={titleCut} />
      <ReasoningState tokens={tokens} label="streaming · prose · collapsed" text={REASONING_PROSE} streaming expanded={false} cut={190} />
      <ReasoningState tokens={tokens} label="done · sections · collapsed (observed 12s)" text={REASONING_SECTIONS} streaming={false} expanded={false} durationMs={12_400} />
      <ReasoningState tokens={tokens} label="done · prose · collapsed (history: no duration)" text={REASONING_PROSE} streaming={false} expanded={false} />
      <ReasoningState tokens={tokens} label="done · sections · expanded" text={REASONING_SECTIONS} streaming={false} expanded durationMs={12_400} />
      <ReasoningState tokens={tokens} label="done · prose · expanded" text={REASONING_PROSE} streaming={false} expanded durationMs={3_100} />
    </View>
  );
}

/**
 * Tool calls v2 (plan §3.3): the live classification of real protocol
 * payloads, under the same roots a worktree agent would have. The first
 * block is what a turn looks like by default — collapsed rows, no frames —
 * and the second shows the open states.
 */
const TOOL_ROOT = "/Users/me/code/beautiful-chat/.worktrees/s1";

function payload(
  callId: string,
  name: string,
  detail: Record<string, unknown>,
  status = "completed",
  error: string | null = null,
): ToolCallView {
  const item: ToolCallPayload = { callId, name, status, detail, error };
  return classifyTool(item);
}

const READ_CODE = `export function formatPath(raw: string, ctx: FormatPathContext): FormattedPath {
  const { path, suffix } = splitSelector(raw);
  if (!path) return unmatched(raw.trim(), raw.trim());
}`;

const TOOLS_COLLAPSED: ToolCallView[] = [
  payload("r1", "Read", { type: "read", filePath: `${TOOL_ROOT}/client/paths/format-path.ts`, offset: 10, limit: 71, content: READ_CODE }),
  payload("r2", "Read", { type: "read", filePath: `${TOOL_ROOT}/client/ui/disclosure-header.tsx`, content: READ_CODE }),
  payload("r3", "Read", { type: "read", filePath: "/Users/me/code/beautiful-chat/docs/plans/2026-10-11-ui-ux-rendering-upgrade.md", offset: 263, limit: 41 }),
  payload("e1", "Edit", {
    type: "edit",
    filePath: `${TOOL_ROOT}/client/components/tool-callouts.tsx`,
    unifiedDiff: "--- a\n+++ b\n@@ -1,3 +1,4 @@\n-import { Breathe } from \"./breathe\";\n+import { RunningDot } from \"../ui/running-dot\";\n+import { DisclosureHeader } from \"../ui/disclosure-header\";\n const x = 1;\n",
  }),
  payload("w1", "Write", { type: "write", filePath: `${TOOL_ROOT}/client/tools/summarize.ts`, content: "a\n".repeat(120) }),
  payload("b1", "Bash", { type: "shell", command: "npm test", cwd: TOOL_ROOT, output: "Tests  281 passed (281)", exitCode: 0, durationMs: 1240 }),
  payload("b2", "Bash", { type: "shell", command: "npm run soak -- --duration 60", cwd: `${TOOL_ROOT}/tools/bench-provider`, output: "[ 0s] iter=00001 ok" }, "running"),
  payload("g1", "Bash", { type: "shell", command: "git push -u origin s3-tools", cwd: TOOL_ROOT, output: "", exitCode: 0, durationMs: 2300 }),
  payload("s1", "Grep", { type: "search", query: "useAgent", toolName: "grep", numFiles: 8, numMatches: 23 }),
  payload("f1", "WebFetch", { type: "fetch", url: "https://github.com/getpaseo/paseo/pull/125", code: 200, bytes: 12288, durationMs: 840 }),
  payload("m1", "mcp__devnav__codedb_search", { type: "unknown", input: { query: "PathText", limit: 5 }, output: "3 hits" }),
  payload("x1", "Read", { type: "read", filePath: `${TOOL_ROOT}/client/missing.ts` }, "failed", "ENOENT: no such file or directory, open 'client/missing.ts'"),
  payload("x2", "Bash", { type: "shell", command: "npm run check:hermes", cwd: TOOL_ROOT, output: "hermesc: error: invalid class syntax\n", exitCode: 1 }, "failed"),
  payload("t1", "Task", { type: "sub_agent", subAgentType: "explore", description: "Find every Breathe call site", log: "", actions: [{ index: 0, toolName: "Grep" }, { index: 1, toolName: "Read" }] }),
  payload("wt", "setup", {
    type: "worktree_setup",
    worktreePath: `${TOOL_ROOT}/../s3-tools`,
    branchName: "s3-tools",
    log: "",
    commands: [{ index: 0, command: "npm ci", cwd: TOOL_ROOT, log: "added 288 packages", status: "completed", exitCode: 0 }],
  }),
  payload("p1", "ExitPlanMode", { type: "plan", text: "## Ship tool callouts v2\n1. classify\n2. summarize" }),
  payload("n1", "status", { type: "plain_text", label: "Note", text: "The daemon restarted once." }),
  payload("u1", "frobnicate", { type: "unknown", input: { target: "cache", level: 2 }, output: { ok: true } }),
  payload("q1", "ask", { type: "unknown", input: { question: "Merge S3 now?", options: [{ label: "Yes" }, { label: "Later" }] }, output: "User selected: Yes" }),
];

const TOOLS_OPEN: ToolCallView[] = [
  payload("o1", "Bash", {
    type: "shell",
    command: "npm test -- tool",
    cwd: TOOL_ROOT,
    output: " ✓ test/unit/tool-classify.test.ts (29 tests)\n ✓ test/unit/tool-summarize.test.ts (36 tests)\n\n Tests  65 passed (65)",
    exitCode: 0,
    durationMs: 3100,
  }),
  payload("o2", "Grep", {
    type: "search",
    query: "useDisclosure",
    toolName: "grep",
    filePaths: [`${TOOL_ROOT}/client/live-renderers.tsx`, `${TOOL_ROOT}/client/state/disclosure-store.ts`, "/Users/me/code/beautiful-chat/client/ui/path-text.tsx"],
    numFiles: 3,
    numMatches: 7,
  }),
  payload("o3", "ask", { type: "unknown", input: { question: "Which default for tool details?", options: [{ label: "Collapse all" }, { label: "Expand failures" }], recommended: 0 }, output: "" }, "running"),
];

/** Long paths at phone width: the file name must survive every row. */
const TOOLS_NARROW: ToolCallView[] = [
  payload("n-r1", "Read", { type: "read", filePath: "/Users/dev/workspace/acme-chat/server/handlers/response-handler.ts", offset: 0, limit: 166 }),
  payload("n-r2", "Read", { type: "read", filePath: `${TOOL_ROOT}/client/components/markdown/render/table-block-renderer.tsx`, offset: 1, limit: 240 }),
  payload("n-r3", "Read", { type: "read", filePath: "/Users/me/code/beautiful-chat/docs/plans/2026-10-11-ui-ux-rendering-upgrade.md" }),
  payload("n-r4", "Read", { type: "read", filePath: "/Users/dev/workspace/acme-chat/client/lib/an-unreasonably-long-module-name-for-a-cursor-store.ts", limit: 112 }),
  payload("n-e1", "Edit", { type: "edit", filePath: `${TOOL_ROOT}/client/components/tool-callouts.tsx`, unifiedDiff: "@@ -1 +1 @@\n-a\n+b\n" }),
  payload("n-s1", "Grep", {
    type: "search",
    query: "useDisclosure",
    toolName: "grep",
    filePaths: [`${TOOL_ROOT}/client/state/disclosure-store.ts`, "/Users/dev/workspace/acme-chat/client/components/agent-stream/strategy-native.tsx"],
    numFiles: 2,
    numMatches: 4,
  }),
];

function ToolsNarrow({ tokens }: { tokens: ExtendedThemeTokens }) {
  const paths: PathContextValue = { roots: PATHS.roots, cwd: TOOL_ROOT, mode: "relative", reveal: () => {} };
  return (
    <PathContext.Provider value={paths}>
      <View>
        {TOOLS_NARROW.map((view) => (
          <ToolCallout key={view.callId} data={view} tokens={tokens} compact defaultExpanded={view.tool === "search"} />
        ))}
      </View>
    </PathContext.Provider>
  );
}

function ToolsV2({ tokens }: { tokens: ExtendedThemeTokens }) {
  const paths: PathContextValue = { roots: PATHS.roots, cwd: TOOL_ROOT, mode: "relative", reveal: () => {} };
  return (
    <PathContext.Provider value={paths}>
      <View style={{ gap: 0 }}>
        <Caption tokens={tokens}>Collapsed (default): one row per call, no frame</Caption>
        {TOOLS_COLLAPSED.map((view) => (
          <ToolCallout key={view.callId} data={view} tokens={tokens} />
        ))}
        <Caption tokens={tokens}>Expanded: bordered block, body mounted; ask open while waiting</Caption>
        <View style={{ gap: 6 }}>
          {TOOLS_OPEN.map((view) => (
            <ToolCallout key={view.callId} data={view} tokens={tokens} defaultExpanded />
          ))}
        </View>
      </View>
    </PathContext.Provider>
  );
}

function Primitives({ tokens }: { tokens: ExtendedThemeTokens }) {
  const muted = tokens.foregroundMuted;
  return (
    <PathContext.Provider value={PATHS}>
      <View style={{ gap: 4 }}>
        <Caption tokens={tokens}>DisclosureHeader — collapsed, running, failed, expanded with actions, compact</Caption>
        <DisclosureHeader
          expanded={false}
          onToggle={() => {}}
          tokens={tokens}
          icon={<Glyph name="FileText" size={14} color={muted} />}
          verb="Read"
          target={<PathText path="/Users/me/code/beautiful-chat/.worktrees/s1/client/ui/disclosure-header.tsx:10" tokens={tokens} copyOnHover={false} />}
          meta={["L10–80"]}
        />
        <DisclosureHeader
          expanded={false}
          onToggle={() => {}}
          tokens={tokens}
          icon={<RunningDot color={tokens.accent} />}
          verb="Bash"
          target="npm run typecheck && npm test -- --reporter=verbose"
          meta={["2.1s"]}
        />
        <DisclosureHeader
          expanded={false}
          onToggle={() => {}}
          tokens={tokens}
          tone="danger"
          icon={<Glyph name="X" size={14} color={tokens.danger} />}
          verb="Edit"
          target={<PathText path="/Users/me/code/beautiful-chat/client/preferences.ts" tokens={tokens} copyOnHover={false} />}
          meta={["failed"]}
        />
        <View style={{ borderWidth: 1, borderColor: tokens.v2.border, borderRadius: tokens.v2.radius.card }}>
          <DisclosureHeader
            expanded
            onToggle={() => {}}
            tokens={tokens}
            icon={<Glyph name="Search" size={14} color={muted} />}
            verb="Search"
            target={'"useAgent"'}
            meta={["8 files", "23 matches"]}
            actionsAlwaysVisible
            actions={
              <>
                <CopyButton text="useAgent" tokens={tokens} />
                <ActionMenuTrigger open onPress={() => {}} tokens={tokens} />
              </>
            }
          />
          <ActionMenuList
            open
            onClose={() => {}}
            tokens={tokens}
            items={[
              { id: "query", label: "Copy query", icon: "Copy", onSelect: () => {} },
              { id: "files", label: "Copy file list", icon: "Files", onSelect: () => {} },
            ]}
          />
        </View>
        <DisclosureHeader
          expanded={false}
          onToggle={() => {}}
          tokens={tokens}
          compact
          icon={<Glyph name="Brain" size={14} color={muted} />}
          verb="Thought"
          target="4 steps"
          meta={["12s"]}
        />
        <Caption tokens={tokens}>PathText — workspace root, project root (secondary), outside, verbatim, compact budget</Caption>
        <PathText path="/Users/me/code/beautiful-chat/.worktrees/s1/client/paths/format-path.ts:42" tokens={tokens} />
        <PathText path="/Users/me/code/beautiful-chat/client/live-renderers.tsx#L388" tokens={tokens} />
        <PathText path="/etc/hosts" tokens={tokens} />
        <PathText path="./client/ui/path-text.tsx" tokens={tokens} verbatim />
        <PathText
          path="/Users/me/code/beautiful-chat/.worktrees/s1/packages/app/src/components/agent-stream/strategy-native.tsx"
          tokens={tokens}
          compact
        />
        <Caption tokens={tokens}>CopyButton — icon, labelled · RunningDot</Caption>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <CopyButton text="copied text" tokens={tokens} />
          <CopyButton text="copied text" tokens={tokens} showLabel />
          <RunningDot color={tokens.accent} />
          <Text style={{ color: muted, fontFamily: tokens.fontMono, fontSize: 12 }}>
            mono: {tokens.typography.mono.size}/{tokens.typography.mono.lineHeight} 中文 fallback
          </Text>
        </View>
      </View>
    </PathContext.Provider>
  );
}

function Showcase() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, backgroundColor: "#000" }}>
      <Shot id="shot-hero">
        <Hero />
      </Shot>
      <Shot id="shot-thread">
        <Thread />
      </Shot>
      <Shot id="shot-tool-bash">
        <ToolCallout data={bash} tokens={tokens} defaultExpanded />
        <ToolCallout data={git} tokens={tokens} defaultExpanded />
      </Shot>
      <Shot id="shot-tool-read">
        <ToolCallout data={read} tokens={tokens} onRevealPath={() => {}} defaultExpanded />
      </Shot>
      <Shot id="shot-tool-image">
        <ToolCallout
          data={readImage}
          tokens={tokens}
          onRevealPath={() => {}}
          imageFile={sampleImage}
          defaultExpanded
        />
      </Shot>
      <Shot id="shot-tool-github">
        {githubCalls.map((call) => (
          <ToolCallout key={call.id} data={call} tokens={tokens} defaultExpanded />
        ))}
      </Shot>
      <Shot id="shot-tool-edit">
        <ToolCallout data={edit} tokens={tokens} onRevealPath={() => {}} defaultExpanded />
      </Shot>
      <Shot id="shot-tool-thinking">
        <ToolCallout data={thinking} tokens={tokens} defaultExpanded />
      </Shot>
      <Shot id="shot-tool-mcp">
        <ToolCallout data={mcp} tokens={tokens} defaultExpanded />
      </Shot>
      <Shot id="shot-tool-eval">
        <ToolCallout data={evalCall} tokens={tokens} defaultExpanded />
      </Shot>
      <Shot id="shot-tool-ask">
        <ToolCallout data={ask} tokens={tokens} defaultExpanded />
      </Shot>
      <Shot id="shot-tool-task">
        <ToolCallout data={task} tokens={tokens} defaultExpanded />
      </Shot>
      <Shot id="shot-hub">
        <HubCallout data={hubStart} tokens={tokens} />
        <HubCallout data={hubPs} tokens={tokens} />
        <HubCallout data={hubMessage} tokens={tokens} />
        <HubCallout data={hubWait} tokens={tokens} />
        <HubCallout data={hubPeers} tokens={tokens} />
      </Shot>
      <Shot id="shot-notice">
        <NoticeCallout
          data={{ id: "n1", level: "info", message: "Background task ShotBuilder completed." }}
          tokens={tokens}
        />
        <NoticeCallout
          data={{
            id: "n2",
            level: "info",
            message:
              "xd://: mounted mcp__better_icons_get_icon, mcp__better_icons_search_icons, mcp__devnav_codedb_search, mcp__devnav_codedb_symbol, mcp__devnav_webclaw_read, mcp__linkml_mcp_execute",
          }}
          tokens={tokens}
        />
        <NoticeCallout
          data={{ id: "n3", level: "warning", message: "The daemon restarted twice in 30s." }}
          tokens={tokens}
        />
        <NoticeCallout
          data={{ id: "n4", level: "error", message: "Provider quota exhausted.", fatal: true }}
          tokens={tokens}
        />
      </Shot>
      <Shot id="shot-paseo">
        <ToolCallout
          data={{ id: "paseo", tool: "paseo", title: "Paseo: create_agent", status: "completed", paseo: paseoTool }}
          tokens={tokens}
          defaultExpanded
        />
      </Shot>
      <Shot id="shot-reasoning">
        <ReasoningTrace data={reasoning} tokens={tokens} defaultExpanded />
      </Shot>
      <Shot id="shot-tasks">
        <TaskList data={tasks} tokens={tokens} />
      </Shot>
      <Shot id="shot-approval">
        <ApprovalCard request={approval} tokens={tokens} />
      </Shot>
      <Shot id="shot-user">
        <UserMessage
          text="Open the file explorer from a tool call, and keep the prompt bubble on theme."
          timestamp={new Date("2026-09-14T10:24:29Z")}
          tokens={tokens}
          usage={{ inputTokens: 90100, cachedInputTokens: 1600000, outputTokens: 4700 }}
        />
      </Shot>
      <Shot id="shot-syntax">
        <SyntaxHighlightBlock
          code={`export const revealPathRpc = defineRpc({\n  name: "file.reveal",\n  input: z.object({ cwd: z.string(), path: z.string() }),\n  output: z.object({ revealed: z.string().nullable(), error: z.string().nullable() }),\n});`}
          language="typescript"
          filename="shared/file-rpc.ts"
          tokens={tokens}
          showLineNumbers
          onRevealFile={() => {}}
        />
      </Shot>
      <Shot id="shot-reasoning-dark" width={720}>
        <ReasoningStates tokens={v2Dark} />
      </Shot>
      <Shot id="shot-reasoning-light" width={720} background={LIGHT.surface0}>
        <ReasoningStates tokens={v2Light} />
      </Shot>
      <Shot id="shot-tools-v2-dark" width={720}>
        <ToolsV2 tokens={v2Dark} />
      </Shot>
      <Shot id="shot-tools-v2-light" width={720} background={LIGHT.surface0}>
        <ToolsV2 tokens={v2Light} />
      </Shot>
      <Shot id="shot-tools-narrow-dark" width={380}>
        <ToolsNarrow tokens={v2Dark} />
      </Shot>
      <Shot id="shot-tools-narrow-light" width={380} background={LIGHT.surface0}>
        <ToolsNarrow tokens={v2Light} />
      </Shot>
      <Shot id="shot-tools-wide-dark" width={1100}>
        <ToolsNarrow tokens={v2Dark} />
      </Shot>
      <Shot id="shot-primitives-dark" width={640}>
        <Primitives tokens={v2Dark} />
      </Shot>
      <Shot id="shot-primitives-light" width={640} background={LIGHT.surface0}>
        <Primitives tokens={v2Light} />
      </Shot>
      {MARKDOWN_VARIANTS.map((variant) => (
        <React.Fragment key={variant}>
          <Shot id={`shot-md-${variant}-dark`} width={720}>
            <MarkdownView text={MD_SAMPLER} tokens={v2Dark} variant={variant} />
          </Shot>
          <Shot id={`shot-md-${variant}-light`} width={720} background={LIGHT.surface0}>
            <MarkdownView text={MD_SAMPLER} tokens={v2Light} variant={variant} />
          </Shot>
        </React.Fragment>
      ))}
      <Shot id="shot-md-streaming" width={720}>
        <Text style={{ color: v2Dark.foregroundSubtle, fontSize: 11, fontFamily: v2Dark.fontUi }}>
          streaming, cut inside the table header and inside the code fence
        </Text>
        <MarkdownView
          text={MD_SAMPLER.slice(0, MD_SAMPLER.indexOf("| :---") + 3)}
          tokens={v2Dark}
          variant="document"
          streaming
        />
        <MarkdownView
          text={MD_SAMPLER.slice(0, MD_SAMPLER.indexOf("token.raw);") + 4)}
          tokens={v2Dark}
          variant="compact"
          streaming
        />
        <Text style={{ color: v2Dark.foregroundSubtle, fontSize: 11, fontFamily: v2Dark.fontUi }}>
          compact, collapseCode (reasoning)
        </Text>
        <MarkdownView text={REPLY} tokens={v2Dark} variant="compact" collapseCode />
      </Shot>
      <Shot id="shot-settings" width={760}>
        <View style={{ height: 880 }}>
          <BeautifulChatSettingsPage
            theme={{ colors: BASE }}
            host={{ id: "local", label: "Local" }}
            layout={{ compact: false, platform: "web" }}
          />
        </View>
      </Shot>
    </div>
  );
}

embedFonts();
installFrostedGlass();
installPointerGlow();

console.log("showcase: bundle evaluated");
const mount = document.getElementById("root");
if (!mount) console.error("showcase: no root");
if (mount) {
  try {
    createRoot(mount).render(<Showcase />);
    console.log("showcase: render called");
  } catch (error) {
    console.error("showcase: render threw", error);
  }
}
