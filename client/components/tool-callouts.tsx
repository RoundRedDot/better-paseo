import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { Glyph } from "./glyph";
import { surfaceProps } from "./view-props";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { HubCallout } from "./hub-callout";
import { PaseoToolCallout } from "./paseo-tool-callouts";
import { SyntaxHighlightBlock, TerminalOutput, renderTerminalLine, renderTerminalOutput, terminalLines } from "./syntax-highlight";
import { ImagePreview } from "./image-preview";
import { ImageViewer } from "./image-viewer";
import { GitHubBody } from "./github-body";
import { MarkdownView } from "./markdown/markdown-view";
import { ReasoningSections } from "./reasoning-trace";
import { isImagePath } from "../image-file";
import type { ImageFile } from "../image-file";
import { selectableSurface, unselectable } from "./selection";
import { selectionCodeText, selectionSurface } from "./selection-actions";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { DISCLOSURE_HEADER, DisclosureHeader, RowIcon, RowPaletteContext, RowText } from "../ui/disclosure-header";
import { STICKY_SUPPORTED, StickyCard } from "../ui/sticky-header";
import { useScrollAnchor } from "../ui/scroll-anchor";
import { PathContext, PathText } from "../ui/path-text";
import { RunningDot } from "../ui/running-dot";
import { exitMark, parseExitMeta } from "../ui/exit-mark";
import { useCopy } from "../ui/use-copy";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { HoverPreviewBody, HoverPreviewHeader } from "../ui/hover-preview";
import { PreviewLines } from "../ui/preview-lines";
import { FadeIn } from "../ui/fade-in";
import { SelectableSpan, SelectableText } from "../ui/prose-text";
import { formatPath } from "../paths/format-path";
import { lineRangeLabel, summarizeTool } from "../tools/summarize";
import { TYPE, UI_SCALE } from "../ui/tokens/typography";
import { codeSurface } from "./host-font-escape";
import { toolCopyPlan, type ResolvePath } from "../tools/copy";
import type { CopyAction, CopyActionId, CopyPlan } from "../copy/content";
import { ToolbarButton, ToolbarCopyButton, TooltipAlignContext } from "../ui/toolbar-button";
import { stringifyValue, type ToolCallView, type ToolKind } from "../tools/classify";
import { summarizeToolCall, summarizeToolGroup } from "../tools/group";

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
export { RowIcon };

/** `exit 1`, `failed`: the meta entries a failure colours (S7: only these and the icon turn danger). */
const FAILURE_META = /^(exit [1-9]\d*|failed|error|timed out)$/;

/**
 * `+12 −3`: the diff counts, as success and danger spans of the meta Text,
 * quieted with the row at rest.
 */
function diffCountSpans(entry: string): React.ReactNode {
  const match = /^\+(\d+) \u2212(\d+)$/.exec(entry);
  if (!match) return entry;
  return (
    <>
      <RowText part="diffAdd">{`+${match[1]}`}</RowText>
      {" "}
      <RowText part="diffDel">{`−${match[2]}`}</RowText>
    </>
  );
}

