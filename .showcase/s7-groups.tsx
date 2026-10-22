/**
 * The S7 design's component groups (Direction A, design spec §3), drawn with
 * the real components and the mockups' own fixture text, so each capture can
 * sit beside its mockup board. `compact` is the touch layout (`?layout=compact`).
 */
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { ExtendedThemeTokens } from "../client/components/theme-tokens";
import { ToolCallout } from "../client/components/tool-callouts";
import { ToolRollup } from "../client/components/tool-rollup";
import { installToolRollupSpacing } from "../client/web";
import { ReasoningCard } from "../client/components/reasoning-trace";
import { TaskList } from "../client/components/task-list";
import { NoticeCallout } from "../client/components/notice-callout";
import { SystemCard } from "../client/components/system-card";
import { UserMessage } from "../client/components/user-message";
import { AssistantFooter } from "../client/components/turn-footer";
import { MarkdownView } from "../client/components/markdown/markdown-view";
import { SyntaxHighlightBlock } from "../client/components/syntax-highlight";
import { parseSystemEnvelope } from "../client/system-envelope";
import { segmentReasoning, reasoningText } from "../client/reasoning/segment";
import { PathContext, type PathContextValue } from "../client/ui/path-text";
import { classifyTool, type ToolCallPayload, type ToolCallView } from "../client/tools/classify";
import type { TaskListData } from "../shared/contracts";

const ROOT = "/Users/me/code/better-paseo";
const PATHS: PathContextValue = { roots: [{ path: ROOT }], cwd: ROOT, mode: "relative", reveal: () => {} };
const AT = new Date(2026, 8, 16, 6, 41);
const LATER = new Date(2026, 8, 16, 6, 47);

function call(id: string, name: string, detail: Record<string, unknown>, status = "completed", error: string | null = null): ToolCallView {
  const item: ToolCallPayload = { callId: id, name, status, detail, error };
  return classifyTool(item);
}

const DIFF = `@@ -40,8 +40,11 @@ export function splitBlocks
   const blocks: string[] = [];
-  for (const token of lex(text)) {
-    blocks.push(token.raw);
-  }
+  const frozen = cache.get(text.length);
+  for (const token of lex(text, frozen)) {
+    if (token.type === "space") continue;
+    blocks.push(token.raw);
+  }
+  cache.set(text.length, blocks);
   return blocks;`;

const SOAK = Array.from({ length: 216 }, (_, i) => `[soak] t=${i}s  frames=${i * 60}  dropped=${i > 210 ? 1 : 0}  heap=${(48 + i / 100).toFixed(1)}MB`).join("\n");

const TURN_TOOLS: ToolCallView[] = [
  call("t-r1", "Read", { type: "read", filePath: `${ROOT}/client/components/markdown/parse.ts`, offset: 1, limit: 120 }),
  call("t-s1", "Grep", { type: "search", query: "splitBlocks", toolName: "grep", numFiles: 4, numMatches: 9 }),
  call("t-r2", "Read", { type: "read", filePath: `${ROOT}/client/components/markdown/blocks.ts`, offset: 40, limit: 57 }),
  call("t-e1", "Edit", { type: "edit", filePath: `${ROOT}/client/components/markdown/blocks.ts`, unifiedDiff: DIFF }),
  call("t-b1", "Bash", { type: "shell", command: "npm run typecheck", cwd: ROOT, output: "", exitCode: 0, durationMs: 4300 }),
  call("t-r3", "Read", { type: "read", filePath: `${ROOT}/client/界面/设置.tsx`, offset: 1, limit: 42 }),
  call("t-e2", "Edit", { type: "edit", filePath: `${ROOT}/client/components/user-message.tsx`, unifiedDiff: "@@ -1,3 +1,5 @@\n-a\n-b\n+a\n+b\n+c\n+d\n" }),
  call("t-b2", "Bash", { type: "shell", command: "npm test -- markdown", cwd: ROOT, output: "Tests 82 passed", exitCode: 0, durationMs: 1200 }),
  call("t-b3", "Bash", { type: "shell", command: "npm run check:hermes", cwd: ROOT, output: "hermesc: error: invalid class syntax\n", exitCode: 1, durationMs: 2100 }, "failed"),
  call("t-b4", "Bash", { type: "shell", command: "npm run soak -- --duration 60", cwd: ROOT, output: SOAK.split("\n").slice(0, 12).join("\n") }, "running"),
];

