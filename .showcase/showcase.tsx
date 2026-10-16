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
import { EMBEDDED_FONTS } from "../server/font-data";
import { MARK_BITMAPS } from "../server/mark-bitmaps";
import { seedMarkBitmaps } from "../client/components/marks";
import { buildThemeTokens } from "../client/components/theme-tokens";
import { ToolCallout } from "../client/components/tool-callouts";
import { ReasoningCard, ReasoningTrace } from "../client/components/reasoning-trace";
import { reasoningText, segmentReasoning } from "../client/reasoning/segment";
import { TaskList } from "../client/components/task-list";
import { UserMessage } from "../client/components/user-message";
import { HubCallout } from "../client/components/hub-callout";
import { SyntaxHighlightBlock } from "../client/components/syntax-highlight";
import { BetterPaseoSettingsPage } from "../client/settings-page";
import { buildHubData } from "../client/hub-details";
import { NoticeCallout } from "../client/components/notice-callout";
import { SystemCard } from "../client/components/system-card";
import { AssistantFooter } from "../client/components/turn-footer";
import { MARKDOWN_VARIANTS, MarkdownView } from "../client/components/markdown/markdown-view";
import { parseSystemEnvelope } from "../client/system-envelope";
import { HERO_REPLY, MD_SAMPLER, REASONING_PROSE, REASONING_SECTIONS, REPLY } from "./markdown-corpus";
import type { ToolCalloutData } from "../shared/contracts";
import { DEFAULT_PREFERENCES, updateEnhancerPreferences } from "../client/preferences";
import type { ExtendedThemeTokens } from "../client/components/theme-tokens";
import { DisclosureHeader } from "../client/ui/disclosure-header";
import { CopyButton } from "../client/ui/copy-button";
import { PathContext, PathText, type PathContextValue } from "../client/ui/path-text";
import { RunningDot } from "../client/ui/running-dot";
import { Glyph } from "../client/components/glyph";
import { classifyTool, type ToolCallPayload, type ToolCallView } from "../client/tools/classify";
import { useSelectionActions } from "../client/components/selection-actions";
import { S7_GROUPS } from "./s7-groups";
import { pluginRoot } from "../client/components/focus-ring";
import { DEFAULT_WEB_MONO_STACK } from "../client/ui/tokens/typography";

// For `tools/shots.mjs`: a shot can switch a reader preference on while it is captured.
(globalThis as { setShowcasePreferences?: typeof updateEnhancerPreferences }).setShowcasePreferences =
  updateEnhancerPreferences;

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

// The shipped defaults, as a reader first sees them.
const tokens = buildThemeTokens(BASE, DEFAULT_PREFERENCES, { platform: "web" });

/**
 * `?layout=compact` draws the S7 groups in the touch layout: compact rows and
 * the native content size (16), passed the way a host with typography would.
 */
const COMPACT =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("layout") === "compact";
const s7Tokens = COMPACT
  ? buildThemeTokens(BASE, DEFAULT_PREFERENCES, {
      platform: "web",
      theme: { colors: BASE, typography: { fontSize: { content: 16 } } },
    })
  : tokens;

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
    cwd: "~/code/better-paseo",
    exitCode: 0,
    stdout: "> better-paseo@0.1.0 typecheck\n> tsc --noEmit\n\nChecked 34 files in 4.2s",
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
  lineRange: "150-157",
  offset: 150,
  limit: 8,
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
const readImageAgain: ToolCalloutData = { ...readImage, id: "read-image-again", title: "Read hero.png again" };

/** The image bytes normally arrive from the daemon; the offline scene uses an SVG file fixture. */
const sampleImageSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1175" height="1150" viewBox="0 0 1175 1150">
  <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#d9e8fa"/><stop offset="1" stop-color="#fff1d6"/></linearGradient></defs>
  <rect width="1175" height="1150" fill="url(#sky)"/>
  <circle cx="860" cy="290" r="118" fill="#f3b765"/>
  <path d="M0 690 250 390l174 208 191-299 330 392 110-137 120 137v459H0z" fill="#a7c7bb"/>
  <path d="m0 835 245-214 188 185 220-246 270 266 127-118 125 122v320H0z" fill="#628f80"/>
  <path d="M0 936c206-72 320-48 478 3s307 44 697-23v234H0z" fill="#477764"/>