interface ToolCalloutProps {
  data: ToolCallView;
  /** Consecutive calls sharing this file-operation header, in timeline order. */
  groupCalls?: readonly ToolCallView[];
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
  /**
   * Asks for the image: the row's preview opened, or a long press on a phone
   * wants the viewer. The live renderer reads an image only for an open card
   * or after this, so this is where a collapsed read asks for it.
   */
  requestImage?(): void;
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
  groupCalls,
  tokens,
  compact = false,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  onRevealPath,
  imageFile,
  requestImage,
}: ToolCalloutProps) {
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ?? localExpanded;
  const setExpanded = onExpandedChange ?? setLocalExpanded;
  const onToggle = useCallback(() => setExpanded(!expanded), [setExpanded, expanded]);
  // Owned here, not by the row: an opened card moves the row into `StickyCard`.
  const scrollAnchor = useScrollAnchor(expanded);

  const summary = useMemo(() => groupCalls ? summarizeToolGroup(groupCalls) : summarizeTool(data), [data, groupCalls]);
  const pathContext = useContext(PathContext);
  const capabilities = useInputCapabilities(compact);
  const touchFirst = capabilities.touch && !capabilities.hover;
  const { copy } = useCopy();

  const resolvePath = useCallback(
    (path: string) => formatPath(path, pathContext).absolutePath,
    [pathContext],
  );
  // Built on demand: a running shell's output is stripped of ANSI only when
  // someone actually copies it, not on every chunk.
  const onLongPress = useCallback(() => {
    const primary = toolCopyPlan(data, resolvePath).primary;
    if (primary) void copy(primary.text, { feedback: "toast", label: primary.label });
  }, [data, resolvePath, copy]);

  const running = groupCalls ? groupCalls.some((call) => call.status === "running") : data.status === "running";
  const failed = data.status === "failed" || summary.tone === "danger";
  // A finished call steps behind the prose; a question still waiting for the
  // reader does not.
  const tone = running ? (data.tool === "ask" ? "loud" : "active") : "quiet";
  const statusIcon = running ? (
    <RunningDot color={tokens.accent} />
  ) : (
    <RowIcon name={toolIconName(data.tool)} color={failed ? tokens.danger : undefined} />
  );

  const target =
    summary.targetIsPath && summary.target ? (
      <PathText
        path={summary.target}
        tokens={tokens}
        compact={compact}
        copyOnHover={false}
        fit={!groupCalls}
        grow={!groupCalls}
        style={compact ? TARGET_STYLE.compact : TARGET_STYLE.desktop}
      />
    ) : (
      summary.target
    );
  const meta = summary.meta.map((entry) => {
    const exitCode = parseExitMeta(entry);
    const shown = exitCode === undefined ? diffCountSpans(entry) : exitMark(exitCode);
    return failed && FAILURE_META.test(entry) ? <Text style={{ color: tokens.danger }}>{shown}</Text> : shown;
  });
  const metaLead = summary.metaPath ? (
    <MetaPath path={summary.metaPath} tokens={tokens} compact={compact} />
  ) : undefined;

  // Mounted only while the row shows its actions, so the plan is built then.
  const actions = <ToolCopyButtons call={data} resolvePath={resolvePath} tokens={tokens} />;

  // A read of an image is drawn as the picture, which has no lines to wrap.
  const drawsImage =
    (data.tool === "read" || data.tool === "write") && imageFile !== undefined && isImagePath(data.filePath);

  // A path in the body reveals the file on a pointer device; on touch it
  // copies, because `file.reveal` would open a window on the daemon's machine.
  const filePath = data.filePath;
  const reveal = onRevealPath ?? pathContext.reveal;
  const revealFile = useMemo(() => {
    if (!filePath) return undefined;
    const absolutePath = resolvePath(filePath);
    if (touchFirst) return () => void copy(absolutePath, { feedback: "toast", label: "Copy path" });
    return reveal ? () => reveal(absolutePath) : undefined;
  }, [filePath, resolvePath, touchFirst, copy, reveal]);
  const displayPath = filePath ? formatPath(filePath, pathContext).displayPath : undefined;

  // On a phone a long press on an image read opens the picture in the viewer,
  // as a press on the picture does, rather than a preview of the card. The
  // bytes may not be read yet; the viewer opens once they arrive.
  const viewsImage = drawsImage && capabilities.native;
  const [viewerWanted, setViewerWanted] = useState(false);
  const toast = useToast();
  const openViewer = useCallback(() => {
    requestImage?.();
    setViewerWanted(true);
  }, [requestImage]);
  const closeViewer = useCallback(() => setViewerWanted(false), []);
  const unreadable = viewerWanted && imageFile ? imageFile.dataUri === null : false;
  useEffect(() => {
    if (!unreadable) return;
    setViewerWanted(false);
    toast.error(imageFile?.error ?? "The image could not be read.");
  }, [unreadable, imageFile, toast]);
  const viewer = viewerWanted && imageFile?.dataUri ? (
    <ImageViewer
      open={viewerWanted}
      onClose={closeViewer}
      uri={imageFile.dataUri}
      width={imageFile.width}
      height={imageFile.height}
      label={filePath ?? ""}
      tokens={tokens}
      onReveal={revealFile}
    />
  ) : null;

  // No frame (S7 design spec §3.1): the row, then — only when there is one —
  // the error line, the copy menu and the opened body as its siblings. A
  // collapsed call is the row alone, and the row keeps its place in the tree
  // when the body opens, so hover and press state survive the toggle.
  const header = (
    <DisclosureHeader
      expanded={expanded}
      onToggle={onToggle}
      scrollAnchor={scrollAnchor}
      tokens={tokens}
      compact={compact}
      tone={tone}
      icon={statusIcon}
      iconIsStatus={running || failed}
      verb={summary.verb}
      target={target}
      count={groupCalls?.length}
      meta={meta}
      metaLead={metaLead}
      actions={actions}
      onLongPress={viewsImage ? openViewer : capabilities.touch ? onLongPress : undefined}
      accessibilityLabel={[summary.verb, summary.target, ...summary.meta].filter(Boolean).join(" ")}
      onPreviewOpen={requestImage}
      previewWraps={!drawsImage}
      pressPreview={!viewsImage}
      previewContent={() => (
        groupCalls ? (
          <GroupedPreview calls={groupCalls} resolvePath={resolvePath} tokens={tokens} compact={compact} imageFile={imageFile}
            path={filePath ? resolvePath(filePath) : undefined} revealFile={revealFile} displayPath={displayPath} onViewImage={openViewer} />
        ) : (
          <>
            <ToolPreviewActions call={data} resolvePath={resolvePath} tokens={tokens} />
            <HoverPreviewBody>
              {filePath ? <SelectableText {...selectionCodeText} style={{ color: tokens.foreground, fontFamily: tokens.fontMono }}>{resolvePath(filePath)}</SelectableText> : null}
              <ToolBody data={data} tokens={tokens} compact={compact} imageFile={imageFile}
                revealFile={revealFile} displayPath={displayPath} preview onViewImage={openViewer} />
              {data.error ? <PreviewError text={data.error} tokens={tokens} /> : null}
            </HoverPreviewBody>
          </>
        )
      )}
    />
  );
  const body = expanded ? (
    <FadeIn style={[styles.body, { backgroundColor: tokens.row.outputBg }]}>
      <View {...surfaceProps(selectionSurface)} style={styles.bodyInner}>
        {groupCalls ? (
          <GroupedToolDetails calls={groupCalls} tokens={tokens} compact={compact} imageFile={imageFile}
            revealFile={revealFile} displayPath={displayPath} />
        ) : (
          <ToolBody
            data={data}
            tokens={tokens}
            compact={compact}
            imageFile={imageFile}
            revealFile={revealFile}
            displayPath={displayPath}
          />
        )}
      </View>
    </FadeIn>
  ) : null;

  // An opened card on a host with the sticky header API pins its row while it
  // scrolls past (S6). Collapsed rows never reach the hook.
  if (expanded && STICKY_SUPPORTED) {
    return (
      <StickyCard tokens={tokens} compact={compact} header={header}>
        {viewer}
        {body}
      </StickyCard>
    );
  }

  return (
    <>
      {header}
      {viewer}
      {summary.errorLine && !expanded ? (
        <Text
          {...(surfaceProps(selectionSurface, codeSurface) as object)}
          selectable
          numberOfLines={1}
          style={[styles.errorLine, { color: tokens.row.meta, fontFamily: tokens.fontMono }]}
        >
          {summary.errorLine}
        </Text>
      ) : null}
      {body}
    </>
  );
}

