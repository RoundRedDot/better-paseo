import React, { useContext, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ExtendedThemeTokens } from "./components/theme-tokens";
import { radiusV2, space } from "./components/theme-tokens";
import { ToolCallout, ToolPreviewContent } from "./components/tool-callouts";
import { ReasoningCard } from "./components/reasoning-trace";
import { UserMessage } from "./components/user-message";
import { MarkdownView } from "./components/markdown/markdown-view";
import { AssistantFooter } from "./components/turn-footer";
import { TaskList } from "./components/task-list";
import { classifyTool, type ToolCallView } from "./tools/classify";
import { defaultToolExpanded } from "./tools/disclosure";
import { reasoningText, segmentReasoning } from "./reasoning/segment";
import { formatPath, pathRootsFor } from "./paths/format-path";
import { pluginRoot } from "./components/focus-ring";
import { PathContext, type PathContextValue } from "./ui/path-text";
import { PreviewPanelSample } from "./ui/hover-preview";
import type { EnhancerPreferences } from "./preferences";
import type { TaskListData } from "../shared/contracts";
import type { SettingsStrings } from "./i18n/settings-strings";

/**
 * A made-up turn drawn with the timeline's own components, so a change on the
 * settings page shows on real rows before the reader opens a chat. The rows
 * read the same preference store as the timeline, so they follow every
 * option; only the host's own pieces (its prompt bubble and its markdown,
 * when the plugin's are off) and its gaps between items are imitated here.
 *
 * The accent has its own showcase: the plan is mid-way (an accent progress
 * ring and a running dot on the open task) and the reply ends on a link,
 * since a finished turn otherwise shows no accent at all.
 *
 * The Read row's hover preview is drawn open under it, so the panel options
 * show without a hover. The turn is its own plugin root: a preview a row
 * opens on hover spans the turn, as it spans the chat column in a timeline,
 * rather than the whole settings page.
 */

const ROOT = "/Users/me/code/better-paseo";
const FILE = `${ROOT}/client/paths/format-path.ts`;
const PATHS: PathContextValue = {
  roots: pathRootsFor({ directory: ROOT, cwd: ROOT }),
  cwd: ROOT,
  mode: "relative",
};
const AT = new Date("2026-10-13T09:41:00Z");
const DONE = new Date("2026-10-13T09:42:18Z");
/** The gap Paseo hangs under every item, and what the compact options leave of it. */
const HOST_GAP = 16;
const COMPACT_GAP = 4;

/** Long enough lines that the wrap option visibly changes the panel. */
const PANEL_CODE = `export function formatPath(raw: string, ctx: FormatPathContext): FormattedPath {
  const { path, suffix } = splitSelector(raw);
  if (!path) return unmatched(raw.trim());
  // A worktree's main repository is shown by its name, so a path outside the worktree still reads as part of the project.
  const root = ctx.roots.find((candidate) => isInside(path, candidate.path));
  return ctx.mode === "absolute" || !root ? absolute(path, suffix) : relative(path, root, suffix);
}`;

function call(callId: string, name: string, detail: Record<string, unknown>, status = "completed"): ToolCallView {
  return classifyTool({ callId, name, status, detail });
}

const READ = call("preview-read", "Read", { type: "read", filePath: FILE, offset: 112, limit: 7, content: PANEL_CODE });
const EDIT = call("preview-edit", "Edit", {
  type: "edit",
  filePath: FILE,
  unifiedDiff:
    "@@ -114,3 +114,3 @@\n const { path, suffix } = splitSelector(raw);\n-if (!path) return unmatched(raw);\n+if (!path) return unmatched(raw.trim());\n",
});
const FAILED = call(
  "preview-typecheck",
  "Bash",
  {
    type: "shell",
    command: "npm run typecheck",
    cwd: ROOT,
    output:
      "client/paths/format-path.ts:116:22 - error TS2345: Argument of type 'string | undefined'\n  is not assignable to parameter of type 'string'.\n\nFound 1 error in client/paths/format-path.ts:116",
    exitCode: 2,
    durationMs: 3800,
  },
  "failed",
);
const TESTS = call("preview-test", "Bash", {
  type: "shell",
  command: "npm test -- format-path",
  cwd: ROOT,
  output: " ✓ test/unit/format-path.test.ts (31 tests)\n\n Tests  31 passed (31)",
  exitCode: 0,
  durationMs: 1240,
});

/** Host prose: the content size at Paseo's 1.4 line height. */
function hostText(tokens: ExtendedThemeTokens) {
  const size = tokens.typography.content.size;
  return { fontSize: size, lineHeight: Math.round(size * 1.4), color: tokens.foreground, fontFamily: tokens.fontUi };
}

/** Paseo's own prompt bubble, as `message.tsx` draws it: right-aligned, tail at the top right. */
function HostBubble({ text, tokens }: { text: string; tokens: ExtendedThemeTokens }) {
  return (
    <View style={styles.hostBubbleRow}>
      <View style={[styles.hostBubble, { backgroundColor: tokens.v2.surface2 }]}>
        <Text style={hostText(tokens)}>{text}</Text>
      </View>
    </View>
  );
}

/**
 * Paseo's own reply when the plugin's markdown is off. Its renderer cannot be
 * reached from a plugin, so the sample is shown as the text it formats, with
 * the markup taken out rather than printed: a table row keeps its cells,
 * spaced apart, and loses its pipes and its divider row.
 */