const TASKS: TaskListData = {
  id: "s7-tasks",
  phaseName: "Checklist Progress",
  tasks: [
    { id: "1", title: "Freeze finished blocks", phase: "x", status: "completed" },
    { id: "2", title: "Measure table cells once per row", phase: "x", status: "in_progress" },
    { id: "3", title: "Capture every component", phase: "x", status: "pending" },
    { id: "4", title: "Open the file editor from a path", phase: "x", status: "blocked", blockerReason: "Needs the host file-editor API." },
  ],
};

const TASKS_DONE: TaskListData = {
  ...TASKS,
  id: "s7-tasks-done",
  tasks: TASKS.tasks.map((task) => ({ ...task, status: "completed" as const })),
};

const REPLY = `## 修复：流式列表与宽表格

修复后，列表在流式输出时不再整体重排；\`splitBlocks\` 只处理最后一个块。宽表格现在可以横向滚动，数字列右对齐。

### What changed

Finished blocks are frozen, so only the open block re-renders on each delta. Links route through the host's opener — see [pull/125](https://github.com/getpaseo/paseo/pull/125).

1. Freeze finished blocks by their raw text.
2. Measure table cells once per row.
   - 数字列使用等宽数字，右对齐
   - wide tables scroll inside the reply

| Scenario | Fixture | Rows | Before ms | After ms | What it measures |
| --- | --- | --- | --- | --- | --- |
| 长回复 | markdown-long | 1 | 18 | 6 | Incremental block commit |
| Code streaming | codeblock-streaming | 5 | 24 | 9 | Highlight cost per open fence |
| Tables | table-streaming | 12 | 31 | 11 | Header first, rows appended |
| 表格重排 | table-reflow | 40 | 46 | 12 | 每行只测量一次 |

\`\`\`ts
export function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  for (const token of lex(text)) {
    if (token.type === "space") continue; // 空行不单独成块
    blocks.push(token.raw);
  }
  return blocks;
}
\`\`\`
`;

const LONG_CODE = Array.from({ length: 54 }, (_, i) =>
  i === 0 ? 'import { lex } from "./lexer";' : i === 1 ? 'import type { Token } from "./types";' : `export const step${i} = (value: number) => value * ${i}; // ${i % 7 === 0 ? "边界" : "ok"}`,
).join("\n");

const JOB_NOTICE = `<system-notice>
Background job MarkdownFixes has completed. Resume your work using the result below.
<task-result id="MarkdownFixes" agent="task" status="completed" duration="6m12s">
<meta lines="44" size="2.1KB" />
<preview full-output="agent://MarkdownFixes">
{"files": {"edited": "client/components/markdown/parse.ts"}, "defects": ["ordered marker column sized from digits", "table cells under-measured"], "verification": [{"check": "typecheck", "result": "pass"}]}
</preview>
</task-result>
</system-notice>`;

const REASONING = `**Understanding the symptom**

The highlighter re-tokenises every fenced block on each delta, then the cache measures a stale range.

**Mapping the render path**

Find where splitBlocks runs and check whether finished blocks are memoised.

**Checking the memo**

${"The card compares text.length and phase only. That should stop most renders, but the host hands every row a fresh theme object on every chunk, so the tokens memo has to key on the colour strings rather than the object identity. ".repeat(4)}`;

function Caption({ tokens, children }: { tokens: ExtendedThemeTokens; children: string }) {
  return (
    <Text style={{ color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: 12, marginTop: 12, marginBottom: 4 }}>
      {children}
    </Text>
  );
}