/**
 * The page of a merged row on view: one call at a time, in timeline order.
 * It stays in range when the run shrinks.
 */
function useGroupPage(count: number): [number, (index: number) => void] {
  const [index, setIndex] = useState(0);
  return [Math.min(index, count - 1), setIndex];
}

interface GroupedBodyProps {
  calls: readonly ToolCallView[];
  tokens: ExtendedThemeTokens;
  compact: boolean;
  imageFile?: ImageFile | null;
  revealFile?: () => void;
  displayPath?: string;
}

/** An opened merged row: the pager, then the body of the call on view. */
function GroupedToolDetails({ calls, ...rest }: GroupedBodyProps) {
  const [index, setIndex] = useGroupPage(calls.length);
  return (
    <>
      {/* At the body's left edge: names open rightwards. */}
      <TooltipAlignContext.Provider value="start">
        <GroupPager index={index} count={calls.length} onChange={setIndex} tokens={rest.tokens} />
      </TooltipAlignContext.Provider>
      <GroupedCallBody key={calls[index]!.callId} call={calls[index]!} {...rest} />
    </>
  );
}

/** A merged row's preview: the pager sits in the panel's toolbar, so it stays put while the body scrolls. */
function GroupedPreview({ calls, resolvePath, path, onViewImage, ...rest }: GroupedBodyProps & {
  resolvePath: ResolvePath;
  path?: string;
  onViewImage(): void;
}) {
  const [index, setIndex] = useGroupPage(calls.length);
  const { tokens } = rest;
  return (
    <>
      <ToolPreviewActions call={calls[index]!} resolvePath={resolvePath} tokens={tokens}
        pager={<GroupPager index={index} count={calls.length} onChange={setIndex} tokens={tokens} />} />
      <HoverPreviewBody>
        {path ? <SelectableText {...selectionCodeText} style={{ color: tokens.foreground, fontFamily: tokens.fontMono }}>{path}</SelectableText> : null}
        <GroupedCallBody key={calls[index]!.callId} call={calls[index]!} {...rest} preview onViewImage={onViewImage} />
      </HoverPreviewBody>
    </>
  );
}

