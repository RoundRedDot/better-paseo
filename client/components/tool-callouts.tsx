import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, View, Text, Pressable, Platform, StyleSheet } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { Glyph } from "./glyph";
import { surfaceProps } from "./view-props";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { HubCallout } from "./hub-callout";
import { PaseoToolCallout } from "./paseo-tool-callouts";
import { SyntaxHighlightBlock, renderTerminalOutput } from "./syntax-highlight";
import { ImagePreview } from "./image-preview";
import { GitHubBody } from "./github-body";
import { MarkdownView } from "./markdown/markdown-view";
import { ReasoningSections } from "./reasoning-trace";
import { isImagePath } from "../image-file";
import type { ImageFile } from "../image-file";
import { selectableSurface, unselectable } from "./selection";
import { selectionCodeText, selectionSurface } from "./selection-actions";
import { DISCLOSURE_HEADER, DisclosureHeader } from "../ui/disclosure-header";
import { PathContext, PathText } from "../ui/path-text";
import { RunningDot } from "../ui/running-dot";
import { CopyButton } from "../ui/copy-button";
import { ActionMenuList, ActionMenuTrigger, useActionMenu, type ActionMenuItem } from "../ui/action-menu";
import { useCopy } from "../ui/use-copy";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { useReducedMotion } from "../ui/use-reduced-motion";
import { duration, easing } from "../ui/tokens/motion";
import { formatPath } from "../paths/format-path";
import { summarizeTool } from "../tools/summarize";
import { toolCopyPlan } from "../tools/copy";
import { stringifyValue, type ToolCallView, type ToolKind } from "../tools/classify";