</svg>`;
const sampleImage = {
  dataUri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleImageSvg)}`,
  width: 1175,
  height: 1150,
  bytes: new TextEncoder().encode(sampleImageSvg).length,
  error: null,
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
    title: "pr_create paseo-cafe/paseo-cafe Add better-paseo",
    status: "completed",
    durationMs: 2430,
    github: {
      op: "pr_create",
      repo: "paseo-cafe/paseo-cafe",
      subject: "Add better-paseo",
      request:
        '{"op":"pr_create","repo":"paseo-cafe/paseo-cafe","base":"main","head":"ABorakati:add-better-paseo","title":"Add better-paseo"}',
      rows: [
        { label: "pull request", value: "#125 Add better-paseo" },
        { label: "base", value: "main ← ABorakati:add-better-paseo" },
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
    initialPrompt: "Capture every component of the Better Paseo plugin.",
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
      title: "Rename plugin to Better Paseo",
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

const questionChoices = [
  {
    id: "target",
    header: "Target",
    question: "Which preview should the docs show?",
    options: [
      { label: "Code window", description: "Show the rendered Markdown and raw text toggle" },
      { label: "Checklist", description: "Show the live task panel" },
    ],
  },
  {
    id: "coverage",
    header: "Coverage",
    question: "Which compatibility note should stay visible?",
    options: [{ label: "Keep iOS device acceptance open" }],
    multiSelect: true,
  },
];

const questionChoiceCall: ToolCallView = classifyTool({
  name: "request_user_input_async",
  callId: "showcase-question-1",
  status: "completed",
  questionData: {
    status: "completed",
    questions: questionChoices,
    result: {
      answers: [
        { question: questionChoices[0]!.question, selectedOptions: ["Code window"] },
        { question: questionChoices[1]!.question, selectedOptions: ["Keep iOS device acceptance open"], customInput: "and list the Web evidence" },
      ],
    },
  },
});

const questionSummaryCall: ToolCallView = {
  ...classifyTool({
    name: "ask",
    callId: "showcase-question-2",
    status: "completed",
    detail: { type: "plain_text", label: "ask" },
    questionData: {
      status: "completed",
      questions: [{
        header: "Locale",
        question: "Which screenshot locale?",
        options: [{ label: "en-US" }, { label: "zh-CN" }],
      }],
    },
  }),
  output: `User has answered your questions: "Which screenshot locale?"="en-US". You can now continue with these answers in mind.`,
};

const TABLE_SHOT = [
  "### Weekly rollout",
  "",
  "| Feature | State | Notes |",
  "| --- | --- | --- |",
  "| Code preview | Ready | Rendered / raw toggle |",
  "| Cell selection | Ready | Copy or add to chat |",
  "| Checklist | Live | Follows the newest list |",
].join("\n");

const CODE_PREVIEW_SHOT = [
  "# Preview controls",
  "",
  "The window keeps Markdown readable while the original reply stays compact.",
  "",
  "## What changes",
  "",
  "- Render headings, tables, lists and links in the window.",
  "- Switch to the source when you need to copy the Markdown.",
  "- Keep long lines wrapped in raw text when the preference is on.",
  "",
  "| View | Use it for |",
  "| --- | --- |",
  "| Rendered | Reading a long reply |",
  "| Raw text | Copying the original source |",
  "",
  "> The reply remains compact while the window is open.",
].join("\n");
const CODE_PREVIEW_SHOT_SOURCE = "```md\n" + CODE_PREVIEW_SHOT + "\n```";

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
      <View {...pluginRoot} style={{ gap: 10 }}>{children}</View>
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
      <TaskList data={tasks} tokens={tokens} />
      <HubCallout data={hubWait} tokens={tokens} />
      {envelope ? <SystemCard envelope={envelope} tokens={tokens} /> : null}
      <NoticeCallout
        data={{ id: "n1", level: "warning", message: "The daemon restarted twice in 30s." }}
        tokens={tokens}
      />
      <View>
        <MarkdownView text={REPLY} tokens={tokens} variant="document" />
        <AssistantFooter text={REPLY} at={new Date("2026-09-15T22:47:12Z")} agentName="claude"
          modelName="Grok 4" thinkingLabel="High" durationMs={12_400} tokens={tokens} />
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
        <AssistantFooter text={HERO_REPLY} at={new Date("2026-09-15T22:47:12Z")} agentName="claude"
          modelName="Grok 4" thinkingLabel="High" durationMs={12_400} tokens={tokens} />
      </View>
    </View>
  );
}