/** Keyed by call at the call site, so a page's own state (folded lines) does not carry over to the next. */
function GroupedCallBody({ call, preview, onViewImage, ...rest }: Omit<GroupedBodyProps, "calls"> & {
  call: ToolCallView;
  preview?: boolean;
  onViewImage?: () => void;
}) {
  const errorLine = summarizeToolCall(call).errorLine;
  return (
    <>
      <ToolBody data={call} {...rest} preview={preview} onViewImage={onViewImage} />
      {errorLine ? preview ? <PreviewError text={call.error ?? errorLine} tokens={rest.tokens} /> :
        <SelectableText style={{ color: rest.tokens.danger, fontFamily: rest.tokens.fontMono }}>
          {call.error ?? errorLine}
        </SelectableText> : null}
    </>
  );
}

/** `‹ 2 / 3 ›`: steps through a merged row's calls; an arrow at either end is dimmed and inert. */
function GroupPager({ index, count, onChange, tokens }: {
  index: number;
  count: number;
  onChange(index: number): void;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <View style={styles.pager}>
      <ToolbarButton icon="ChevronLeft" label="Previous operation" disabled={index === 0}
        onPress={() => onChange(index - 1)} tokens={tokens} />
      <Text selectable={false} style={[styles.pagerLabel, unselectable, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
        {`${index + 1} / ${count}`}
      </Text>
      <ToolbarButton icon="ChevronRight" label="Next operation" disabled={index === count - 1}
        onPress={() => onChange(index + 1)} tokens={tokens} />
    </View>
  );
}

/** Each copy a toolbar offers has its own icon, so two copies side by side are told apart. */
const COPY_ICON: Record<CopyActionId, string> = {
  path: "Link",
  url: "Link",
  command: "SquareTerminal",
  "command-output": "ClipboardList",
  query: "Search",
  files: "List",
  patch: "FileDiff",
  args: "Braces",
  code: "Code",
  log: "ScrollText",
  description: "MessageSquareText",
  question: "CircleHelp",
  // The body itself: what the reader most often wants, under the plain copy icon.
  content: "Copy",
  "new-content": "Copy",
  output: "Copy",
  result: "Copy",
  text: "Copy",
  answer: "Copy",
};

/**
 * A call's copies as one row of buttons: the header's own object first, then
 * the rest of the plan. An entry with the same id or text as an earlier one
 * is dropped, so no two buttons copy the same thing.
 */
export function previewCopyActions(plan: CopyPlan): CopyAction[] {
  const seen = new Set<string>();
  return [plan.primary, ...plan.menu].filter((action): action is CopyAction => {
    if (!action || seen.has(action.id) || seen.has(`text:${action.text}`)) return false;
    seen.add(action.id);
    seen.add(`text:${action.text}`);
    return true;
  });
}

/**
 * Every copy of a call as a row of buttons, the same on the row's header and
 * in its preview's toolbar. A merged row's header offers its first call's,
 * as its preview opens on that call.
 */
function ToolCopyButtons({ call, resolvePath, tokens }: {
  call: ToolCallView;
  resolvePath: ResolvePath;
  tokens: ExtendedThemeTokens;
}) {
  const actions = useMemo(() => previewCopyActions(toolCopyPlan(call, resolvePath)), [call, resolvePath]);
  return (
    <>
      {actions.map((action) => (
        <ToolbarCopyButton key={action.id} text={action.text} icon={COPY_ICON[action.id]} label={action.label} tokens={tokens} />
      ))}
    </>
  );
}

/** The preview's toolbar: a merged row's pager in the middle, every copy of the call on view as a button. */
function ToolPreviewActions({ call, resolvePath, tokens, pager }: {
  call: ToolCallView;
  resolvePath: ResolvePath;
  tokens: ExtendedThemeTokens;
  /** A merged row's pager, centred in the toolbar. */
  pager?: React.ReactNode;
}) {
  return (
    <HoverPreviewHeader tokens={tokens} center={pager}>
      <View style={styles.previewActions}>
        <ToolCopyButtons call={call} resolvePath={resolvePath} tokens={tokens} />
      </View>
    </HoverPreviewHeader>
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
  const palette = useContext(RowPaletteContext);
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
      style={{ fontSize: TYPE.meta.size, color: palette?.meta ?? tokens.foregroundMuted }}
    />
  );
}

const styles = StyleSheet.create({
  // Above the body after it, so a button's name hangs over the code header.
  pager: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", zIndex: 1 },
  pagerLabel: { fontSize: TYPE.caption.size, minWidth: 36, textAlign: "center", fontVariant: ["tabular-nums"] },
  previewActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: space.xs,
  },
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
  // Nothing clips it: the padding keeps its content off the rounded corners,
  // and a path's hover tooltip has to rise out over the row above.
  body: {
    marginTop: 2,
    marginBottom: 6,
    borderRadius: radiusV2.block,
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
  preview?: boolean;
  /** Opens the full-screen viewer for an image drawn in a preview panel. */
  onViewImage?: () => void;
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

/** A file or diff in a preview, line by line as the file has it. */
function PreviewFile({ text, ...rest }: Omit<React.ComponentProps<typeof PreviewLines>, "lines">) {
  const lines = useMemo(() => text.replace(/\n+$/, "").split("\n"), [text]);
  return <PreviewLines text={text} lines={lines} {...rest} />;
}

/** A command's output in a preview, coloured as `renderTerminalOutput` colours it. */
function PreviewOutput({ text, style, tokens }: { text: string; style: TextStyle; tokens: ExtendedThemeTokens }) {
  const lines = useMemo(() => terminalLines(text), [text]);
  const renderLine = useCallback((line: string, index: number) => renderTerminalLine(line, index, tokens), [tokens]);
  return <PreviewLines text={text} lines={lines} style={style} tokens={tokens} renderLine={renderLine} />;
}

/** A call's error in a preview: line by line as its output is, all in the danger colour. */
function PreviewError({ text, tokens }: { text: string; tokens: ExtendedThemeTokens }) {
  const style = useMemo<TextStyle>(() => ({
    fontFamily: tokens.fontMono,
    fontSize: tokens.typography.mono.size,
    lineHeight: tokens.typography.mono.lineHeight,
    color: tokens.danger,
  }), [tokens]);
  const lines = useMemo(() => terminalLines(text), [text]);
  return <PreviewLines text={text} lines={lines} style={style} tokens={tokens} />;
}

function ToolBody({ data, tokens, compact, imageFile, revealFile, displayPath, preview = false, onViewImage }: ToolBodyProps) {
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

  // A hover preview must expose the whole file without another disclosure.
  // The regular code block deliberately batches and folds long files.
  if (preview && (data.tool === "read" || data.tool === "write" || data.tool === "edit") &&
      !(imageFile !== undefined && isImagePath(data.filePath))) {
    const content = data.diff || data.code;
    if (!content) {
      return <SelectableText {...selectionCodeText} style={styles.commandLine}>
        {isRunning ? "Waiting for content…" : "No content."}
      </SelectableText>;
    }
    return <PreviewFile text={content} diff={Boolean(data.diff)}
      firstLine={data.tool === "read" && data.offset !== undefined && data.offset > 0 ? Math.floor(data.offset) : 1}
      style={styles.commandLine} tokens={tokens} />;
  }

  return (
    <>
      {(data.tool === "bash" || data.tool === "shell" || data.tool === "git") && (
        <View style={styles.terminalWindow}>
          {command ? (
            // One line on the code surface, not a nested code card: its own
            // band, ruled at the left, apart from the output.
            <View style={styles.commandBand}>
              <SelectableText {...selectionCodeText} style={[styles.commandLine, styles.clear]}>
                <SelectableSpan style={styles.promptColor}>{"$ "}</SelectableSpan>
                {command}
              </SelectableText>
            </View>
          ) : null}
          {data.shell?.stdout ? (
            preview ? <PreviewOutput text={data.shell.stdout} style={styles.terminalOutput} tokens={tokens} /> :
            <TerminalOutput
              text={data.shell.stdout}
              tokens={tokens}
              textProps={selectionCodeText}
              style={styles.terminalOutput}
            />
          ) : null}
          {data.shell?.stderr ? (
            preview ? <PreviewError text={data.shell.stderr} tokens={tokens} /> :
            <SelectableText {...(codeSurface as object)} style={[styles.terminalOutput, { color: tokens.danger }]}>
              {data.shell.stderr}
            </SelectableText>
          ) : null}
          {data.output && !data.shell?.stdout ? (
            preview ? <PreviewOutput text={data.output} style={styles.terminalOutput} tokens={tokens} /> :
            <TerminalOutput
              text={data.output}
              tokens={tokens}
              textProps={selectionCodeText}
              style={styles.terminalOutput}
            />
          ) : null}
          {!data.shell?.stdout && !data.shell?.stderr && !data.output ? (
            <SelectableText style={styles.silentText}>
              {isRunning
                ? "Waiting for command output…"
                : isShellCall
                  ? "Command completed without output."
                  : "The call returned no output."}
            </SelectableText>
          ) : null}
        </View>
      )}

      {data.tool === "github" && <GitHubBody data={data.github} tokens={tokens} running={isRunning} />}

      {data.tool === "thinking" && (
        preview ? <MarkdownView text={data.thinking?.text || data.code || data.output || ""} tokens={tokens} variant="compact" quiet /> :
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
            <SelectableText style={[styles.plainText, { color: tokens.danger }]}>
              Error: {data.mcp.error}
            </SelectableText>
          ) : null}
        </View>
      )}

      {(data.tool === "read" || data.tool === "write") &&
        (imageFile !== undefined && isImagePath(data.filePath) ? (
          <ImagePreview path={data.filePath ?? ""} file={imageFile} tokens={tokens} onReveal={revealFile} preview={preview} onView={onViewImage} />
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
                  <SelectableText {...selectionCodeText} style={styles.terminalOutput}>
                    {renderTerminalOutput(cell.output, tokens)}
                  </SelectableText>
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
                    <SelectableText style={[styles.askOptionLabel, isChosen && styles.strong]}>
                      {opt.label}
                    </SelectableText>
                    {opt.recommended ? <Text style={styles.metaText}>recommended</Text> : null}
                  </View>
                  {opt.description ? (
                    <SelectableText style={styles.mutedText}>
                      {opt.description}
                    </SelectableText>
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
              <SelectableText style={[styles.plainText, styles.strong]}>
                {answered.join(", ")}
              </SelectableText>
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
              <SelectableText numberOfLines={1} style={styles.plainText}>
                {row.title}
              </SelectableText>
              <SelectableText {...(codeSurface as object)} numberOfLines={1} style={[styles.monoText, styles.mutedColor]}>
                {row.url}
              </SelectableText>
            </View>
          ))}
          {data.search.content ? (
            <View style={styles.terminalWindow}>
              <SelectableText {...selectionCodeText} style={styles.terminalOutput}>
                {renderTerminalOutput(data.search.content, tokens)}
              </SelectableText>
            </View>
          ) : null}
          {!data.search.files && !data.search.webResults && !data.search.content ? (
            <Text style={styles.silentText}>{isRunning ? "Searching…" : "No results."}</Text>
          ) : null}
        </View>
      )}

      {data.tool === "fetch" && data.fetch && (
        <View style={styles.section}>
          <SelectableText {...(codeSurface as object)} style={styles.monoText}>
            {data.fetch.url}
          </SelectableText>
          {data.fetch.prompt ? (
            <SelectableText style={styles.mutedText}>
              {data.fetch.prompt}
            </SelectableText>
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
            <SelectableText {...(codeSurface as object)} style={[styles.monoText, styles.mutedColor]}>
              {data.worktree.branchName}
            </SelectableText>
          ) : null}
          {data.worktree.commands.map((step) => (
            <View key={step.index} style={styles.terminalWindow}>
              <View style={styles.inlineRow}>
                <SelectableText {...(codeSurface as object)} style={[styles.monoText, styles.flex]} numberOfLines={2}>
                  {`$ ${step.command}`}
                </SelectableText>
                {step.status === "running" ? <RunningDot color={tokens.accent} /> : null}
                {step.exitCode !== null && step.status !== "running" ? (
                  <Text style={[styles.metaText, step.exitCode !== 0 && { color: tokens.danger }]}>
                    {exitMark(step.exitCode)}
                  </Text>
                ) : null}
              </View>
              {step.log ? (
                <SelectableText {...selectionCodeText} style={styles.terminalOutput}>
                  {renderTerminalOutput(step.log, tokens)}
                </SelectableText>
              ) : null}
            </View>
          ))}
          {data.worktree.log ? (
            <View style={styles.terminalWindow}>
              <SelectableText {...selectionCodeText} style={styles.terminalOutput}>
                {renderTerminalOutput(data.worktree.log, tokens)}
              </SelectableText>
            </View>
          ) : null}
        </View>
      )}

      {data.tool === "sub_agent" && data.subAgent && (
        <View style={styles.section}>
          {data.subAgent.description ? (
            <SelectableText style={styles.plainText}>
              {data.subAgent.description}
            </SelectableText>
          ) : null}
          {data.subAgent.actions?.map((action) => (
            <View key={action.index} style={styles.inlineRow}>
              <SelectableText {...(codeSurface as object)} style={[styles.monoText, styles.mutedColor]}>
                {action.toolName}
              </SelectableText>
              {action.summary ? (
                <SelectableText numberOfLines={1} style={[styles.plainText, styles.flex]}>
                  {action.summary}
                </SelectableText>
              ) : null}
            </View>
          ))}
          {data.subAgent.log ? (
            <View style={styles.terminalWindow}>
              <SelectableText {...selectionCodeText} style={styles.terminalOutput}>
                {renderTerminalOutput(data.subAgent.log, tokens)}
              </SelectableText>
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

      {/* Tool output as text (a task notification, an ACP or Codex result):
          commands and logs far more often than prose, so it is set in the
          code face, as the row's own target already is. */}
      {data.tool === "plain_text" &&
        (data.text ? (
          <SelectableText {...selectionCodeText} style={styles.commandLine}>
            {data.text}
          </SelectableText>
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
              <SelectableText {...selectionCodeText} style={styles.terminalOutput}>
                {renderTerminalOutput(data.output, tokens)}
              </SelectableText>
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
            <SelectableText {...selectionCodeText} style={styles.terminalOutput}>
              {renderTerminalOutput(data.output, tokens)}
            </SelectableText>
          ) : (
            <SelectableText style={styles.silentText}>
              {isRunning ? "Waiting for output…" : "The call returned no output."}
            </SelectableText>
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
  commandBand: ViewStyle;
  clear: TextStyle;
  silentText: TextStyle;
  sectionTitle: TextStyle;
  plainText: TextStyle;
  mutedText: TextStyle;
  monoText: TextStyle;
  mutedColor: TextStyle;
  promptColor: TextStyle;
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
        // The opened body is already the code surface (S7 3.1): command
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
          color: tokens.row.outputText,
        },
        commandLine: {
          fontFamily: tokens.fontMono,
          fontSize: tokens.typography.mono.size,
          lineHeight: tokens.typography.mono.lineHeight,
          color: tokens.row.outputText,
        },
        commandBand: {
          backgroundColor: tokens.v2.surface2,
          borderLeftWidth: 2,
          borderLeftColor: tokens.row.meta,
          borderTopRightRadius: radiusV2.block,
          borderBottomRightRadius: radiusV2.block,
          paddingVertical: space.xs,
          paddingHorizontal: space.sm,
          marginBottom: space.xs,
        },
        // A UITextView paints its own white unless told otherwise.
        clear: { backgroundColor: "transparent" },
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
        promptColor: { color: tokens.row.meta },
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