function HostReply({ text, tokens }: { text: string; tokens: ExtendedThemeTokens }) {
  const plain = useMemo(
    () =>
      text
        .split("\n")
        .filter((line) => !line.startsWith("```") && !/^\|[\s:|-]+\|$/.test(line))
        .map((line) => (line.startsWith("|") ? line.slice(1, -1).split("|").map((cell) => cell.trim()).join("   ") : line))
        .join("\n")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\*\*|`/g, "")
        .replace(/^- /gm, "• "),
    [text],
  );
  return <Text style={hostText(tokens)}>{plain}</Text>;
}

/** One timeline item with the gap the host leaves under it. */
function Item({ gap, children }: { gap: number; children: React.ReactNode }) {
  return <View style={{ marginBottom: gap }}>{children}</View>;
}

export function SettingsPreview({
  tokens,
  preferences,
  compact,
  t,
}: {
  tokens: ExtendedThemeTokens;
  preferences: EnhancerPreferences;
  compact: boolean;
  t: SettingsStrings;
}) {
  const thought = useMemo(() => segmentReasoning(t.previewThought), [t]);
  const paths = useMemo<PathContextValue>(() => ({ ...PATHS, mode: preferences.pathDisplay }), [preferences.pathDisplay]);
  const rowGap = preferences.compactRowSpacing ? COMPACT_GAP : HOST_GAP;
  const replyGap = preferences.compactReplySpacing ? COMPACT_GAP : HOST_GAP;
  const failedOpen = defaultToolExpanded(FAILED, preferences.toolDetail);
  const plan = useMemo<TaskListData>(
    () => ({
      id: "settings-preview-plan",
      phaseName: t.previewPlanPhase,
      tasks: [
        { id: "find", title: t.previewPlanFind, phase: t.previewPlanPhase, status: "completed" },
        { id: "fix", title: t.previewPlanFix, phase: t.previewPlanPhase, status: "in_progress" },
        { id: "test", title: t.previewPlanTest, phase: t.previewPlanPhase, status: "pending" },
      ],
    }),
    [t],
  );
  const reply = (text: string) =>
    preferences.assistantMarkdown ? (
      <MarkdownView text={text} tokens={tokens} variant={preferences.markdownVariant} compact={compact} />
    ) : (
      <HostReply text={text} tokens={tokens} />
    );

  return (
    <PathContext.Provider value={paths}>
      <View {...pluginRoot}>
        <Item gap={HOST_GAP}>
          {preferences.enhancedUserBubble ? (
            <UserMessage
              text={t.previewPrompt}
              timestamp={AT}
              tokens={tokens}
              compact={compact}
              usage={{ inputTokens: 18_412, cachedInputTokens: 96_300, outputTokens: 1_268 }}
            />
          ) : (
            <HostBubble text={t.previewPrompt} tokens={tokens} />
          )}
        </Item>
        <Item gap={rowGap}>
          <ReasoningCard
            segmentation={thought}
            streaming={false}
            durationMs={6200}
            expanded={false}
            onToggle={() => {}}
            tokens={tokens}
            compact={compact}
            storeKey="settings-preview:thought"
            copyText={reasoningText(thought)}
          />
        </Item>
        <Item gap={replyGap}>{reply(t.previewLead)}</Item>
        {/* Paseo's own gap under a plan: the row options do not apply to it. */}
        <Item gap={HOST_GAP}>
          <TaskList data={plan} tokens={tokens} compact={compact} />
        </Item>
        <Item gap={rowGap}>
          <ToolCallout data={READ} tokens={tokens} compact={compact} />
          {preferences.hoverPreview ? (
            <View style={styles.openPanel}>
              <Text style={[styles.caption, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
                {t.previewPanelCaption}
              </Text>
              <OpenPanel tokens={tokens} compact={compact} />
            </View>
          ) : null}
        </Item>
        <Item gap={rowGap}>
          <ToolCallout data={EDIT} tokens={tokens} compact={compact} />
        </Item>
        <Item gap={rowGap}>
          {/* Remounted when the option changes: the start state is read once. */}
          <ToolCallout key={String(failedOpen)} data={FAILED} tokens={tokens} compact={compact} defaultExpanded={failedOpen} />
        </Item>
        <Item gap={HOST_GAP}>
          <ToolCallout data={TESTS} tokens={tokens} compact={compact} />
        </Item>
        <View>
          {reply(t.previewReply)}
          <AssistantFooter text={t.previewReply} at={DONE} tokens={tokens} compact={compact} />
        </View>
      </View>
    </PathContext.Provider>
  );
}

const styles = StyleSheet.create({
  // Where the real panel opens: 6pt under its row.
  openPanel: { marginTop: 6, gap: space.xs },
  caption: { fontSize: 12, lineHeight: 16 },
  hostBubbleRow: { flexDirection: "row", justifyContent: "flex-end" },
  hostBubble: {
    maxWidth: "86%",
    borderRadius: radiusV2.bubble,
    borderTopRightRadius: radiusV2.bubbleTail,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
});

/**
 * The Read row's hover preview, open: the panel options (wrap, line numbers,
 * shading) apply to it as they change, and its wrap button flips it as a
 * real panel's does. Paths resolve against the turn's own context.
 */
function OpenPanel({ tokens, compact }: { tokens: ExtendedThemeTokens; compact: boolean }) {
  const paths = useContext(PathContext);
  const resolvePath = useMemo(() => (path: string) => formatPath(path, paths).absolutePath, [paths]);
  return (
    <PreviewPanelSample tokens={tokens}>
      <ToolPreviewContent
        data={READ}
        resolvePath={resolvePath}
        tokens={tokens}
        compact={compact}
        displayPath={formatPath(FILE, paths).displayPath}
      />
    </PreviewPanelSample>
  );
}