/**
 * The README hero: the same plugin cards in a desktop window and on a phone,
 * framed the way a device capture would show them. The chrome around the
 * timeline is a plain drawing; everything inside the column is the real
 * component, the phone on the iOS tokens the settings preview uses.
 */
const iosTokens = (() => {
  const ios = buildThemeTokens(BASE, DEFAULT_PREFERENCES, { platform: "ios" });
  return { ...ios, fontMono: `${ios.fontMono}, ${DEFAULT_WEB_MONO_STACK}` };
})();
const UI_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";

function Composer({ radius = 14 }: { radius?: number }) {
  return (
    <div
      style={{
        border: `1px solid ${BASE.border}`,
        borderRadius: radius,
        backgroundColor: BASE.surface1,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily: UI_FONT,
        fontSize: 14,
        color: BASE.foregroundMuted,
      }}
    >
      <span>Message the agent...</span>
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: BASE.foreground,
          color: BASE.surface0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
        }}
      >
        &#8593;
      </span>
    </div>
  );
}

function SidebarRow({ label, active, dot }: { label: string; active?: boolean; dot?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 7,
        backgroundColor: active ? BASE.surface2 : "transparent",
        color: active ? BASE.foreground : BASE.foregroundMuted,
        fontFamily: UI_FONT,
        fontSize: 13,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot ?? "transparent" }} />
      {label}
    </div>
  );
}

function DesktopTimeline() {
  const envelope = parseSystemEnvelope(JOB_NOTICE);
  const t = tokens;
  return (
    <View {...pluginRoot} style={{ gap: 10 }}>
      <UserMessage
        text="I can't click on URLs in the assistant responses."
        timestamp={new Date("2026-09-15T22:41:00Z")}
        tokens={t}
        usage={{ inputTokens: 270, cachedInputTokens: 36211627, outputTokens: 62024 }}
      />
      <ReasoningTrace data={reasoning} tokens={t} />
      <ToolCallout data={bash} tokens={t} />
      <ToolCallout data={read} tokens={t} onRevealPath={() => {}} />
      <ToolCallout data={edit} tokens={t} onRevealPath={() => {}} defaultExpanded />
      <ToolCallout data={mcp} tokens={t} />
      <TaskList data={tasks} tokens={t} />
      {envelope ? <SystemCard envelope={envelope} tokens={t} /> : null}
      <View>
        <MarkdownView text={HERO_REPLY} tokens={t} variant="document" />
        <AssistantFooter text={HERO_REPLY} at={new Date("2026-09-15T22:47:12Z")} agentName="claude"
          modelName="Grok 4" thinkingLabel="High" durationMs={12_400} tokens={t} />
      </View>
    </View>
  );
}