function Thought({ tokens, compact, streaming, expanded, cut }: { tokens: ExtendedThemeTokens; compact: boolean; streaming: boolean; expanded: boolean; cut?: number }) {
  const text = cut === undefined ? REASONING : REASONING.slice(0, cut);
  const segmentation = segmentReasoning(text, { streaming });
  return (
    <ReasoningCard
      segmentation={segmentation}
      streaming={streaming}
      durationMs={streaming ? null : 8000}
      expanded={expanded}
      onToggle={() => {}}
      tokens={tokens}
      compact={compact}
      storeKey={`s7:${streaming}:${expanded}:${cut ?? "all"}`}
      copyText={reasoningText(segmentation)}
    />
  );
}

function Tool({ view, tokens, compact, expanded = false }: { view: ToolCallView; tokens: ExtendedThemeTokens; compact: boolean; expanded?: boolean }) {
  return <ToolCallout data={view} tokens={tokens} compact={compact} defaultExpanded={expanded} />;
}

/** Real summary/cards inside the observed 0.12 host wrapper shape; not a host integration test. */
function Rollups({ tokens, compact }: { tokens: ExtendedThemeTokens; compact: boolean }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(installToolRollupSpacing, []);
  const calls = [...TURN_TOOLS.slice(0, 5), TURN_TOOLS[8]!, TURN_TOOLS[9]!];
  return <PathContext.Provider value={PATHS}>
    <View>
      <Text style={{ color: tokens.foreground, marginBottom: 16 }}>I’ll inspect the parser and check the types.</Text>
      {calls.map((view, index) => <View key={view.callId} testID={`rollup-source-${index}`}>
        <View style={{ marginBottom: 16 }}>
          <div style={{ display: "contents" }}>
            <View {...(!expanded && index > 0 ? { dataSet: { bcrollupempty: "true" } } as import("react-native").ViewProps : {})}>
              {index === 0 ? <ToolRollup calls={calls} tokens={tokens} compact={compact}
                expanded={expanded} onExpandedChange={setExpanded} /> : null}
              {expanded ? <Tool view={view} tokens={tokens} compact={compact} /> : null}
            </View>
          </div>
        </View>
      </View>)}
      <Text testID="rollup-next-update" style={{ color: tokens.foreground, marginBottom: 16 }}>The types pass; one check failed and another is running. Expand the tools for details.</Text>
    </View>
  </PathContext.Provider>;
}

export function FullTurn({ tokens, compact }: { tokens: ExtendedThemeTokens; compact: boolean }) {
  return (
    <PathContext.Provider value={PATHS}>
      <View style={{ gap: 0 }}>
        <UserMessage
          text="表格在 iOS 上被截断了，右边的列看不到。Please make wide tables scroll and right-align the numbers."
          timestamp={AT}
          tokens={tokens}
          compact={compact}
          usage={{ inputTokens: 90100, cachedInputTokens: 1600000, outputTokens: 62000 }}
        />
        <View style={{ height: 8 }} />
        <Thought tokens={tokens} compact={compact} streaming={false} expanded={false} />
        {TURN_TOOLS.map((view) => (
          <Tool key={view.callId} view={view} tokens={tokens} compact={compact} expanded={view.callId === "t-e1"} />
        ))}
        <TaskList data={TASKS} tokens={tokens} compact={compact} />
        <NoticeCallout data={{ id: "w", level: "warning", message: "The daemon restarted twice in 30s." }} tokens={tokens} at={new Date(2026, 8, 16, 6, 46)} compact={compact} />
        <View style={{ height: 12 }} />
        <MarkdownView text={REPLY} tokens={tokens} variant="document" compact={compact} />
        <AssistantFooter text={REPLY} at={LATER} tokens={tokens} compact={compact} />
      </View>
    </PathContext.Provider>
  );
}

