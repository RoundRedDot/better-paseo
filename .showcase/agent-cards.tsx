/**
 * Every agent-related card the plugin draws, built from host-shaped payloads
 * through the real classifier: rows, opened cards, hover previews, and the
 * relayed-message system card. Used for before/after design reviews.
 */
import React from "react";
import { Text, View } from "react-native";
import { ToolCallout, ToolPreviewContent } from "../client/components/tool-callouts";
import { SystemCard } from "../client/components/system-card";
import { PreviewPanelSample } from "../client/ui/hover-preview";
import { classifyTool, type ToolCallView } from "../client/tools/classify";
import { parseSystemEnvelope } from "../client/system-envelope";
import type { AgentMessage } from "../client/tools/agent-message";
import type { ExtendedThemeTokens } from "../client/components/theme-tokens";

const REVIEWER = "58821f29-ede4-48c1-8bb2-60ed7057abca";
const BUILDER = "db43c484-e0ea-4ae2-94f9-6f5261234567";

const RESPONSE = `Result: completed. Done-lane cards now draw the "已手动停止" reason, and all checks pass.

Commit: \`3506176 fix(tasks): draw the stop reason on done-lane cards too\` on \`feat/tasks-cards\`.

**Change** (\`client/tasks/cards/task-card.tsx:228\`): the reason block now draws for review and done lanes. Colours are unchanged:
- a card that isn't failed gets the grey Square and grey text;
- a failed card keeps the red CircleX and red text.

**Tests** (\`test/unit/tasks-cards.test.ts\`, 2 new):
- A manual-stop reason on a review/unread card and on a done card is grey (\`#6b6b75\`), with Square and no CircleX.
- A running card that has an \`error\` set draws no reason.
- The existing red failure test still passes.

**One thing worth knowing:** my first wording put "已手动停止" inside a code comment, and \`check:hermes\` failed. It rejects any non-ASCII character in the bundle, comments included.

**Validation:**
- \`npx tsc --noEmit\`: clean.
- \`npx vitest run test/unit/tasks-*.test.ts\`: 147 passed.
- Full \`npx vitest run\`: 130 files, 2445 passed, 0 failed.`;

function message(event: AgentMessage["event"], verb: string, body: string, id = REVIEWER, title = "tasks B: cards and status icons"): ToolCallView {
  const text = event === "message" ? body : `Agent ${id} (${title}) ${verb}.\n\n<agent-response>\n${body}\n</agent-response>`;
  return classifyTool({ name: "agent_message", callId: `msg-${event}`, status: "completed",
    detail: { type: "plain_text", text }, agentMessage: { event, sender: { id, title }, text } });
}

function paseo(name: string, input: Record<string, unknown>, output: unknown, status = "completed", error?: string): ToolCallView {
  return classifyTool({ name: `mcp__paseo__${name}`, callId: `${name}-${status}`, status, error,
    detail: { type: "unknown", input, output } });
}

export const AGENT_CREATE = paseo("create_agent", {
  title: "Screenshot builder", provider: "claude", initialPrompt:
    "Capture every agent card in light and dark.\n\n- Use `.showcase/tools/shots.mjs`\n- Keep the PNGs out of git",
  settings: { model: "claude-opus-5", thinkingOptionId: "high", modeId: "acceptEdits" },
}, { agentId: BUILDER, status: "running" });
export const AGENT_CREATE_FAILED = paseo("create_agent", {
  title: "Grok reviewer", provider: "grok", initialPrompt: "Review the diff.",
}, null, "failed", "Unknown model grok-5. Available: grok-4, grok-4-fast. No agent was created.");
export const AGENT_SEND = paseo("send_agent_prompt", {
  agentId: REVIEWER, prompt: "Rebase onto `feat/tasks-integration` and rerun **check:hermes** before you commit.",
}, { content: [], structuredContent: { success: true, disposition: "turn_started", status: "running",
  guidance: "Wait for the finish notification; do not poll." } });