function DesktopWindow() {
  return (
    <div
      style={{
        width: 1240,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${THEME === "light" ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.14)"}`,
        boxShadow: "0 30px 80px rgba(0,0,0,0.28), 0 6px 18px rgba(0,0,0,0.14)",
        backgroundColor: BASE.surface0,
      }}
    >
      <div style={{ display: "flex", height: 1200 }}>
        <div
          style={{
            width: 232,
            flexShrink: 0,
            backgroundColor: BASE.surface1,
            borderRight: `1px solid ${BASE.border}`,
            padding: "14px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <div style={{ display: "flex", gap: 8, padding: "2px 6px 18px" }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <span key={c} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c }} />
            ))}
          </div>
          <div style={{ fontFamily: UI_FONT, fontSize: 11, fontWeight: 600, color: BASE.foregroundMuted, padding: "4px 10px" }}>
            better-paseo
          </div>
          <SidebarRow label="Clickable links" active dot={BASE.statusSuccess} />
          <SidebarRow label="Table copy menu" dot={BASE.accent} />
          <SidebarRow label="Replay benchmark" />
          <div style={{ fontFamily: UI_FONT, fontSize: 11, fontWeight: 600, color: BASE.foregroundMuted, padding: "16px 10px 4px" }}>
            paseo
          </div>
          <SidebarRow label="Plugin SDK docs" />
          <SidebarRow label="Relay reconnect" dot={BASE.statusWarning} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            style={{
              height: 46,
              flexShrink: 0,
              borderBottom: `1px solid ${BASE.border}`,
              display: "flex",
              alignItems: "center",
              padding: "0 20px",
              gap: 10,
              fontFamily: UI_FONT,
              fontSize: 13,
              color: BASE.foreground,
            }}
          >
            <span style={{ fontWeight: 600 }}>Clickable links</span>
            <span style={{ color: BASE.foregroundMuted }}>Claude Code</span>
          </div>
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", justifyContent: "center" }}>
              <div style={{ width: 760, padding: "0 20px 16px" }}>
                <DesktopTimeline />
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", padding: "0 20px 18px" }}>
            <div style={{ width: 720 }}>
              <Composer />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneTimeline() {
  const t = iosTokens;
  return (
    <View {...pluginRoot} style={{ gap: 10 }}>
      <UserMessage
        text="Ship the GitHub check before the merge."
        timestamp={new Date("2026-09-15T22:51:00Z")}
        tokens={t}
        usage={{ inputTokens: 410, cachedInputTokens: 1200000, outputTokens: 8200 }}
      />
      <ToolCallout data={git} tokens={t} defaultExpanded />
      {githubCalls.slice(0, 2).map((call) => (
        <ToolCallout key={call.id} data={call} tokens={t} />
      ))}
      <ToolCallout
        data={{ id: "paseo", tool: "paseo", title: "Paseo: create_agent", status: "completed", paseo: paseoTool }}
        tokens={t}
        defaultExpanded
      />
      <TaskList data={tasks} tokens={t} />
      <HubCallout data={hubMessage} tokens={t} />
      <View>
        <MarkdownView text={MOBILE_REPLY} tokens={t} variant="document" />
        <AssistantFooter text={MOBILE_REPLY} at={new Date("2026-09-15T22:58:40Z")} agentName="claude"
          modelName="Grok 4" thinkingLabel="High" durationMs={12_400} tokens={t} />
      </View>
    </View>
  );
}

const MOBILE_REPLY = `Checks are green and the reviewer agent is on it.

| Check | Result |
| --- | --- |
| typecheck | pass |
| vitest | 412 passed |`;

function Phone() {
  const W = 390;
  const H = 844;
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 64,
        backgroundColor: "#1b1b1f",
        boxShadow: "0 30px 80px rgba(0,0,0,0.35), inset 0 0 0 2px #3a3a40",
      }}
    >
      <div
        style={{
          width: W,
          height: H,
          borderRadius: 52,
          overflow: "hidden",
          backgroundColor: BASE.surface0,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 11,
            left: (W - 124) / 2,
            width: 124,
            height: 36,
            borderRadius: 18,
            backgroundColor: "#000",
            zIndex: 2,
          }}
        />
        <div
          style={{
            height: 54,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 34px 0 44px",
            fontFamily: UI_FONT,
            fontSize: 16,
            fontWeight: 600,
            color: BASE.foreground,
          }}
        >
          <span>9:41</span>
          <span style={{ fontSize: 13, letterSpacing: 1 }}>&#9679;&#9679;&#9679; 100%</span>
        </div>
        <div
          style={{
            height: 44,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            gap: 12,
            borderBottom: `1px solid ${BASE.border}`,
            fontFamily: UI_FONT,
            color: BASE.foreground,
          }}
        >
          <span style={{ fontSize: 24, color: BASE.accent, lineHeight: "24px" }}>&#8249;</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>GitHub check</span>
          <span style={{ fontSize: 13, color: BASE.foregroundMuted }}>Codex</span>
        </div>
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "0 14px 12px" }}>
            <PhoneTimeline />
          </div>
        </div>
        <div style={{ padding: "0 12px 34px", flexShrink: 0 }}>
          <Composer radius={22} />
        </div>
      </div>
    </div>
  );
}