export function ToolRows({ tokens, compact }: { tokens: ExtendedThemeTokens; compact: boolean }) {
  return (
    <PathContext.Provider value={PATHS}>
      <View>
        <Caption tokens={tokens}>collapsed · done · running · failed</Caption>
        <Tool view={TURN_TOOLS[0]!} tokens={tokens} compact={compact} />
        <Tool view={TURN_TOOLS[9]!} tokens={tokens} compact={compact} />
        <Tool view={TURN_TOOLS[8]!} tokens={tokens} compact={compact} />
        <Caption tokens={tokens}>expanded · Bash output folded to its last 12 lines</Caption>
        <Tool view={call("x-b", "Bash", { type: "shell", command: "npm run soak -- --duration 60", cwd: ROOT, output: SOAK, exitCode: 0, durationMs: 60_000 })} tokens={tokens} compact={compact} expanded />
        <Caption tokens={tokens}>expanded · Edit with a diff</Caption>
        <Tool view={TURN_TOOLS[3]!} tokens={tokens} compact={compact} expanded />
        <Caption tokens={tokens}>expanded · Search with a file list</Caption>
        <Tool
          view={call("x-s", "Grep", {
            type: "search",
            query: "useDisclosure",
            toolName: "grep",
            filePaths: [`${ROOT}/client/live-renderers.tsx`, `${ROOT}/client/state/disclosure-store.ts`, `${ROOT}/client/ui/path-text.tsx`],
            numFiles: 3,
            numMatches: 7,
          })}
          tokens={tokens}
          compact={compact}
          expanded
        />
        <Caption tokens={tokens}>failed · expanded</Caption>
        <Tool view={call("x-f", "Bash", { type: "shell", command: "npm run check:hermes", cwd: ROOT, output: "$ npm run check:hermes\n> hermesc -emit-binary -out /tmp/check.hbc\ndist/bundle.js:4127:15: error: invalid class syntax\n  static #cache = new Map();\n         ^\n1 error generated.", exitCode: 1, durationMs: 2100 }, "failed")} tokens={tokens} compact={compact} expanded />
        <Caption tokens={tokens}>running · expanded · live tail</Caption>
        <Tool view={call("x-r", "Bash", { type: "shell", command: "npm run soak -- --duration 60", cwd: ROOT, output: SOAK.split("\n").slice(0, 160).join("\n") }, "running")} tokens={tokens} compact={compact} expanded />
      </View>
    </PathContext.Provider>
  );
}

export function Reasoning({ tokens, compact }: { tokens: ExtendedThemeTokens; compact: boolean }) {
  return (
    <View>
      <Caption tokens={tokens}>streaming · collapsed — live one-line preview</Caption>
      <Thought tokens={tokens} compact={compact} streaming expanded={false} cut={REASONING.indexOf("**Checking") + 30} />
      <Caption tokens={tokens}>done · collapsed</Caption>
      <Thought tokens={tokens} compact={compact} streaming={false} expanded={false} />
      <Caption tokens={tokens}>done · expanded — three sections, the long one folded to four lines</Caption>
      <Thought tokens={tokens} compact={compact} streaming={false} expanded />
    </View>
  );
}

export function Tasks({ tokens, compact }: { tokens: ExtendedThemeTokens; compact: boolean }) {
  return (
    <View>
      <Caption tokens={tokens}>in progress · done · pending · blocked</Caption>
      <TaskList data={TASKS} tokens={tokens} compact={compact} />
      <Caption tokens={tokens}>all done</Caption>
      <TaskList data={TASKS_DONE} tokens={tokens} compact={compact} />
    </View>
  );
}

export function Notices({ tokens, compact }: { tokens: ExtendedThemeTokens; compact: boolean }) {
  const at = new Date(2026, 8, 16, 6, 44);
  const envelope = parseSystemEnvelope(JOB_NOTICE);
  return (
    <View>
      <Caption tokens={tokens}>info · warning · error · fatal</Caption>
      <NoticeCallout data={{ id: "i", level: "info", message: "Context compacted — earlier turns summarised." }} tokens={tokens} at={at} compact={compact} />
      <NoticeCallout data={{ id: "w", level: "warning", message: "The daemon restarted twice in 30s." }} tokens={tokens} at={at} compact={compact} />
      <NoticeCallout data={{ id: "e", level: "error", message: "Provider returned 529, retrying in 4s." }} tokens={tokens} at={at} compact={compact} />
      <NoticeCallout data={{ id: "f", level: "error", message: "Session stopped: daemon exited.", fatal: true }} tokens={tokens} at={at} compact={compact} />
      <Caption tokens={tokens}>background job finished — result as a JSON block</Caption>
      {envelope ? <SystemCard envelope={envelope} tokens={tokens} compact={compact} /> : null}
    </View>
  );
}

