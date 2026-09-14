/**
 * Offline showcase used only to capture README screenshots.
 *
 * It mounts the plugin's presentational components against mock data and the
 * same theme tokens the host feeds them, so a capture shows the real component
 * rather than a drawing of one.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";

import { embedFonts } from "../client/components/embed-fonts";
import { installFrostedGlass } from "../client/components/frosted";
import { buildThemeTokens } from "../client/components/theme-tokens";
import { ToolCallout } from "../client/components/tool-callouts";
import { ReasoningTrace } from "../client/components/reasoning-trace";
import { TaskList } from "../client/components/task-list";
import { ApprovalCard } from "../client/components/approval-card";
import { UserMessage } from "../client/components/user-message";
import { HubCallout } from "../client/components/hub-callout";
import { PaseoToolCallout } from "../client/components/paseo-tool-callouts";
import { SyntaxHighlightBlock } from "../client/components/syntax-highlight";
import { BeautifulChatSettingsPage } from "../client/settings-page";
import { buildHubData } from "../client/live-renderers";
import type { ToolCalloutData } from "../shared/contracts";

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

const PREFERENCES = {
  accent: "host" as const,
  uiFont: "inter" as const,
  codeFont: "code" as const,
  frostedGlass: true,
  enhancedUserBubble: true,
};

const tokens = buildThemeTokens(DARK, PREFERENCES);

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
  title: "Subagent: ShotBuilder",
  status: "running",
  subagent: {
    name: "ShotBuilder",
    agentType: "task",
    model: "claude-opus-5",
    task: "Build the offline showcase page and capture one screenshot per component.",
    status: "running",
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
)!;

const hubStop = buildHubData(
  { op: "stop", name: "shots-server" },
  "Stopped shots-server: exited exit=1 uptime=8m20s restarts=0",
)!;

const hubMessage = buildHubData(
  { op: "send", to: "ShotBuilder", message: "Capture the dark theme first. Light theme after." },
  "delivered to ShotBuilder",
)!;

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
  children,
}: {
  id: string;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <div id={id} style={{ width, padding: 20, backgroundColor: DARK.surface0 }}>
      <View style={{ gap: 10 }}>{children}</View>
    </div>
  );
}

function Showcase() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, backgroundColor: "#000" }}>
      <Shot id="shot-tool-bash">
        <ToolCallout data={bash} tokens={tokens} />
        <ToolCallout data={git} tokens={tokens} />
      </Shot>
      <Shot id="shot-tool-read">
        <ToolCallout data={read} tokens={tokens} onRevealPath={() => {}} />
      </Shot>
      <Shot id="shot-tool-edit">
        <ToolCallout data={edit} tokens={tokens} onRevealPath={() => {}} />
      </Shot>
      <Shot id="shot-tool-thinking">
        <ToolCallout data={thinking} tokens={tokens} />
      </Shot>
      <Shot id="shot-tool-mcp">
        <ToolCallout data={mcp} tokens={tokens} />
      </Shot>
      <Shot id="shot-tool-eval">
        <ToolCallout data={evalCall} tokens={tokens} />
      </Shot>
      <Shot id="shot-tool-ask">
        <ToolCallout data={ask} tokens={tokens} />
      </Shot>
      <Shot id="shot-tool-task">
        <ToolCallout data={task} tokens={tokens} />
      </Shot>
      <Shot id="shot-hub">
        <HubCallout data={hubStart} tokens={tokens} />
        <HubCallout data={hubStop} tokens={tokens} />
        <HubCallout data={hubMessage} tokens={tokens} />
      </Shot>
      <Shot id="shot-paseo">
        <PaseoToolCallout data={paseoTool} tokens={tokens} />
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
      <Shot id="shot-settings" width={760}>
        <View style={{ height: 880 }}>
          <BeautifulChatSettingsPage
            theme={{ colors: DARK }}
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