function HeroDevices() {
  return (
    <div
      id="shot-hero-devices"
      style={{
        width: 1860,
        padding: "56px 60px",
        background:
          THEME === "light"
            ? "linear-gradient(135deg, #e9eefc 0%, #f4f1fb 50%, #eaf6f1 100%)"
            : "linear-gradient(135deg, #161a2b 0%, #1d1726 50%, #12211c 100%)",
        display: "flex",
        alignItems: "flex-end",
        gap: 40,
        boxSizing: "border-box",
      }}
    >
      <div id="shot-hero-desktop" style={{ padding: 0 }}>
        <DesktopWindow />
      </div>
      <div id="shot-hero-mobile">
        <Phone />
      </div>
    </div>
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
    { path: "/Users/me/code/better-paseo/.worktrees/s1" },
    { path: "/Users/me/code/better-paseo", label: "better-paseo" },
  ],
  cwd: "/Users/me/code/better-paseo/.worktrees/s1",
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
const TOOL_ROOT = "/Users/me/code/better-paseo/.worktrees/s1";

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
  payload("r3", "Read", { type: "read", filePath: "/Users/me/code/better-paseo/docs/plans/2026-10-11-ui-ux-rendering-upgrade.md", offset: 263, limit: 41 }),
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
    filePaths: [`${TOOL_ROOT}/client/live-renderers.tsx`, `${TOOL_ROOT}/client/state/disclosure-store.ts`, "/Users/me/code/better-paseo/client/ui/path-text.tsx"],
    numFiles: 3,
    numMatches: 7,
  }),
];