export function Bubbles({ tokens, compact }: { tokens: ExtendedThemeTokens; compact: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      <Caption tokens={tokens}>short</Caption>
      <UserMessage text="Merge S3 now." timestamp={AT} tokens={tokens} compact={compact} />
      <Caption tokens={tokens}>long — wraps</Caption>
      <UserMessage
        text="I can't click on URLs in the assistant responses. On iOS a tap on a link does nothing, on desktop it selects the text instead. Bare URLs and markdown links both fail. Paths like client/components/markdown/blocks.ts:42 should open the file editor."
        timestamp={AT}
        tokens={tokens}
        compact={compact}
        usage={{ inputTokens: 270, cachedInputTokens: 36_200_000, outputTokens: 62_000 }}
      />
      <Caption tokens={tokens}>CJK + Latin</Caption>
      <UserMessage text="表格在 iOS 上被截断了，右边的列看不到。能不能加一个横向滚动，并且把数字列右对齐？" timestamp={AT} tokens={tokens} compact={compact} />
    </View>
  );
}

export function CodeBlocks({ tokens, compact }: { tokens: ExtendedThemeTokens; compact: boolean }) {
  const streaming = "```rust\nuse std::time::{Duration, Instant};\n\npub struct Debounce<T> {\n    wait: Duration,\n    last: Option<Instant>,\n    pending: Opt";
  return (
    <View>
      <Caption tokens={tokens}>short — shown whole</Caption>
      <SyntaxHighlightBlock code={"$ npm run typecheck\n$ npm test -- tool"} language="bash" tokens={tokens} scrollX />
      <Caption tokens={tokens}>long — first 12 lines, then "Show 42 more lines"</Caption>
      <SyntaxHighlightBlock code={LONG_CODE} language="typescript" filename="client/components/markdown/blocks.ts" tokens={tokens} showLineNumbers scrollX />
      <Caption tokens={tokens}>streaming — no header actions until the fence closes</Caption>
      <MarkdownView text={streaming} tokens={tokens} variant="document" compact={compact} streaming />
    </View>
  );
}

export function Footer({ tokens, compact }: { tokens: ExtendedThemeTokens; compact: boolean }) {
  return (
    <View>
      <Caption tokens={tokens}>under the last reply — Copy · time</Caption>
      <AssistantFooter text="Done." at={LATER} tokens={tokens} compact={compact} />
      <Caption tokens={tokens}>an older turn</Caption>
      <AssistantFooter text="Done." at={new Date(2026, 7, 16, 6, 47)} tokens={tokens} compact={compact} />
    </View>
  );
}

export const S7_GROUPS: ReadonlyArray<{
  id: string;
  render(tokens: ExtendedThemeTokens, compact: boolean): React.ReactElement;
}> = [
  { id: "rollups", render: (tokens, compact) => <Rollups tokens={tokens} compact={compact} /> },
  { id: "full-turn", render: (tokens, compact) => <FullTurn tokens={tokens} compact={compact} /> },
  { id: "tool-rows", render: (tokens, compact) => <ToolRows tokens={tokens} compact={compact} /> },
  { id: "reasoning", render: (tokens, compact) => <Reasoning tokens={tokens} compact={compact} /> },
  { id: "tasks", render: (tokens, compact) => <Tasks tokens={tokens} compact={compact} /> },
  { id: "notices", render: (tokens, compact) => <Notices tokens={tokens} compact={compact} /> },
  { id: "bubble", render: (tokens, compact) => <Bubbles tokens={tokens} compact={compact} /> },
  { id: "code", render: (tokens, compact) => <CodeBlocks tokens={tokens} compact={compact} /> },
  { id: "footer", render: (tokens, compact) => <Footer tokens={tokens} compact={compact} /> },
];
