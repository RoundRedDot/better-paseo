import React, { useCallback, useContext, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { Glyph } from "./glyph";
import { surfaceProps } from "./view-props";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { HubCallout } from "./hub-callout";
import { PaseoToolCallout } from "./paseo-tool-callouts";
import { SyntaxHighlightBlock, TerminalOutput, renderTerminalOutput } from "./syntax-highlight";
import { ImagePreview } from "./image-preview";
import { GitHubBody } from "./github-body";
import { MarkdownView } from "./markdown/markdown-view";
import { ReasoningSections } from "./reasoning-trace";
import { isImagePath } from "../image-file";
import type { ImageFile } from "../image-file";
import { selectableSurface, unselectable } from "./selection";
import { selectionCodeText, selectionSurface } from "./selection-actions";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { DISCLOSURE_HEADER, DisclosureHeader } from "../ui/disclosure-header";
import { PathContext, PathText } from "../ui/path-text";
import { RunningDot } from "../ui/running-dot";
import { CopyButton } from "../ui/copy-button";
import { ActionMenuList, ActionMenuTrigger, useActionMenu, type ActionMenuItem } from "../ui/action-menu";
import { useCopy } from "../ui/use-copy";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { FadeIn } from "../ui/fade-in";
import { formatPath } from "../paths/format-path";
import { lineRangeLabel, summarizeTool } from "../tools/summarize";
import { TYPE, UI_SCALE } from "../ui/tokens/typography";
import { codeSurface } from "./host-font-escape";
import { toolCopyPlan } from "../tools/copy";
import { stringifyValue, type ToolCallView, type ToolKind } from "../tools/classify";

/**
 * The muted icon a settled call shows in the row's status slot: one Lucide
 * family drawn by the host (S7 design spec §2.5), except the two brand marks
 * Lucide does not carry, which stay `Glyph` bitmaps.
 */
export function toolIconName(tool: ToolKind): string {
  switch (tool) {
    case "git":
    case "worktree_setup":
      return "GitBranch";
    case "github":
      return "brand:GitHub";
    case "paseo":
      return "brand:Paseo";
    case "bash":
    case "shell":
      return "SquareTerminal";
    case "read":
      return "FileText";
    case "edit":
    case "write":
      return "Pencil";
    case "thinking":
      return "Lightbulb";
    case "eval":
      return "Play";
    case "ask":
      return "CircleHelp";
    case "mcp":
      return "Plug";
    case "task":
    case "sub_agent":
      return "Bot";
    case "hub":
      return "Radio";
    case "search":
      return "Search";
    case "fetch":
      return "Globe";
    case "plan":
      return "ListChecks";
    case "plain_text":
      return "MessageSquare";
    default:
      return "Wrench";
  }
}

/** A row icon by name: the host's Lucide set, or a brand bitmap for `brand:*`. */
export function RowIcon({ name, color, size = DISCLOSURE_HEADER.icon }: { name: string; color: string; size?: number }) {
  if (name.startsWith("brand:")) return <Glyph name={name.slice(6)} size={size} color={color} />;
  return <Icon name={name} size={size} color={color} />;
}

/** `exit 1`, `failed`: the meta entries a failure colours (S7: only these and the icon turn danger). */
const FAILURE_META = /^(exit [1-9]\d*|failed|error|timed out)$/;

/** `+12 −3`: the diff counts, as success and danger spans of the meta Text. */
function diffCountSpans(entry: string, tokens: ExtendedThemeTokens): React.ReactNode {
  const match = /^\+(\d+) −(\d+)$/.exec(entry);
  if (!match) return entry;
  return (
    <>
      <Text style={{ color: tokens.success }}>{`+${match[1]}`}</Text>
      {" "}
      <Text style={{ color: tokens.danger }}>{`−${match[2]}`}</Text>
    </>
  );
}

/** Label of the header's copy button: what the primary copy puts on the clipboard. */
function primaryCopyLabel(tool: ToolKind): string {
  switch (tool) {
    case "bash":
    case "shell":
    case "git":
      return "Copy command";
    case "read":
    case "write":
    case "edit":
    case "worktree_setup":
      return "Copy path";
    case "search":
      return "Copy query";
    case "fetch":
      return "Copy URL";
    default:
      return "Copy";
  }
}

interface ToolCalloutProps {
  data: ToolCallView;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`: 28px header and shorter truncation budgets. */
  compact?: boolean;
  /** Uncontrolled start state. The live renderer passes `expanded` instead. */
  defaultExpanded?: boolean;
  /** Controlled open state (the disclosure store's value). */
  expanded?: boolean;
  onExpandedChange?(expanded: boolean): void;
  /** Shows an absolute path in the machine's own file manager. */
  onRevealPath?: (path: string) => void;
  /**
   * The image this call read, when it read one. `undefined` keeps the code
   * block, so a harness with no daemon still renders the card; `null` means
   * the read is in flight.
   */
  imageFile?: ImageFile | null;
}

/**
 * One tool call (plan §3.3, BC-01).
 *
 * Collapsed it is a bare single row — `[status] Verb target … meta ›` — with
 * no frame and no fill, so consecutive calls read as a compact list. Expanded
 * it gains a 1px border on `surface0` and the body below a subtle divider.
 * The body is mounted only while expanded. The only looping animation is the
 * `RunningDot`, and only while the call runs.
 *
 * A failure adds one danger-coloured line under the header with the first
 * line of the error, so it can be read without opening the card.
 */
export function ToolCallout({
  data,
  tokens,
  compact = false,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  onRevealPath,
  imageFile,
}: ToolCalloutProps) {
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ?? localExpanded;
  const setExpanded = onExpandedChange ?? setLocalExpanded;
  const onToggle = useCallback(() => setExpanded(!expanded), [setExpanded, expanded]);

  const summary = useMemo(() => summarizeTool(data), [data]);
  const pathContext = useContext(PathContext);
  const capabilities = useInputCapabilities(compact);
  const touchFirst = capabilities.touch && !capabilities.hover;
  const { copy } = useCopy();
  const menu = useActionMenu();

  const resolvePath = useCallback(
    (path: string) => formatPath(path, pathContext).absolutePath,
    [pathContext],
  );
  // Built on demand: a running shell's output is stripped of ANSI only when
  // someone actually copies it, not on every chunk.
  const getPlan = useCallback(() => toolCopyPlan(data, resolvePath), [data, resolvePath]);
  const copyPrimary = useCallback(() => getPlan().primary?.text ?? "", [getPlan]);
  const onLongPress = useCallback(() => {
    const primary = getPlan().primary;
    if (primary) void copy(primary.text, { feedback: "toast" });
  }, [getPlan, copy]);
  const menuItems = useMemo<ActionMenuItem[]>(
    () =>
      menu.open
        ? getPlan().menu.map((action) => ({
            id: action.id,
            label: action.label,
            icon: "Copy",
            onSelect: () => void copy(action.text, { feedback: "toast" }),
          }))
        : [],
    [menu.open, getPlan, copy],
  );

  const running = data.status === "running";
  const failed = data.status === "failed" || summary.tone === "danger";
  const statusIcon = running ? (
    <RunningDot color={tokens.accent} />
  ) : (
    <RowIcon
      name={toolIconName(data.tool)}
      color={failed ? tokens.danger : tokens.foregroundMuted}
    />
  );

  const target =
    summary.targetIsPath && summary.target ? (
      <PathText
        path={summary.target}
        tokens={tokens}
        compact={compact}
        copyOnHover={false}
        fit
        grow
        style={compact ? TARGET_STYLE.compact : TARGET_STYLE.desktop}
      />
    ) : (
      summary.target
    );
  const meta = summary.meta.map((entry) =>
    failed && FAILURE_META.test(entry) ? (
      <Text style={{ color: tokens.danger }}>{entry}</Text>
    ) : (
      diffCountSpans(entry, tokens)
    ),
  );
  const metaLead = summary.metaPath ? (
    <MetaPath path={summary.metaPath} tokens={tokens} compact={compact} />
  ) : undefined;

  const actions = (
    <>
      <CopyButton text={copyPrimary} tokens={tokens} label={primaryCopyLabel(data.tool)} />
      <ActionMenuTrigger open={menu.open} onPress={menu.toggle} tokens={tokens} />
    </>
  );

  // A path in the body reveals the file on a pointer device; on touch it
  // copies, because `file.reveal` would open a window on the daemon's machine.
  const filePath = data.filePath;
  const reveal = onRevealPath ?? pathContext.reveal;
  const revealFile = useMemo(() => {
    if (!filePath) return undefined;
    const absolutePath = resolvePath(filePath);
    if (touchFirst) return () => void copy(absolutePath, { feedback: "toast" });
    return reveal ? () => reveal(absolutePath) : undefined;
  }, [filePath, resolvePath, touchFirst, copy, reveal]);

  // No frame (S7 design spec §3.1): the row, then — only when there is one —
  // the error line, the copy menu and the opened body as its siblings. A
  // collapsed call is the row alone, and the row keeps its place in the tree
  // when the body opens, so hover and press state survive the toggle.
  return (
    <>
      <DisclosureHeader
        expanded={expanded}
        onToggle={onToggle}
        tokens={tokens}
        compact={compact}
        icon={statusIcon}
        verb={summary.verb}
        target={target}
        meta={meta}
        metaLead={metaLead}
        actions={actions}
        actionsActive={menu.open}
        onLongPress={capabilities.touch ? onLongPress : undefined}
        accessibilityLabel={[summary.verb, summary.target, ...summary.meta].filter(Boolean).join(" ")}
      />
      {summary.errorLine && !expanded ? (
        <Text
          {...(surfaceProps(selectionSurface, codeSurface) as object)}
          selectable
          numberOfLines={1}
          style={[styles.errorLine, { color: tokens.foregroundMuted, fontFamily: tokens.fontMono }]}
        >
          {summary.errorLine}
        </Text>
      ) : null}
      {menu.open ? (
        <ActionMenuList items={menuItems} open={menu.open} onClose={menu.close} tokens={tokens} compact={compact} />
      ) : null}
      {expanded ? (
        <FadeIn style={[styles.body, { backgroundColor: tokens.v2.surface1 }]}>
          <View {...surfaceProps(selectionSurface)} style={styles.bodyInner}>
            <ToolBody
              data={data}
              tokens={tokens}
              compact={compact}
              imageFile={imageFile}
              revealFile={revealFile}
              displayPath={filePath ? formatPath(filePath, pathContext).displayPath : undefined}
            />
          </View>
        </FadeIn>
      ) : null}
    </>
  );
}

/** A path target takes the row's target type (S7 design spec §2.3). */
const TARGET_STYLE = {
  compact: { fontSize: TYPE.target.compact.size, lineHeight: TYPE.target.compact.lineHeight },
  desktop: { fontSize: TYPE.target.desktop.size, lineHeight: TYPE.target.desktop.lineHeight },
} as const;

/**
 * A path among the header's meta (a shell's cwd, a worktree's directory).
 * Shown only for a directory inside a known root: the root itself says
 * nothing, and an absolute path outside every root would crowd out the
 * command on a phone-width row.
 */
function MetaPath({
  path,
  tokens,
  compact,
}: {
  path: string;
  tokens: ExtendedThemeTokens;
  compact: boolean;
}) {
  const context = useContext(PathContext);
  const formatted = useMemo(() => formatPath(path, context), [path, context]);
  if (!formatted.projectRoot || formatted.displayPath === "./" || formatted.displayPath === ".") {
    return null;
  }
  return (
    <PathText
      path={path}
      tokens={tokens}
      compact={compact}
      copyOnHover={false}
      budget={compact ? 20 : 32}
      style={{ fontSize: TYPE.meta.size, color: tokens.foregroundMuted }}
    />
  );
}

const styles = StyleSheet.create({
  // The first line of a failure, under the verb (the row's text column).
  errorLine: {
    fontSize: TYPE.caption.size,
    lineHeight: 18,
    paddingLeft: DISCLOSURE_HEADER.textColumn,
    marginTop: -2,
    paddingBottom: 2,
    ...selectableSurface,
  },
  // An opened call: one surface1 slab under the row, full width, no frame.
  body: {
    marginTop: 2,
    marginBottom: 6,
    borderRadius: radiusV2.block,
    overflow: "hidden",
  },
  bodyInner: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    gap: space.sm,
    ...selectableSurface,
  },
});

/* ------------------------------------------------------------------ bodies */

interface ToolBodyProps {
  data: ToolCallView;
  tokens: ExtendedThemeTokens;
  compact: boolean;
  imageFile?: ImageFile | null;
  revealFile?: () => void;
  /** `filePath` relative to the workspace. */
  displayPath?: string;
}

/** Search results beyond this many rows collapse into a count. */
const MAX_FILE_ROWS = 50;

/**
 * The expanded body: the details the card always had — arguments, content
 * and logs, nothing trimmed — without the nested frames and shadows.
 */
/**
 * The path in a read, write or edit code header (plan §3.9 item 5): a
 * `PathText` (relative, middle-truncated, press to reveal or copy on touch)
 * and, for a read of part of a file, its line window as a muted suffix.
 */
function CodeHeaderPath({
  path,
  suffix,
  tokens,
  compact,
  onReveal,
}: {
  path: string;
  suffix?: string;
  tokens: ExtendedThemeTokens;
  compact: boolean;
  onReveal?: () => void;
}) {
  return (
    <View style={codeHeaderStyles.row}>
      <PathText
        path={path}
        tokens={tokens}
        compact={compact}
        onReveal={onReveal ? () => onReveal() : undefined}
        style={{ fontSize: UI_SCALE.base }}
      />
      {suffix ? (
        <Text
          {...(codeSurface as object)}
          selectable={false}
          style={[codeHeaderStyles.suffix, unselectable, { color: tokens.foregroundMuted, fontFamily: tokens.fontMono }]}
        >
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

const codeHeaderStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 1, minWidth: 0 },
  suffix: { fontSize: UI_SCALE.base, fontVariant: ["tabular-nums"], flexShrink: 0 },
});

function ToolBody({ data, tokens, compact, imageFile, revealFile, displayPath }: ToolBodyProps) {
  const styles = useBodyStyles(tokens, compact);
  const isRunning = data.status === "running";

  // Every branch below needs a payload. A tool that carries none — a hub op
  // with no parsed record — would otherwise draw an empty panel, so the raw
  // output takes over.
  const hasTypedBody =
    data.tool === "bash" ||
    data.tool === "shell" ||
    data.tool === "git" ||
    data.tool === "github" ||
    data.tool === "thinking" ||
    data.tool === "read" ||
    data.tool === "write" ||
    data.tool === "edit" ||
    data.tool === "eval" ||
    data.tool === "search" ||
    data.tool === "fetch" ||
    data.tool === "worktree_setup" ||
    data.tool === "sub_agent" ||
    data.tool === "plan" ||
    data.tool === "plain_text" ||
    data.tool === "unknown" ||
    (data.tool === "mcp" && Boolean(data.mcp)) ||
    (data.tool === "ask" && Boolean(data.askOptions)) ||
    (data.tool === "task" && Boolean(data.subagent)) ||
    (data.tool === "hub" && Boolean(data.hub)) ||
    (data.tool === "paseo" && Boolean(data.paseo));

  // Only a real shell call can "complete without output". A git op that
  // prints nothing is not a silent command, so it does not inherit the
  // shell sentence.
  const isShellCall = data.tool === "bash" || data.tool === "shell";
  const command = data.shell?.command || data.command;

  // A reply that matches no offered label is free text the user typed, so it
  // is labelled as such rather than pretending an option was picked.
  const answered = data.askAnswer ?? [];
  const typedReply =
    answered.length > 0 &&
    !answered.some((answer) =>
      (data.askOptions ?? []).some(
        (option) => option.label.trim().toLowerCase() === answer.trim().toLowerCase(),
      ),
    );

  return (
    <>
      {(data.tool === "bash" || data.tool === "shell" || data.tool === "git") && (
        <View style={styles.terminalWindow}>
          {command ? (
            // One line on the code surface, not a nested code card.
            <Text selectable {...selectionCodeText} style={styles.commandLine}>
              <Text style={styles.mutedColor}>{"$ "}</Text>
              {command}
            </Text>
          ) : null}
          {data.shell?.stdout ? (
            <TerminalOutput
              text={data.shell.stdout}
              tokens={tokens}
              textProps={selectionCodeText}
              style={styles.terminalOutput}
            />
          ) : null}
          {data.shell?.stderr ? (
            <Text selectable {...(codeSurface as object)} style={[styles.terminalOutput, { color: tokens.danger }]}>
              {data.shell.stderr}
            </Text>
          ) : null}
          {data.output && !data.shell?.stdout ? (
            <TerminalOutput
              text={data.output}
              tokens={tokens}
              textProps={selectionCodeText}
              style={styles.terminalOutput}
            />
          ) : null}
          {!data.shell?.stdout && !data.shell?.stderr && !data.output ? (
            <Text selectable style={styles.silentText}>
              {isRunning
                ? "Waiting for command output…"
                : isShellCall
                  ? "Command completed without output."
                  : "The call returned no output."}
            </Text>
          ) : null}
        </View>
      )}

      {data.tool === "github" && <GitHubBody data={data.github} tokens={tokens} running={isRunning} />}

      {data.tool === "thinking" && (
        <ReasoningSections
          text={data.thinking?.text || data.code || data.output || ""}
          tokens={tokens}
          storeKey={`tool-thinking:${data.callId ?? data.id}`}
          streaming={isRunning}
          compact={compact}
        />
      )}

      {data.tool === "mcp" && data.mcp && (
        <View style={styles.section}>
          {data.mcp.transport ? <Text style={styles.sectionTitle}>{data.mcp.transport}</Text> : null}
          <Text style={styles.sectionTitle}>Input parameters</Text>
          <SyntaxHighlightBlock
            bare
            code={JSON.stringify(data.mcp.arguments, null, 2)}
            language="json"
            tokens={tokens}
            compact
          />
          {data.mcp.result !== undefined && (
            <>
              <Text style={styles.sectionTitle}>Response</Text>
              <SyntaxHighlightBlock
            bare
                code={
                  typeof data.mcp.result === "string"
                    ? data.mcp.result
                    : JSON.stringify(data.mcp.result, null, 2)
                }
                language={typeof data.mcp.result === "string" ? "typescript" : "json"}
                tokens={tokens}
                compact
              />
            </>
          )}
          {data.mcp.error ? (
            <Text selectable style={[styles.plainText, { color: tokens.danger }]}>
              Error: {data.mcp.error}
            </Text>
          ) : null}
        </View>
      )}

      {(data.tool === "read" || data.tool === "write") &&
        (imageFile !== undefined && isImagePath(data.filePath) ? (
          <ImagePreview path={data.filePath ?? ""} file={imageFile} tokens={tokens} onReveal={revealFile} />
        ) : (
          <SyntaxHighlightBlock
            bare
            code={data.code || "// [Empty content or pending stream]"}
            language={data.language ?? "text"}
            // `filename` stays the bare path, because the block reads the
            // grammar from its extension; what is drawn is `filenameNode`.
            filename={displayPath}
            filenameNode={
              data.filePath ? (
                <CodeHeaderPath
                  path={data.filePath}
                  suffix={data.tool === "read" ? (lineRangeLabel(data.offset, data.limit) ?? data.lineRange) : undefined}
                  tokens={tokens}
                  compact={compact}
                  onReveal={revealFile}
                />
              ) : undefined
            }
            tokens={tokens}
            showLineNumbers={Boolean(data.code)}
            onRevealFile={revealFile}
            compact
          />
        ))}

      {data.tool === "edit" && (
        <SyntaxHighlightBlock
            bare
          code={data.diff || data.code || "// [Edit: diff applied]"}
          language="diff"
          filename={displayPath}
          filenameNode={
            data.filePath ? (
              <CodeHeaderPath path={data.filePath} tokens={tokens} compact={compact} onReveal={revealFile} />
            ) : undefined
          }
          tokens={tokens}
          showLineNumbers
          onRevealFile={revealFile}
          compact
        />
      )}

      {data.tool === "eval" && (
        <View style={styles.section}>
          {(
            data.cells ?? [
              { code: data.code || "", language: data.language || "typescript", output: data.output },
            ]
          ).map((cell, idx) => (
            <View key={idx} style={styles.section}>
              {cell.code ? (
                <SyntaxHighlightBlock
            bare
                  code={cell.code}
                  language={cell.language}
                  filename={cell.title || "Persistent Kernel Cell"}
                  tokens={tokens}
                  showLineNumbers
                  compact
                />
              ) : null}
              {cell.output ? (
                <View style={styles.terminalWindow}>
                  <Text style={styles.sectionTitle}>stdout</Text>
                  <Text selectable {...selectionCodeText} style={styles.terminalOutput}>
                    {renderTerminalOutput(cell.output, tokens)}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {data.tool === "ask" && data.askOptions && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {answered.length > 0 ? "Options offered" : "Waiting for a decision"}
          </Text>
          {data.askOptions.map((opt) => {
            // The answer is whatever the tool reported, so a label match
            // marks the chosen row. A typed reply matches nothing and is
            // shown on its own line below.
            const isChosen = answered.some(
              (answer) => answer.trim().toLowerCase() === opt.label.trim().toLowerCase(),
            );
            return (
              <View key={opt.id} style={[styles.askOption, isChosen && styles.askOptionChosen]}>
                <View style={styles.askOptionText}>
                  <View style={styles.inlineRow}>
                    <Text selectable style={[styles.askOptionLabel, isChosen && styles.strong]}>
                      {opt.label}
                    </Text>
                    {opt.recommended ? <Text style={styles.metaText}>recommended</Text> : null}
                  </View>
                  {opt.description ? (
                    <Text selectable style={styles.mutedText}>
                      {opt.description}
                    </Text>
                  ) : null}
                </View>
                <Glyph
                  name={isChosen ? "CheckCircle" : "Circle"}
                  size={14}
                  color={isChosen ? tokens.foreground : tokens.foregroundMuted}
                />
              </View>
            );
          })}
          {answered.length > 0 ? (
            <View style={styles.inlineRow}>
              <Text style={styles.sectionTitle}>{typedReply ? "typed" : "answered"}</Text>
              <Text selectable style={[styles.plainText, styles.strong]}>
                {answered.join(", ")}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {data.tool === "task" && data.subagent && (
        <SubagentBatch batch={data.subagent} running={isRunning} tokens={tokens} />
      )}
      {data.tool === "hub" && data.hub && <HubCallout data={data.hub} tokens={tokens} embedded />}
      {data.tool === "paseo" && data.paseo && <PaseoToolCallout data={data.paseo} tokens={tokens} />}

      {data.tool === "search" && data.search && (
        <View style={styles.section}>
          {data.search.files && data.search.files.length > 0 ? (
            <View>
              {data.search.files.slice(0, MAX_FILE_ROWS).map((file, index) => (
                <View key={`${index}:${file}`} style={styles.fileRow}>
                  <PathText path={file} tokens={tokens} compact={compact} style={{ fontSize: UI_SCALE.base }} fit />
                </View>
              ))}
              {data.search.files.length > MAX_FILE_ROWS ? (
                <Text style={styles.mutedText}>
                  {`+${data.search.files.length - MAX_FILE_ROWS} more`}
                </Text>
              ) : null}
            </View>
          ) : null}
          {data.search.webResults?.map((row, index) => (
            <View key={`${index}:${row.url}`} style={styles.webRow}>
              <Text selectable numberOfLines={1} style={styles.plainText}>
                {row.title}
              </Text>
              <Text selectable {...(codeSurface as object)} numberOfLines={1} style={[styles.monoText, styles.mutedColor]}>
                {row.url}
              </Text>
            </View>
          ))}
          {data.search.content ? (
            <View style={styles.terminalWindow}>
              <Text selectable {...selectionCodeText} style={styles.terminalOutput}>
                {renderTerminalOutput(data.search.content, tokens)}
              </Text>
            </View>
          ) : null}
          {!data.search.files && !data.search.webResults && !data.search.content ? (
            <Text style={styles.silentText}>{isRunning ? "Searching…" : "No results."}</Text>
          ) : null}
        </View>
      )}

      {data.tool === "fetch" && data.fetch && (
        <View style={styles.section}>
          <Text selectable {...(codeSurface as object)} style={styles.monoText}>
            {data.fetch.url}
          </Text>
          {data.fetch.prompt ? (
            <Text selectable style={styles.mutedText}>
              {data.fetch.prompt}
            </Text>
          ) : null}
          {data.fetch.result ? (
            <MarkdownView text={data.fetch.result} tokens={tokens} variant="compact" />
          ) : (
            <Text style={styles.silentText}>{isRunning ? "Fetching…" : "No content returned."}</Text>
          )}
        </View>
      )}

      {data.tool === "worktree_setup" && data.worktree && (
        <View style={styles.section}>
          {data.worktree.worktreePath ? (
            <PathText path={data.worktree.worktreePath} tokens={tokens} compact={compact} fit />
          ) : null}
          {data.worktree.branchName ? (
            <Text selectable {...(codeSurface as object)} style={[styles.monoText, styles.mutedColor]}>
              {data.worktree.branchName}
            </Text>
          ) : null}
          {data.worktree.commands.map((step) => (
            <View key={step.index} style={styles.terminalWindow}>
              <View style={styles.inlineRow}>
                <Text selectable {...(codeSurface as object)} style={[styles.monoText, styles.flex]} numberOfLines={2}>
                  {`$ ${step.command}`}
                </Text>
                {step.status === "running" ? <RunningDot color={tokens.accent} /> : null}
                {step.exitCode !== null && step.status !== "running" ? (
                  <Text style={[styles.metaText, step.exitCode !== 0 && { color: tokens.danger }]}>
                    {`exit ${step.exitCode}`}
                  </Text>
                ) : null}
              </View>
              {step.log ? (
                <Text selectable {...selectionCodeText} style={styles.terminalOutput}>
                  {renderTerminalOutput(step.log, tokens)}
                </Text>
              ) : null}
            </View>
          ))}
          {data.worktree.log ? (
            <View style={styles.terminalWindow}>
              <Text selectable {...selectionCodeText} style={styles.terminalOutput}>
                {renderTerminalOutput(data.worktree.log, tokens)}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {data.tool === "sub_agent" && data.subAgent && (
        <View style={styles.section}>
          {data.subAgent.description ? (
            <Text selectable style={styles.plainText}>
              {data.subAgent.description}
            </Text>
          ) : null}
          {data.subAgent.actions?.map((action) => (
            <View key={action.index} style={styles.inlineRow}>
              <Text selectable {...(codeSurface as object)} style={[styles.monoText, styles.mutedColor]}>
                {action.toolName}
              </Text>
              {action.summary ? (
                <Text selectable numberOfLines={1} style={[styles.plainText, styles.flex]}>
                  {action.summary}
                </Text>
              ) : null}
            </View>
          ))}
          {data.subAgent.log ? (
            <View style={styles.terminalWindow}>
              <Text selectable {...selectionCodeText} style={styles.terminalOutput}>
                {renderTerminalOutput(data.subAgent.log, tokens)}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {data.tool === "plan" &&
        (data.text ? (
          <MarkdownView text={data.text} tokens={tokens} variant="compact" />
        ) : (
          <Text style={styles.silentText}>The plan is empty.</Text>
        ))}

      {data.tool === "plain_text" &&
        (data.text ? (
          <Text selectable style={styles.plainText}>
            {data.text}
          </Text>
        ) : (
          <Text style={styles.silentText}>No text.</Text>
        ))}

      {data.tool === "unknown" && (
        <View style={styles.section}>
          {stringifyValue(data.input) ? (
            <>
              <Text style={styles.sectionTitle}>Input</Text>
              <SyntaxHighlightBlock code={stringifyValue(data.input) ?? ""} language="json" tokens={tokens} compact bare />
            </>
          ) : null}
          {data.output ? (
            <View style={styles.terminalWindow}>
              <Text selectable {...selectionCodeText} style={styles.terminalOutput}>
                {renderTerminalOutput(data.output, tokens)}
              </Text>
            </View>
          ) : (
            <Text style={styles.silentText}>
              {isRunning ? "Waiting for output…" : "The call returned no output."}
            </Text>
          )}
        </View>
      )}

      {!hasTypedBody && (
        <View style={styles.terminalWindow}>
          {data.output ? (
            <Text selectable {...selectionCodeText} style={styles.terminalOutput}>
              {renderTerminalOutput(data.output, tokens)}
            </Text>
          ) : (
            <Text selectable style={styles.silentText}>
              {isRunning ? "Waiting for output…" : "The call returned no output."}
            </Text>
          )}
        </View>
      )}
    </>
  );
}

interface BodyStyles {
  section: ViewStyle;
  inlineRow: ViewStyle;
  flex: ViewStyle;
  fileRow: ViewStyle;
  webRow: ViewStyle;
  terminalWindow: ViewStyle;
  askOption: ViewStyle;
  askOptionChosen: ViewStyle;
  askOptionText: ViewStyle;
  terminalOutput: TextStyle;
  commandLine: TextStyle;
  silentText: TextStyle;
  sectionTitle: TextStyle;
  plainText: TextStyle;
  mutedText: TextStyle;
  monoText: TextStyle;
  mutedColor: TextStyle;
  metaText: TextStyle;
  askOptionLabel: TextStyle;
  strong: TextStyle;
}

/** Body styles, built only once a card is opened. */
function useBodyStyles(tokens: ExtendedThemeTokens, compact: boolean): BodyStyles {
  return useMemo(
    () =>
      StyleSheet.create({
        section: { gap: 6 },
        inlineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
        flex: { flex: 1, minWidth: 0 },
        fileRow: { height: compact ? 28 : 24, justifyContent: "center" },
        webRow: { gap: 1 },
        // The opened body is already the code surface (S7 §3.1): command
        // output sits on it directly, with no inner panel.
        terminalWindow: {
          gap: space.xs,
        },
        askOption: {
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.sm,
          paddingVertical: 6,
          borderRadius: radiusV2.block,
        },
        askOptionChosen: { backgroundColor: tokens.v2.surface1 },
        askOptionText: { flex: 1, gap: 2 },
        terminalOutput: {
          fontFamily: tokens.fontMono,
          fontSize: tokens.typography.mono.size,
          lineHeight: tokens.typography.mono.lineHeight,
          color: tokens.foregroundMuted,
        },
        commandLine: {
          fontFamily: tokens.fontMono,
          fontSize: tokens.typography.mono.size,
          lineHeight: tokens.typography.mono.lineHeight,
          color: tokens.foreground,
        },
        silentText: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          color: tokens.foregroundMuted,
          fontStyle: "italic",
          ...unselectable,
        },
        sectionTitle: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          fontWeight: "500",
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        plainText: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.md,
          lineHeight: 19,
          color: tokens.foreground,
        },
        mutedText: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          lineHeight: 17,
          color: tokens.foregroundMuted,
        },
        monoText: {
          fontFamily: tokens.fontMono,
          fontSize: tokens.typography.mono.size,
          color: tokens.foreground,
        },
        mutedColor: { color: tokens.foregroundMuted },
        metaText: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          color: tokens.foregroundMuted,
          fontVariant: ["tabular-nums"],
          ...unselectable,
        },
        askOptionLabel: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.md,
          color: tokens.foreground,
        },
        strong: { fontWeight: "600" },
      }),
    [tokens, compact],
  );
}

/** The agent type always shows; the status only once the batch reports one. */
function SubagentChips({
  agent,
  tokens,
  styles,
}: {
  agent: { agentType: string; status?: string };
  tokens: ExtendedThemeTokens;
  styles: SubagentStyles;
}) {
  const status = agent.status;
  // Status reads as coloured text, never a filled badge (plan §3.6).
  const color =
    status === "failed" ? tokens.danger : status === "running" ? tokens.accent : tokens.foregroundMuted;
  return (
    <>
      <Text selectable style={styles.chip}>
        {agent.agentType}
      </Text>
      {status ? (
        <Text selectable style={[styles.chip, { color }]}>
          {status}
        </Text>
      ) : null}
    </>
  );
}

/**
 * One `task` call spawns a batch, so the card reads as a roster: one row per
 * brief, every brief clamped to two lines, and the shared preamble folded away
 * until it is asked for. A brief runs to hundreds of words, and six of them
 * printed whole would bury the rest of the transcript.
 */
function SubagentBatch({
  batch,
  running,
  tokens,
}: {
  batch: NonNullable<ToolCallView["subagent"]>;
  running: boolean;
  tokens: ExtendedThemeTokens;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const styles = useSubagentStyles(tokens);

  const agents = batch.agents;
  const count = agents.length;
  // A batch of one is a single delegation rather than a list, so its name
  // leads and the row below carries the brief on its own.
  const only = count === 1 ? agents[0] : undefined;
  const headline = only ? only.name : count === 0 ? "subagents" : `${count} subagents`;
  const pending =
    count === 0
      ? "spawning subagents…"
      : count === 1
        ? "spawning 1 subagent…"
        : `spawning ${count} subagents…`;

  return (
    <View style={styles.batch}>
      <View style={styles.head}>
        <Text selectable style={styles.headline} numberOfLines={1}>
          {headline}
        </Text>
        {only ? <SubagentChips agent={only} tokens={tokens} styles={styles} /> : null}
      </View>

      {batch.context ? (
        <View style={styles.contextBox}>
          <Pressable
            onPress={() => setContextOpen((previous) => !previous)}
            accessibilityRole="button"
            accessibilityState={{ expanded: contextOpen }}
            style={styles.contextToggle}
          >
            <Glyph
              name={contextOpen ? "ChevronDown" : "ChevronRight"}
              size={12}
              color={tokens.foregroundMuted}
            />
            <Text style={styles.contextLabel}>shared context</Text>
          </Pressable>
          <Text selectable style={styles.contextBody} numberOfLines={contextOpen ? undefined : 2}>
            {batch.context}
          </Text>
        </View>
      ) : null}

      {agents.map((agent, index) => (
        <View key={`${agent.name}-${index}`} style={styles.row}>
          {only ? null : (
            <View style={styles.rowHead}>
              <Text selectable style={styles.name} numberOfLines={1}>
                {agent.name}
              </Text>
              <SubagentChips agent={agent} tokens={tokens} styles={styles} />
            </View>
          )}
          <Text selectable style={styles.brief} numberOfLines={2}>
            {agent.task}
          </Text>
        </View>
      ))}

      {running ? (
        <View style={styles.pending}>
          <RunningDot color={tokens.accent} />
          <Text style={styles.pendingText}>{pending}</Text>
        </View>
      ) : null}
    </View>
  );
}

interface SubagentStyles {
  batch: ViewStyle;
  head: ViewStyle;
  contextBox: ViewStyle;
  contextToggle: ViewStyle;
  row: ViewStyle;
  rowHead: ViewStyle;
  pending: ViewStyle;
  headline: TextStyle;
  chip: TextStyle;
  contextLabel: TextStyle;
  contextBody: TextStyle;
  name: TextStyle;
  brief: TextStyle;
  pendingText: TextStyle;
}

function useSubagentStyles(tokens: ExtendedThemeTokens): SubagentStyles {
  return useMemo(
    () =>
      StyleSheet.create({
        // No frame of its own: the expanded tool card is the only border.
        batch: { gap: space.sm },
        head: { flexDirection: "row", alignItems: "center", gap: 6 },
        headline: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.md,
          fontWeight: "600",
          color: tokens.foreground,
          flexShrink: 1,
        },
        chip: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          color: tokens.foregroundMuted,
        },
        contextBox: {
          gap: space.xs,
          padding: space.sm,
          borderRadius: radiusV2.block,
          backgroundColor: tokens.v2.surface1,
        },
        contextToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
        contextLabel: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          fontWeight: "500",
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        contextBody: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          lineHeight: 17,
          color: tokens.foregroundMuted,
        },
        row: { gap: 3 },
        rowHead: { flexDirection: "row", alignItems: "center", gap: 6 },
        name: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.md,
          fontWeight: "600",
          color: tokens.foreground,
          flexShrink: 1,
        },
        brief: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          lineHeight: 16,
          color: tokens.foregroundMuted,
        },
        pending: { flexDirection: "row", alignItems: "center", gap: 6 },
        pendingText: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.base,
          fontWeight: "500",
          color: tokens.accent,
          ...unselectable,
        },
      }),
    [tokens],
  );
}