/** Long paths at phone width: the file name must survive every row. */
const TOOLS_NARROW: ToolCallView[] = [
  payload("n-r1", "Read", { type: "read", filePath: "/Users/dev/workspace/acme-chat/server/handlers/response-handler.ts", offset: 0, limit: 166 }),
  payload("n-r2", "Read", { type: "read", filePath: `${TOOL_ROOT}/client/components/markdown/render/table-block-renderer.tsx`, offset: 1, limit: 240 }),
  payload("n-r3", "Read", { type: "read", filePath: "/Users/me/code/better-paseo/docs/plans/2026-10-11-ui-ux-rendering-upgrade.md" }),
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
        <Caption tokens={tokens}>Expanded: bordered block, body mounted</Caption>
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
          target={<PathText path="/Users/me/code/better-paseo/.worktrees/s1/client/ui/disclosure-header.tsx:10" tokens={tokens} copyOnHover={false} />}
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
          target={<PathText path="/Users/me/code/better-paseo/client/preferences.ts" tokens={tokens} copyOnHover={false} />}
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
            actions={<CopyButton text="useAgent" tokens={tokens} />}
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
        <PathText path="/Users/me/code/better-paseo/.worktrees/s1/client/paths/format-path.ts:42" tokens={tokens} />
        <PathText path="/Users/me/code/better-paseo/client/live-renderers.tsx#L388" tokens={tokens} />
        <PathText path="/etc/hosts" tokens={tokens} />
        <PathText path="./client/ui/path-text.tsx" tokens={tokens} verbatim />
        <PathText
          path="/Users/me/code/better-paseo/.worktrees/s1/packages/app/src/components/agent-stream/strategy-native.tsx"
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
    <div data-showcase-scenes style={{ display: "flex", flexDirection: "column", gap: 24, backgroundColor: "#000" }}>
      <HeroDevices />
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
      <Shot id="shot-shared-image-cards">
        <ToolCallout data={readImage} tokens={tokens} onRevealPath={() => {}} imageFile={sampleImage} defaultExpanded />
        <ToolCallout data={readImageAgain} tokens={tokens} onRevealPath={() => {}} imageFile={sampleImage} defaultExpanded />
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
      <Shot id="shot-checklist-window" width={1000}>
        <TaskList data={tasks} tokens={tokens} />
      </Shot>
      <Shot id="shot-questions" width={1000}>
        <ToolCallout data={questionChoiceCall} tokens={tokens} defaultExpanded />
        <ToolCallout data={questionSummaryCall} tokens={tokens} defaultExpanded />
      </Shot>
      <Shot id="shot-table-copy-menu">
        <MarkdownView text={TABLE_SHOT} tokens={tokens} variant="document" />
      </Shot>
      <Shot id="shot-table-selection">
        <MarkdownView text={TABLE_SHOT} tokens={tokens} variant="document" />
      </Shot>
      <Shot id="shot-selection-actions">
        <SelectionActionsSample />
      </Shot>
      <div data-window-content style={{ width: 1280, height: 560, overflow: "hidden", backgroundColor: BASE.surface0 }}>
        <Shot id="shot-markdown-preview-window" width={1200}>
          <MarkdownView text={CODE_PREVIEW_SHOT_SOURCE} tokens={tokens} variant="document" />
        </Shot>
      </div>
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
      <div
        id="shot-markdown-styles"
        style={{ width: 2320, height: 880, padding: 20, boxSizing: "border-box", backgroundColor: BASE.surface0 }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 20 }}>
          {MARKDOWN_VARIANTS.map((variant) => (
            <View key={variant} style={{ gap: 10, minWidth: 0 }}>
              <Text style={{ color: BASE.foregroundMuted, fontFamily: tokens.fontUi, fontSize: 14, fontWeight: "600" }}>
                {variant === "document" ? "Document" : variant === "compact" ? "Compact" : "Terminal"}
              </Text>
              <MarkdownView text={MD_SAMPLER} tokens={tokens} variant={variant} />
            </View>
          ))}
        </div>
      </div>
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
        <BetterPaseoSettingsPage
          theme={{ colors: BASE }}
          host={{ id: "local", label: "Local" }}
          layout={{ compact: false, platform: "web" }}
        />
      </Shot>
      {/* Paseo's settings pane: a scroller around `PageLayout`'s centred 720
          column, which the page lifts so the preview sits beside the options
          (docs/images/settings.png). */}
      <div id="shot-settings-wide" style={{ width: 1240, height: 890, overflow: "hidden", backgroundColor: BASE.surface0 }}>
        <div style={{ maxWidth: 720, width: "100%", margin: "0 auto", padding: 16, paddingTop: 8, boxSizing: "border-box" }}>
          <View {...pluginRoot}>
            <BetterPaseoSettingsPage
              theme={{ colors: BASE }}
              host={{ id: "local", label: "Local" }}
              layout={{ compact: false, platform: "web" }}
            />
          </View>
        </div>
      </div>
      <div id="shot-settings-block-size" style={{ width: 1240, height: 890, overflowY: "auto", backgroundColor: BASE.surface0 }}>
        <div style={{ maxWidth: 720, width: "100%", margin: "0 auto", padding: 16, paddingTop: 8, boxSizing: "border-box" }}>
          <View {...pluginRoot}>
            <BetterPaseoSettingsPage
              theme={{ colors: BASE }}
              host={{ id: "local", label: "Local" }}
              layout={{ compact: false, platform: "web" }}
            />
          </View>
        </div>
      </div>
      {S7_GROUPS.map((group) => (
        <Shot key={group.id} id={`shot-s7-${group.id}`}>
          {group.render(s7Tokens, COMPACT)}
        </Shot>
      ))}
      <Shot id="shot-s7-settings">
        <BetterPaseoSettingsPage
          theme={{ colors: BASE }}
          host={{ id: "local", label: "Local" }}
          layout={{ compact: COMPACT, platform: COMPACT ? "ios" : "web" }}
        />
      </Shot>
      <Shot id="shot-settings-native" width={420}>
        <BetterPaseoSettingsPage
          theme={{ colors: BASE }}
          host={{ id: "local", label: "Local" }}
          layout={{ compact: true, platform: "ios" }}
        />
      </Shot>
    </div>
  );
}

function SelectionActionsSample() {
  useSelectionActions(tokens, true);
  return (
    <UserMessage
      text="Selecting text in a card shows Copy and Add to chat. Add to chat quotes prose or fences code, then the bar closes on scroll."
      timestamp={new Date("2026-10-12T10:00:00Z")}
      tokens={tokens}
      usage={{ inputTokens: 1200, outputTokens: 96 }}
    />
  );
}

embedFonts(EMBEDDED_FONTS);
seedMarkBitmaps(MARK_BITMAPS);

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