/** The muted icon a settled call shows in the header's status slot. */
function toolIconName(tool: ToolKind): string {
  switch (tool) {
    case "git":
    case "worktree_setup":
      return "GitBranch";
    case "github":
      return "GitHub";
    case "paseo":
      return "Paseo";
    case "bash":
    case "shell":
      return "Terminal";
    case "read":
      return "BookOpen";
    case "edit":
    case "write":
      return "Pencil";
    case "thinking":
      return "Brain";
    case "eval":
      return "Play";
    case "ask":
      return "HelpCircle";
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

  // Hover actions on web are tracked here rather than by DisclosureHeader:
  // React Native Web's Pressable contains hover, so the header button inside
  // ends the outer row's hover the moment the pointer enters it, and the
  // header's own overlay never shows. DOM mouseenter/leave on a plain View
  // do not bubble and track the whole row, overlay included.
  const webHover = Platform.OS === "web" && capabilities.hover;
  const [rowHovered, setRowHovered] = useState(false);
  const webHoverProps = useMemo(
    () =>
      webHover
        ? { onMouseEnter: () => setRowHovered(true), onMouseLeave: () => setRowHovered(false) }
        : undefined,
    [webHover],
  );

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
  const failed = data.status === "failed";
  const statusIcon = running ? (
    <RunningDot color={tokens.accent} />
  ) : failed ? (
    <Glyph name="X" size={14} color={tokens.danger} />
  ) : (
    <Glyph name={toolIconName(data.tool)} size={14} color={tokens.foregroundMuted} />
  );

  const target =
    summary.targetIsPath && summary.target ? (
      <PathText path={summary.target} tokens={tokens} compact={compact} copyOnHover={false} />
    ) : (
      summary.target
    );
  // The meta is drawn here, not as strings, so the web hover overlay can
  // hide it (opacity only: nothing moves) the way the header would itself.
  const metaHidden = webHover && (rowHovered || menu.open);
  const metaColor = summary.tone === "danger" ? tokens.danger : tokens.foregroundMuted;
  const meta =
    summary.metaPath || summary.meta.length > 0
      ? [
          <View key="meta" style={[styles.meta, metaHidden && styles.hidden]}>
            {summary.metaPath ? (
              <MetaPath path={summary.metaPath} tokens={tokens} compact={compact} />
            ) : null}
            {summary.meta.map((entry, index) => (
              <Text
                key={index}
                selectable={false}
                numberOfLines={1}
                style={[styles.metaText, unselectable, { color: metaColor, fontFamily: tokens.fontUi }]}
              >
                {entry}
              </Text>
            ))}
          </View>,
        ]
      : undefined;

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

  return (
    <View
      {...surfaceProps(selectionSurface)}
      style={[
        styles.frame,
        expanded && { borderColor: tokens.v2.border, backgroundColor: tokens.v2.surface0 },
      ]}
    >
      <View
        {...(webHoverProps as object)}
        style={[styles.headerWrap, rowHovered && { backgroundColor: tokens.v2.surface1 }]}
      >
        <DisclosureHeader
          expanded={expanded}
          onToggle={onToggle}
          tokens={tokens}
          compact={compact}
          icon={statusIcon}
          verb={summary.verb}
          target={target}
          meta={meta}
          tone={summary.tone}
          actions={webHover ? undefined : actions}
          onLongPress={capabilities.touch ? onLongPress : undefined}
          accessibilityLabel={[summary.verb, summary.target, ...summary.meta].filter(Boolean).join(" ")}
        />
        {webHover && (rowHovered || menu.open) ? (
          <View style={[styles.hoverActions, { backgroundColor: tokens.v2.surface1 }]}>{actions}</View>
        ) : null}
      </View>
      {summary.errorLine ? (
        <Text
          selectable
          numberOfLines={1}
          style={[styles.errorLine, { color: tokens.danger, fontFamily: tokens.fontUi }]}
        >
          {summary.errorLine}
        </Text>
      ) : null}
      <ActionMenuList items={menuItems} open={menu.open} onClose={menu.close} tokens={tokens} compact={compact} />
      {expanded ? (
        <FadeIn style={[styles.body, { borderTopColor: tokens.v2.borderSubtle }]}>
          <ToolBody
            data={data}
            tokens={tokens}
            compact={compact}
            imageFile={imageFile}
            revealFile={revealFile}
            displayPath={filePath ? formatPath(filePath, pathContext).displayPath : undefined}
          />
        </FadeIn>
      ) : null}
    </View>
  );
}

/**
 * A path among the header's meta (a shell's cwd, a worktree's directory).
 * The workspace root itself says nothing, so it is left out.
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
  const shown = useMemo(() => formatPath(path, context).displayPath, [path, context]);
  if (shown === "./" || shown === ".") return null;
  return (
    <PathText
      path={path}
      tokens={tokens}
      compact={compact}
      copyOnHover={false}
      budget={compact ? 20 : 32}
      style={{ fontSize: 12, color: tokens.foregroundMuted }}
    />
  );
}

/** The expand fade (plan §3.7): opacity 0 → 1 over 120 ms; none under reduced motion. */
function FadeIn({ style, children }: { style: ViewStyle | ViewStyle[]; children: React.ReactNode }) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      return;
    }
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: duration.fast,
      easing: easing.out,
      useNativeDriver: Platform.OS !== "web",
    });
    fade.start();
    return () => fade.stop();
  }, [opacity, reducedMotion]);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  // A transparent border while collapsed keeps the header from moving by a
  // pixel when the frame appears.
  frame: {
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: radiusV2.card,
    overflow: "hidden",
    ...selectableSurface,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: DISCLOSURE_HEADER.gap,
  },
  metaText: {
    fontSize: DISCLOSURE_HEADER.meta,
    fontVariant: ["tabular-nums"],
  },
  hidden: {
    opacity: 0,
  },
  headerWrap: {
    position: "relative",
    borderRadius: radiusV2.block,
  },
  // Laid over the meta, clear of the chevron, so revealing it moves nothing
  // (plan §3.8): header padding + chevron + gap from the right edge.
  hoverActions: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: DISCLOSURE_HEADER.paddingX + DISCLOSURE_HEADER.chevron + DISCLOSURE_HEADER.gap,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingLeft: space.xs,
  },
  errorLine: {
    fontSize: 12,
    lineHeight: 16,
    // Under the verb: header padding + icon slot + gap.
    paddingLeft: space.sm + 16 + 6,
    paddingRight: space.sm,
    paddingBottom: space.xs,
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: space.sm,
    gap: space.sm,
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
function ToolBody({ data, tokens, compact, imageFile, revealFile, displayPath }: ToolBodyProps) {
  const styles = useBodyStyles(tokens);
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
            <Text selectable {...selectionCodeText} style={styles.terminalOutput}>
              {renderTerminalOutput(data.shell.stdout, tokens)}
            </Text>
          ) : null}
          {data.shell?.stderr ? (
            <Text selectable style={[styles.terminalOutput, { color: tokens.danger }]}>
              {data.shell.stderr}
            </Text>
          ) : null}
          {data.output && !data.shell?.stdout ? (
            <Text selectable {...selectionCodeText} style={styles.terminalOutput}>
              {renderTerminalOutput(data.output, tokens)}
            </Text>
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
            code={JSON.stringify(data.mcp.arguments, null, 2)}
            language="json"
            tokens={tokens}
            compact
          />
          {data.mcp.result !== undefined && (
            <>
              <Text style={styles.sectionTitle}>Response</Text>
              <SyntaxHighlightBlock
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
            code={data.code || "// [Empty content or pending stream]"}
            language={data.language ?? "text"}
            // TODO(S2): pass `filenameNode={<PathText path=… />}` with the
            // `L10–80` suffix once SyntaxHighlightBlock takes one. Until then
            // `filename` is the relative path alone: the block reads the file
            // extension from its end, so a suffix would break highlighting.
            filename={displayPath}
            tokens={tokens}
            showLineNumbers={Boolean(data.code)}
            onRevealFile={revealFile}
            compact
          />
        ))}

      {data.tool === "edit" && (
        <SyntaxHighlightBlock
          code={data.diff || data.code || "// [Edit: diff applied]"}
          language="diff"
          filename={displayPath}
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
                  <PathText path={file} tokens={tokens} compact={compact} style={{ fontSize: 12 }} />
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
              <Text selectable numberOfLines={1} style={[styles.monoText, styles.mutedColor]}>
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
          <Text selectable style={styles.monoText}>
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
          <View style={styles.inlineRow}>
            {data.worktree.worktreePath ? (
              <PathText path={data.worktree.worktreePath} tokens={tokens} compact={compact} />
            ) : null}
            {data.worktree.branchName ? (
              <Text selectable style={[styles.monoText, styles.mutedColor]}>
                {data.worktree.branchName}
              </Text>
            ) : null}
          </View>
          {data.worktree.commands.map((step) => (
            <View key={step.index} style={styles.terminalWindow}>
              <View style={styles.inlineRow}>
                <Text selectable style={[styles.monoText, styles.flex]} numberOfLines={2}>
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
              <Text selectable style={[styles.monoText, styles.mutedColor]}>
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
              <SyntaxHighlightBlock code={stringifyValue(data.input) ?? ""} language="json" tokens={tokens} compact />
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
function useBodyStyles(tokens: ExtendedThemeTokens): BodyStyles {
  return useMemo(
    () =>
      StyleSheet.create({
        section: { gap: 6 },
        inlineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
        flex: { flex: 1, minWidth: 0 },
        fileRow: { height: 24, justifyContent: "center" },
        webRow: { gap: 1 },
        // Code-surface blocks inside a card: radius 6, no border, no shadow.
        terminalWindow: {
          borderRadius: radiusV2.block,
          backgroundColor: tokens.v2.surfaceCode,
          padding: space.sm,
          gap: 6,
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
          fontSize: 11.5,
          lineHeight: 17,
          color: tokens.foregroundMuted,
        },
        commandLine: {
          fontFamily: tokens.fontMono,
          fontSize: 12,
          lineHeight: 18,
          color: tokens.foreground,
        },
        silentText: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          color: tokens.foregroundMuted,
          fontStyle: "italic",
          ...unselectable,
        },
        sectionTitle: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          fontWeight: "500",
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        plainText: {
          fontFamily: tokens.fontUi,
          fontSize: 13,
          lineHeight: 19,
          color: tokens.foreground,
        },
        mutedText: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          lineHeight: 17,
          color: tokens.foregroundMuted,
        },
        monoText: {
          fontFamily: tokens.fontMono,
          fontSize: 12,
          color: tokens.foreground,
        },
        mutedColor: { color: tokens.foregroundMuted },
        metaText: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          color: tokens.foregroundMuted,
          fontVariant: ["tabular-nums"],
          ...unselectable,
        },
        askOptionLabel: {
          fontFamily: tokens.fontUi,
          fontSize: 13,
          color: tokens.foreground,
        },
        strong: { fontWeight: "600" },
      }),
    [tokens],
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
          fontSize: 13,
          fontWeight: "600",
          color: tokens.foreground,
          flexShrink: 1,
        },
        chip: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          color: tokens.foregroundMuted,
        },
        contextBox: {
          gap: 4,
          padding: space.sm,
          borderRadius: radiusV2.block,
          backgroundColor: tokens.v2.surface1,
        },
        contextToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
        contextLabel: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          fontWeight: "500",
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        contextBody: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          lineHeight: 17,
          color: tokens.foregroundMuted,
        },
        row: { gap: 3 },
        rowHead: { flexDirection: "row", alignItems: "center", gap: 6 },
        name: {
          fontFamily: tokens.fontUi,
          fontSize: 12.5,
          fontWeight: "600",
          color: tokens.foreground,
          flexShrink: 1,
        },
        brief: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          lineHeight: 16,
          color: tokens.foregroundMuted,
        },
        pending: { flexDirection: "row", alignItems: "center", gap: 6 },
        pendingText: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          fontWeight: "500",
          color: tokens.accent,
          ...unselectable,
        },
      }),
    [tokens],
  );
}