export const AGENT_FINISHED = message("finished", "finished", RESPONSE);
export const AGENT_ERRORED = message("errored", "errored", "Provider unavailable: 529 overloaded.");
export const AGENT_PERMISSION = classifyTool((() => {
  const text = `Agent ${BUILDER} (Screenshot builder) needs permission.\n\nRespond with \`respond_to_permission\` using the \`agentId\` and \`requestId\` below.\n\n<permission-request>\n${JSON.stringify({
    agentId: BUILDER, requestId: "perm-7", request: { id: "perm-7", name: "Bash", title: "Bash",
      description: "Clear the old screenshots, then capture every agent card again.",
      input: { command: "rm -rf .showcase/out && node .showcase/tools/shots.mjs" } } }, null, 2)}\n</permission-request>`;
  return { name: "agent_message", callId: "msg-permission", status: "completed", detail: { type: "plain_text", text },
    agentMessage: { event: "permission-required" as const, sender: { id: BUILDER, title: "Screenshot builder" }, text } };
})());
const ASKER = "8308fd05-7a1e-4c2b-9d3f-1b2c3d4e5f60";
function permissionMessage(id: string, title: string, callId: string, request: Record<string, unknown>, response = ""): ToolCallView {
  const text = `Agent ${id} (${title}) needs permission.\n\nRespond with \`respond_to_permission\` using the \`agentId\` and \`requestId\` below.\n\n<permission-request>\n${
    JSON.stringify({ agentId: id, requestId: request.id, request }, null, 2)}\n</permission-request>${response ? `\n\n<agent-response>\n${response}\n</agent-response>` : ""}`;
  return classifyTool({ name: "agent_message", callId, status: "completed", detail: { type: "plain_text", text },
    agentMessage: { event: "permission-required" as const, sender: { id, title }, text } });
}
/** Codex's async question, as the iOS report showed it: one question, two options, a free-text answer. */
export const AGENT_QUESTION = permissionMessage(ASKER, "整理 Android develop 对齐 iOS 2.0.6 的设置改动", "msg-question", {
  id: "permission-call_4c3390c78d9e40b8877eb4c8eaf0a65d", provider: "codex", name: "request_user_input_async", kind: "question",
  title: "Question", input: { questions: [{ id: "0", header: "Question 1", isOther: true,
    question: "仓库 AGENTS.md 要求多文件任务先确认计划。拟分 6 组实施并分批提交：设置常规 / AI 专题与文案；连接应用和 MCP；联系人分组、关联记录与校验；语音词库独立页、加权长度、服务端确认与去重；技能和定时任务页面；全局网络 Toast 去重及头像资源。新增字符串放 `strings_align206_settings.xml` 的 8 个语言目录；不改 Room schema、`NoteDrawerUI.kt` 或主路由；完成后合并 `feat/align-ios-2.0.6` 并按简报在 Mac Studio 验证。按此计划实施？",
    options: [{ label: "按此计划实施" }, { label: "调整计划", description: "先说明要改哪几组，再开始" }] }] },
});
export const AGENT_QUESTIONS = permissionMessage(ASKER, "Release checklist", "msg-questions", {
  id: "permission-call_2", provider: "codex", name: "request_user_input_async", kind: "question", title: "Question",
  input: { questions: [
    { id: "0", header: "Question 1", question: "Which branch should the release cut from?", options: [{ label: "main" }, { label: "release/2.0" }], isOther: true },
    { id: "1", header: "Question 2", question: "Which checks must pass first?", multiSelect: true,
      options: [{ label: "tsc", description: "Type check every package" }, { label: "vitest" }, { label: "check:hermes" }] },
  ] },
});
export const AGENT_PLAN = permissionMessage(BUILDER, "Screenshot builder", "msg-plan", {
  id: "permission-plan-1", provider: "claude", name: "ExitPlanMode", kind: "plan", title: "Plan",
  input: { plan: "## Recapture the agent cards\n\n1. Clear `.showcase/out`\n2. Run `shots.mjs` in dark and light\n3. Compare against the baseline" },
  actions: [{ id: "reject", label: "Keep planning", behavior: "deny" }, { id: "implement", label: "Implement", behavior: "allow", variant: "primary" }],
});
export const AGENT_CLOSED = message("closed", "was closed", "");
export const AGENT_MESSAGE = message("message", "", "Can you confirm the base branch is `feat/tasks-integration`?");
export const AGENT_STATUS_OP = paseo("get_agent_status", { agentId: REVIEWER }, { status: "running", snapshot: {
  title: "tasks B: cards and status icons", provider: "codex", model: "gpt-6", cwd: "/Users/me/code/better-paseo/.worktrees/tasks-cards",
  currentModeId: "auto" } });
export const AGENT_LIST = paseo("list_agents", {}, { agents: [
  { id: REVIEWER, title: "tasks B: cards and status icons", status: "running", provider: "codex", cwd: "/Users/me/code/better-paseo/.worktrees/tasks-cards" },
  { id: BUILDER, title: "Screenshot builder", status: "idle", provider: "claude", cwd: "/Users/me/code/better-paseo" },
] });
export const AGENT_PERMISSIONS = paseo("list_pending_permissions", {}, { permissions: [
  { agentId: REVIEWER, status: "pending", request: { id: "perm-7", title: "Bash", description: "`git push origin feat/tasks-cards`" } },
] });
export const AGENT_ACTIVITY = paseo("get_agent_activity", { agentId: REVIEWER }, { agentId: REVIEWER, updateCount: 3,
  content: "## Activity\n\n- Read `client/tasks/cards/task-card.tsx`\n- Edited 1 file (+4 −1)\n- Ran `npx vitest run`: 147 passed" });
export const AGENT_CANCEL = paseo("cancel_agent", { agentId: REVIEWER }, { success: true });
export const AGENT_KILL = paseo("kill_agent", { agentId: BUILDER }, { success: false });
export const AGENT_TASK = classifyTool({ name: "Task", callId: "task", status: "completed", detail: {
  type: "sub_agent", subAgentType: "Explore", description: "Find every Breathe call site",
  prompt: "Search `client/` for `Breathe` and list each call site with its file and line.",
  log: "Found 4 call sites.", actions: [{ index: 0, toolName: "Grep", summary: "Breathe in client/" }, { index: 1, toolName: "Read", summary: "client/ui/running-dot.tsx" }] } });

const IRC = parseSystemEnvelope("<irc>\nIncoming IRC message from agent `reviewer`:\nThe hermes check fails on `class` fields; can you take a look?\n</irc>");

export const AGENT_ROWS: ToolCallView[] = [AGENT_CREATE, AGENT_CREATE_FAILED, AGENT_SEND, AGENT_FINISHED, AGENT_ERRORED,
  AGENT_PERMISSION, AGENT_CLOSED, AGENT_MESSAGE, AGENT_STATUS_OP, AGENT_LIST, AGENT_PERMISSIONS, AGENT_ACTIVITY,
  AGENT_CANCEL, AGENT_KILL, AGENT_TASK];
const OPENED: ToolCallView[] = [AGENT_CREATE, AGENT_SEND, AGENT_FINISHED, AGENT_PERMISSION, AGENT_STATUS_OP, AGENT_LIST,
  AGENT_PERMISSIONS, AGENT_ACTIVITY, AGENT_TASK];

function Label({ tokens, children }: { tokens: ExtendedThemeTokens; children: string }) {
  return <Text style={{ color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: 11, marginTop: 10 }}>{children}</Text>;
}

/** Collapsed rows, one per card kind. */
export function AgentRows({ tokens }: { tokens: ExtendedThemeTokens }) {
  return <View style={{ gap: 0 }}>
    {AGENT_ROWS.map((view) => <ToolCallout key={view.callId} data={view} tokens={tokens} />)}
    {IRC ? <SystemCard envelope={IRC} tokens={tokens} /> : null}
  </View>;
}

/** Each kind opened inline, the way a click leaves it in the timeline. */
export function AgentOpened({ tokens, only }: { tokens: ExtendedThemeTokens; only?: ToolCallView[] }) {
  return <View style={{ gap: 6 }}>
    {(only ?? OPENED).map((view) => <View key={view.callId}>
      <Label tokens={tokens}>{view.name ?? view.tool}</Label>
      <ToolCallout data={view} tokens={tokens} defaultExpanded />
    </View>)}
  </View>;
}

export const PERMISSION_CARDS: ToolCallView[] = [AGENT_QUESTION, AGENT_QUESTIONS, AGENT_PERMISSION, AGENT_PLAN];

/** Hover previews: the floating panel's toolbar and body. */
export function AgentPreviews({ tokens, only }: { tokens: ExtendedThemeTokens; only?: ToolCallView[] }) {
  return <View style={{ gap: 16 }}>
    {(only ?? [AGENT_CREATE, AGENT_SEND, AGENT_FINISHED, AGENT_STATUS_OP]).map((view) => <View key={view.callId} style={{ height: 420 }}>
      <PreviewPanelSample tokens={tokens}>
        <ToolPreviewContent data={view} tokens={tokens} compact={false} resolvePath={(path) => path} />
      </PreviewPanelSample>
    </View>)}
  </View>;
}
