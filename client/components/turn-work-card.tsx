/**
 * The standard level's card for one turn's folded work (`state/turn-work.ts`):
 *
 *   ▸ 用时 1分18秒            opens the work details and steps
 *   ✎ 已编辑 4 个文件  查看变更       +33 −4
 *     client/paths/format-path.ts       +5 −2      only once the file card
 *     …three paths, then 再显示 N 个文件            is opened
 *
 * Closed, the card is those rows and nothing else: steps, command output,
 * the file paths and every diff mount only when opened, and unmount when
 * closed. The file card's choice outlives a remount (`disclosure-store`). A diff opens in the details panel, one file at a time; with block
 * details off it opens under the card. Line counts are the turn's edit events
 * added up, not the file's net change, and are measured once per call.
 */
import React, { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { space, withAlpha } from "./theme-tokens";
import { DISCLOSURE_HEADER, DisclosureHeader, RowIcon, RowPaletteContext } from "../ui/disclosure-header";
import { useHover } from "../ui/use-hover";
import { hairline } from "../ui/tokens/platform";
import { RunningDot } from "../ui/running-dot";
import { HoverPreviewBody, HoverPreviewHeader } from "../ui/hover-preview";
import { PathContext, usePathContextValue } from "../ui/path-text";
import { formatPath } from "../paths/format-path";
import { formatDuration } from "../ui/time";
import { useEnhancerPreferences } from "../preferences";
import { useDisclosure } from "../state/disclosure-store";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { resolveLanguage, type SettingsLanguage } from "../i18n/settings-strings";
import { classifyTool, type ToolCallView } from "../tools/classify";
import { toolErrorText } from "../tools/error-text";
import { countDiff, countLines } from "../tools/summarize";
import { FileEditsPreview, ToolCallout } from "./tool-callouts";
import { BlockPlacementContext, type BlockEntry } from "../details/contracts";
import { getBlock, registerBlock, type BlockRegistration } from "../details/block-registry";
import { detailsApi, readDetails, useMarkerPhase } from "../details/details-store";
import { rowPressAction } from "../details/click-model";
import { SelectionTranslationScope } from "../translation/ui";
import { bindSelectionScopeElement, selectionScopeDataSet, SelectionTranslationContext } from "../translation/selection";
import { selectionSurface } from "./selection-actions";
import { selectableTextStyle } from "./selection";
import { surfaceProps } from "./view-props";
import type { LineCount, TurnFooterStore } from "../state/turn-footers";
import type { TurnWork, WorkFile, WorkStep } from "../state/turn-work";
import type { WorkVerb } from "../tools/standard-fold";

const STRINGS: Record<SettingsLanguage, {
  worked: string; work: string; read: string; edited: string; ran: string; files: (count: number) => string;
  someFiles: string; view: string; more: (count: number) => string; fewer: string;
  steps: (count: number) => string; thinking: string;
  /** The status line's verb for a call still running, and for the newest finished one. */
  doing: Record<WorkVerb, string>; done: Record<WorkVerb, string>;
}> = {
  en: {
    worked: "Worked for {d}", work: "Work", read: "Read files", edited: "Edited files", ran: "Ran commands",
    files: (count) => `Edited ${count} ${count === 1 ? "file" : "files"}`, someFiles: "Edited files",
    view: "View changes", more: (count) => `Show ${count} more ${count === 1 ? "file" : "files"}`, fewer: "Show fewer files",
    steps: (count) => `${count} ${count === 1 ? "step" : "steps"}`, thinking: "Thinking",
    doing: { command: "Running command", read: "Reading", edit: "Editing", write: "Writing" },
    done: { command: "Ran command", read: "Read", edit: "Edited", write: "Wrote" },
  },
  zh: {
    worked: "用时 {d}", work: "工作过程", read: "读取了文件", edited: "编辑了文件", ran: "运行了命令",
    files: (count) => `已编辑 ${count} 个文件`, someFiles: "已编辑的文件",
    view: "查看变更", more: (count) => `再显示 ${count} 个文件`, fewer: "收起文件",
    steps: (count) => `${count} 步`, thinking: "正在思考",
    doing: { command: "正在运行命令", read: "正在读取", edit: "正在编辑", write: "正在写入" },
    done: { command: "运行了命令", read: "读取了", edit: "编辑了", write: "写入了" },
  },
};

const BARE_FOOTPRINTS = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5.1 7.3c-1.9.3-2.5 2.3-1.8 4.1.4 1.1 1.1 1.9 1 3.1-.1 1.5.4 2.5 1.7 2.6 1.2.1 1.9-.8 1.9-2.1 0-1.2.5-2 1-3.2.9-2.2-1-4.9-3.8-4.5Z"/><circle cx="4.2" cy="5.4" r="1.1"/><circle cx="6.3" cy="4.6" r="1.2"/><circle cx="8.4" cy="5.2" r=".9"/><circle cx="9.7" cy="6.5" r=".7"/><path d="M18.9 11.3c1.9.3 2.5 2.3 1.8 4.1-.4 1.1-1.1 1.9-1 3.1.1 1.5-.4 2.5-1.7 2.6-1.2.1-1.9-.8-1.9-2.1 0-1.2-.5-2-1-3.2-.9-2.2 1-4.9 3.8-4.5Z"/><circle cx="19.8" cy="9.4" r="1.1"/><circle cx="17.7" cy="8.6" r="1.2"/><circle cx="15.6" cy="9.2" r=".9"/><circle cx="14.3" cy="10.5" r=".7"/></svg>',
};

function BareFootprints() {
  const palette = useContext(RowPaletteContext);
  return <Icon icon={BARE_FOOTPRINTS} size={DISCLOSURE_HEADER.icon} color={palette?.icon ?? "currentColor"} />;
}

/** A folded call as its own row would read it. */
function viewOf(item: ToolCallTimelineItem): ToolCallView {
  return classifyTool({ name: item.name, status: item.status, detail: item.detail as unknown as Record<string, unknown>,
    callId: item.callId, error: toolErrorText(item.error) });
}

/**
 * The file card's open/closed key. A running turn's card is keyed `live` and
 * its settled card by the reply, so the key is the turn's first folded edit,
 * which both share: opening the card while the turn runs keeps it open after.
 */
export function workFilesKey(agentId: string, work: Pick<TurnWork, "files">): string {
  return `${agentId}:work-files:${work.files[0]?.callIds[0] ?? ""}`;
}

/** Paths an opened file card lists before "show more". */
export const FILE_ROWS_CLOSED = 3;

/** One call's added and removed lines, as its own row would count them. */
export function measureLineCount(item: ToolCallTimelineItem): LineCount | null {
  const view = viewOf(item);
  if (view.tool === "edit") {
    if (!view.diff) return null;
    return { ...countDiff(view.diff, !view.diffFromText), viewable: true };
  }
  if (view.tool === "write") {
    if (view.code === undefined) return null;
    return { added: countLines(view.code), removed: 0, viewable: Boolean(view.code) };
  }
  return null;
}

/** The kinds of folded work, in the card's order: reads, then edits and writes, then commands. */
export function workVerbs(steps: readonly WorkStep[]): Array<"read" | "edited" | "ran"> {
  const verbs: Array<"read" | "edited" | "ran"> = [];
  if (steps.some((step) => step.verb === "read")) verbs.push("read");
  if (steps.some((step) => step.verb === "edit" || step.verb === "write")) verbs.push("edited");
  if (steps.some((step) => step.verb === "command")) verbs.push("ran");
  return verbs;
}

function firstLine(text: string | null): string | null {
  if (!text) return null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim().replace(/^[#>*\-\s]+/, "").replace(/\*\*/g, "");
    if (trimmed) return trimmed;
  }
  return null;
}

interface CardProps {
  agentId: string;
  /** The anchor row's timestamp: steps and diffs open in the details panel at this place. */
  at: number;
  work: TurnWork;
  store: TurnFooterStore;
  tokens: ExtendedThemeTokens;
  compact: boolean;
}

export const TurnWorkCard = memo(function TurnWorkCard({ agentId, at, work, store, tokens, compact }: CardProps) {
  const { language } = useEnhancerPreferences();
  const text = STRINGS[resolveLanguage(language)] ?? STRINGS.en;
  const registration = useRef<{ id: string; handle: BlockRegistration } | null>(null);
  const lang = resolveLanguage(language);
  const label = !work.running && work.complete && work.durationMs !== null
    ? text.worked.replace("{d}", formatDuration(work.durationMs, lang))
    : work.running && work.steps.length ? `${text.work} \u00b7 ${text.steps(work.steps.length)}` : text.work;
  const styles = useCardStyles(tokens);
  const summary = workVerbs(work.steps).map((verb) => text[verb]).join(" · ");
  // The running card redraws with each live update; the turn's first thought rarely changes.
  const intent = useMemo(() => firstLine(work.intent), [work.intent]);
  const entry = useMemo<BlockEntry>(() => ({
    id: `${agentId}:work:${work.key}:steps`, agentId, at, kind: "tool", seq: 0,
    mounted: true, navigable: false, hasBody: true, title: summary, titleMono: false,
    subtitle: [], icon: "List", readsImage: false, dismissOnOutside: true, reserveTimeline: true,
    render: () => <>
      <HoverPreviewHeader tokens={tokens} />
      <HoverPreviewBody fullBleed>{intent ? <WorkIntent agentId={agentId} text={intent} style={[styles.intent, { paddingHorizontal: space.md }]} /> : null}
        <WorkSteps agentId={agentId} at={at} steps={work.steps} tokens={tokens} compact={compact} /></HoverPreviewBody>
    </>,
    copies: () => [],
  }), [agentId, at, compact, intent, styles, summary, tokens, work.key, work.steps]);
  const phase = useMarkerPhase(agentId, entry.id);
  // A step list open in the details panel stays attached to the card drawn
  // under the next row: it registers before the previous card releases. The
  // same card under a new id (the running card settling, `live` → the reply's
  // key) takes the open panel along: it registers the new id and opens it in
  // the old one's place, so the panel keeps following the card.
  useLayoutEffect(() => {
    const held = registration.current;
    if (held?.id === entry.id) return;
    const carry = held !== null && readDetails(agentId).openId === held.id;
    registration.current = carry || getBlock(agentId, entry.id) ? { id: entry.id, handle: registerBlock(entry) } : null;
    if (carry) detailsApi.open(agentId, entry.id, { independent: true, navigable: false });
    held?.handle.release();
  }, [agentId, entry.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { registration.current?.handle.update(entry); }, [entry]);
  useEffect(() => () => { registration.current?.handle.release(); registration.current = null; }, []);
  // A tap as on any details row (`click-model.ts`): open, or close the current
  // one where the panel leaves the row in reach; the phone drawer stays. The
  // title has no body to expand in place, so a pointer acts as a tap.
  const toggleSteps = () => {
    const details = readDetails(agentId);
    const action = rowPressAction({ pointer: false, hasBody: true, readsImage: false,
      isCurrent: details.openId === entry.id, form: details.openId ? details.form : null });
    if (action === "close") { detailsApi.close(agentId); return; }
    if (action !== "details") return;
    if (registration.current) registration.current.handle.update(entry);
    else registration.current = { id: entry.id, handle: registerBlock(entry) };
    detailsApi.open(agentId, entry.id, { independent: true, navigable: false });
  };
  return (
    <View style={styles.card}>
      {work.steps.length ? (
        <BlockPlacementContext.Provider value={null}>
          <DisclosureHeader expanded={false} onToggle={toggleSteps}
            detailsMarker={{ agentId, id: entry.id, selected: phase === "on" }}
            tokens={tokens} compact={compact} icon={<BareFootprints />} verb={label} keepVerb />
        </BlockPlacementContext.Provider>
      ) : null}
      {work.files.length ? <FileCard agentId={agentId} at={at} work={work} store={store} text={text} tokens={tokens} compact={compact} /> : null}
      {/* Last, and always one line while the turn runs: the card sits above the list's bottom edge, so a
          line that came and went with each command moved the whole conversation up and back down. */}
      {work.running ? <ActivityLine work={work} text={text} tokens={tokens} /> : null}
    </View>
  );
});

/**
 * What the running turn is doing: the call still running, else a thought,
 * else the newest finished step, dimmed. The verb and its target change in
 * place; the line itself stays.
 */
function ActivityLine({ work, text, tokens }: { work: TurnWork; text: (typeof STRINGS)["en"]; tokens: ExtendedThemeTokens }) {
  const styles = useCardStyles(tokens);
  const { verb, target, live } = work.current ? { verb: text.doing[work.current.verb], target: work.current.target, live: true }
    : work.thinking ? { verb: text.thinking, target: null, live: true }
    : work.latest ? { verb: text.done[work.latest.verb], target: activityTarget(work.latest), live: false }
    : { verb: text.thinking, target: null, live: true };
  return (
    <View style={styles.current} accessibilityLabel={target ? `${verb} ${target}` : verb}>
      <View style={styles.slot}>{live ? <RunningDot color={tokens.accent} /> : null}</View>
      <Text style={live ? styles.verb : styles.verbDone} numberOfLines={1}>{verb}</Text>
      {target ? <Text style={live ? styles.command : styles.commandDone} numberOfLines={1}>{target}</Text> : null}
    </View>
  );
}

/** A finished step's command or path, as the status line names it. */
function activityTarget(step: WorkStep): string | null {
  if (step.verb === "command") return step.item.detail.type === "shell" ? step.item.detail.command ?? null : null;
  return step.filePath ?? null;
}

/**
 * The turn's first thought atop the opened steps. Selectable, and on web a
 * selection surface scoped as the turn's reasoning, so the selection bar
 * offers Copy and Translate as it does on a thought row.
 */
function WorkIntent({ agentId, text, style }: { agentId: string; text: string; style: StyleProp<TextStyle> }) {
  return <SelectionTranslationScope agentId={agentId} kind="reasoning" streaming={false}>
    <IntentText text={text} style={style} />
  </SelectionTranslationScope>;
}

function IntentText({ text, style }: { text: string; style: StyleProp<TextStyle> }) {
  const scope = useContext(SelectionTranslationContext);
  const scopeData = Platform.OS === "web" ? selectionScopeDataSet(scope) : null;
  const bindScope = useCallback((node: Text | null) => {
    if (!node || !scope) return;
    bindSelectionScopeElement(node, scope);
    return () => bindSelectionScopeElement(node, null);
  }, [scope]);
  return <Text ref={scopeData ? bindScope : undefined}
    {...(scopeData ? surfaceProps(selectionSurface, { dataSet: scopeData } as never) : selectionSurface) as object}
    selectable style={[style, selectableTextStyle]}>{text}</Text>;
}

/** Mounted only while the steps are open; each command can open its output. */
function WorkSteps({ agentId, at, steps, tokens, compact }: {
  agentId: string; at: number; steps: readonly WorkStep[]; tokens: ExtendedThemeTokens; compact: boolean;
}) {
  const pathContext = usePathContextValue(agentId);
  const placement = useMemo(() => ({ agentId, at, kind: "tool" as const }), [agentId, at]);
  return (
    <PathContext.Provider value={pathContext}>
      <BlockPlacementContext.Provider value={placement}>
        <View testID="work-step-list">
          {steps.map((step, index) => <View key={step.callId} testID="work-step-cell"
            style={{ paddingVertical: space.xs, paddingHorizontal: space.md,
              backgroundColor: index % 2 === 1 ? withAlpha(tokens.foreground, tokens.isDark ? 0.045 : 0.04) : undefined }}>
            <WorkStepRow agentId={agentId} step={step} tokens={tokens} compact={compact} />
          </View>)}
        </View>
      </BlockPlacementContext.Provider>
    </PathContext.Provider>
  );
}

const WorkStepRow = memo(function WorkStepRow({ agentId, step, tokens, compact }: {
  agentId: string; step: WorkStep; tokens: ExtendedThemeTokens; compact: boolean;
}) {
  const view = useMemo(() => viewOf(step.item), [step.item]);
  return <SelectionTranslationScope agentId={agentId} kind="tool_output" streaming={false}>
    <ToolCallout data={view} previewKey={`${agentId}:work:${step.callId}:preview`} tokens={tokens} compact={compact} />
  </SelectionTranslationScope>;
});

function FileCard({ agentId, at, work, store, text, tokens, compact }: {
  agentId: string; at: number; work: TurnWork; store: TurnFooterStore; text: (typeof STRINGS)["en"];
  tokens: ExtendedThemeTokens; compact: boolean;
}) {
  const styles = useCardStyles(tokens);
  const { blockDetails } = useEnhancerPreferences();
  const [open, setOpen] = useDisclosure(workFilesKey(agentId, work), false);
  const { hover: canHover } = useInputCapabilities(compact);
  const { hovered: headerHovered, hoverProps: headerHoverProps } = useHover();
  const [expanded, setExpanded] = useState(false);
  const [inlinePath, setInlinePath] = useState<string | null>(null);
  // Paths read relative to the workspace, as a tool row's do.
  const pathContext = usePathContextValue(agentId);
  const items = useMemo(() => new Map(work.steps.map((step) => [step.callId, step.item])), [work.steps]);
  // Counted only while the header is mounted, once per call (the store keeps them by call ID).
  const counts = useMemo(() => work.files.map((file) => fileCount(file, items, store)), [work.files, items, store]);
  const total = work.complete && counts.every((count) => count !== null)
    ? counts.reduce((sum, count) => ({ added: sum.added + count!.added, removed: sum.removed + count!.removed }), { added: 0, removed: 0 })
    : null;
  const shown = expanded ? work.files : work.files.slice(0, FILE_ROWS_CLOSED);
  const extra = work.files.length - FILE_ROWS_CLOSED;
  const registrations = useRef(new Map<string, BlockRegistration>());
  useEffect(() => () => {
    for (const registration of registrations.current.values()) registration.release();
    registrations.current.clear();
  }, []);

  const openFile = useCallback((file: WorkFile) => {
    if (!blockDetails) {
      // The diff opens under the card's list, so 查看变更 on a closed card opens it.
      setOpen(true);
      setInlinePath((current) => current === file.path ? null : file.path);
      return;
    }
    const id = `${agentId}:work:${work.key}:file:${file.path}`;
    const calls = file.callIds.map((callId) => items.get(callId)).filter((item): item is ToolCallTimelineItem => Boolean(item));
    const count = fileCount(file, items, store);
    const entry: BlockEntry = {
      id, agentId, at, kind: "tool", seq: 0, mounted: true, navigable: false, hasBody: true,
      title: file.path, titleMono: true, subtitle: count ? [`+${count.added} −${count.removed}`] : [],
      icon: "Pencil", readsImage: false,
      render: () => <FileChanges agentId={agentId} calls={calls} tokens={tokens} compact={compact} />,
      copies: () => [],
    };
    const existing = registrations.current.get(file.path);
    if (existing) existing.update(entry);
    else registrations.current.set(file.path, registerBlock(entry));
    detailsApi.open(agentId, id, { navigable: false });
  }, [agentId, at, blockDetails, compact, items, setOpen, store, tokens, work.key]);

  const firstViewable = work.files.find((_, index) => counts[index]?.viewable);
  const inlineFile = inlinePath ? work.files.find((file) => file.path === inlinePath) : undefined;
  return (
    <View style={[styles.files, !open && styles.filesClosed]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} testID={`work-files:${agentId}`}
        onPress={() => setOpen(!open)} {...headerHoverProps}
        style={({ pressed }) => [styles.filesHeader, (headerHovered || pressed) && styles.hovered]}>
        {/* As a disclosure row: the pencil turns into the chevron on hover and while open. */}
        <View style={styles.slot}>
          <RowIcon name={open ? "ChevronDown" : canHover && headerHovered ? "ChevronRight" : "Pencil"}
            color={headerHovered ? tokens.foreground : tokens.row.icon} />
        </View>
        <Text style={styles.filesTitle} numberOfLines={1}>{work.complete ? text.files(work.files.length) : text.someFiles}</Text>
        {firstViewable ? <ViewChanges label={text.view} onPress={() => openFile(firstViewable)} tokens={tokens} /> : null}
        {/* The total ends where each row's count ends, so the counts read as one column. */}
        <View style={styles.spacer} />
        {total ? <Stat count={total} tokens={tokens} /> : null}
      </Pressable>
      {open ? (
        <>
          <View style={styles.divider} />
          {shown.map((file) => {
            const count = counts[work.files.indexOf(file)] ?? null;
            return <FileRow key={file.path} agentId={agentId} file={file} shown={formatPath(file.path, pathContext).displayPath}
              count={work.complete ? count : null}
              onOpen={count?.viewable ? openFile : undefined} current={inlinePath === file.path} tokens={tokens} />;
          })}
          {extra > 0 ? (
            <MoreToggle expanded={expanded} label={expanded ? text.fewer : text.more(extra)}
              onPress={() => setExpanded((value) => !value)} tokens={tokens} />
          ) : null}
        </>
      ) : null}
      {open && inlineFile && !blockDetails ? <InlineFileChanges agentId={agentId} file={inlineFile} items={items} tokens={tokens} compact={compact} /> : null}
    </View>
  );
}

function fileCount(file: WorkFile, items: ReadonlyMap<string, ToolCallTimelineItem>, store: TurnFooterStore): LineCount | null {
  let added = 0;
  let removed = 0;
  let viewable = false;
  for (const callId of file.callIds) {
    const item = items.get(callId);
    const count = item ? store.lineCount(callId, item, measureLineCount) : null;
    if (!count) return null;
    added += count.added;
    removed += count.removed;
    viewable ||= count.viewable;
  }
  return { added, removed, viewable };
}

function ViewChanges({ label, onPress, tokens }: { label: string; onPress(): void; tokens: ExtendedThemeTokens }) {
  const styles = useCardStyles(tokens);
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} {...hoverProps}
      style={({ pressed }) => [styles.viewButton, (hovered || pressed) && styles.hovered]}>
      <Text style={styles.viewLabel}>{label}</Text>
    </Pressable>
  );
}

function MoreToggle({ expanded, label, onPress, tokens }: {
  expanded: boolean; label: string; onPress(): void; tokens: ExtendedThemeTokens;
}) {
  const styles = useCardStyles(tokens);
  const { hovered, hoverProps } = useHover();
  const color = hovered ? tokens.foreground : tokens.foregroundMuted;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress} {...hoverProps}
      style={({ pressed }) => [styles.more, (hovered || pressed) && styles.hovered]}>
      <View style={styles.slot}><RowIcon name={expanded ? "ChevronUp" : "ChevronDown"} color={color} /></View>
      <Text style={[styles.moreLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

function FileRow({ agentId, file, shown, count, onOpen, current, tokens }: {
  agentId: string; file: WorkFile; shown: string; count: LineCount | null; onOpen?: (file: WorkFile) => void; current: boolean;
  tokens: ExtendedThemeTokens;
}) {
  const styles = useCardStyles(tokens);
  const { hovered, hoverProps } = useHover();
  const body = (
    <>
      <Text style={[styles.path, (current || hovered) && { color: tokens.foreground }]} numberOfLines={1} ellipsizeMode="middle">{shown}</Text>
      {count ? <Stat count={count} tokens={tokens} /> : null}
    </>
  );
  if (!onOpen) return <View style={styles.fileRow} accessibilityLabel={file.path}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={file.path} testID={`work-file:${agentId}:${file.path}`}
      onPress={() => onOpen(file)} {...hoverProps}
      style={({ pressed }) => [styles.fileRow, (hovered || pressed || current) && styles.hovered]}>{body}</Pressable>
  );
}

function Stat({ count, tokens }: { count: { added: number; removed: number }; tokens: ExtendedThemeTokens }) {
  const styles = useCardStyles(tokens);
  return (
    <Text style={styles.stat}>
      <Text style={{ color: tokens.row.diffAdd }}>+{count.added}</Text>
      {" "}
      <Text style={{ color: count.removed ? tokens.row.diffDel : tokens.row.meta }}>−{count.removed}</Text>
    </Text>
  );
}

/** The details panel's body for one file: parsed when the panel shows it, released when it closes. */
function FileChanges({ agentId, calls, tokens, compact }: {
  agentId: string; calls: readonly ToolCallTimelineItem[]; tokens: ExtendedThemeTokens; compact: boolean;
}) {
  const pathContext = usePathContextValue(agentId);
  const views = useMemo(() => calls.map(viewOf), [calls]);
  const resolvePath = useCallback((path: string) => formatPath(path, pathContext).absolutePath, [pathContext]);
  return (
    <PathContext.Provider value={pathContext}>
      <FileEditsPreview calls={views} resolvePath={resolvePath} tokens={tokens} compact={compact} />
    </PathContext.Provider>
  );
}

/** Block details off: the file's edits open under the card, one file at a time. */
function InlineFileChanges({ agentId, file, items, tokens, compact }: {
  agentId: string; file: WorkFile; items: ReadonlyMap<string, ToolCallTimelineItem>; tokens: ExtendedThemeTokens; compact: boolean;
}) {
  const pathContext = usePathContextValue(agentId);
  const views = useMemo(() => file.callIds.map((callId) => items.get(callId))
    .filter((item): item is ToolCallTimelineItem => Boolean(item)).map(viewOf), [file, items]);
  return (
    <PathContext.Provider value={pathContext}>
      <BlockPlacementContext.Provider value={null}>
        {views.map((view) => <ToolCallout key={view.callId ?? view.id} data={view} tokens={tokens} compact={compact} defaultExpanded />)}
      </BlockPlacementContext.Provider>
    </PathContext.Provider>
  );
}

const styleCache = new WeakMap<ExtendedThemeTokens, ReturnType<typeof createCardStyles>>();

function useCardStyles(tokens: ExtendedThemeTokens) {
  let styles = styleCache.get(tokens);
  if (!styles) styleCache.set(tokens, styles = createCardStyles(tokens));
  return styles;
}

function createCardStyles(tokens: ExtendedThemeTokens) {
  const block = tokens.typography.block;
  const row = { minHeight: block.rowHeight.desktop, flexDirection: "row" as const, alignItems: "center" as const, gap: space.sm };
  // The card stays inside the reply's column: no hover fill marks the bleed on touch screens, where
  // a bleeding border reads as wider than the reply. A list row bleeds into the card's padding for its own fill.
  const inset = space.sm - 1;
  const listRow = { ...row, minHeight: block.rowHeight.desktop - space.xs, marginHorizontal: -space.xs,
    paddingLeft: DISCLOSURE_HEADER.iconSlot + space.sm + space.xs, paddingRight: space.xs, borderRadius: 6 };
  return StyleSheet.create({
    card: { marginBottom: space.sm },
    slot: { width: 16, alignItems: "center", justifyContent: "center" },
    intent: { color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: block.label.size,
      lineHeight: block.label.lineHeight, paddingVertical: space.xs / 2 },
    current: { ...row },
    verb: { color: tokens.row.targetActive, fontFamily: tokens.fontUi, fontSize: block.label.size, lineHeight: block.label.lineHeight },
    verbDone: { color: tokens.row.target, fontFamily: tokens.fontUi, fontSize: block.label.size, lineHeight: block.label.lineHeight },
    command: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, color: tokens.row.target, fontFamily: tokens.fontMono,
      fontSize: block.target.size, lineHeight: block.target.lineHeight },
    commandDone: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, color: tokens.row.meta, fontFamily: tokens.fontMono,
      fontSize: block.target.size, lineHeight: block.target.lineHeight },
    files: { marginTop: space.xs, borderWidth: 1, borderColor: tokens.border,
      borderRadius: 10, paddingHorizontal: inset, paddingTop: space.xs / 2, paddingBottom: space.xs },
    // Bare while closed: the header row's own height, an even inset above and below.
    filesClosed: { paddingBottom: space.xs / 2 },
    // The header bleeds into the card's padding for its hover fill, as a list row does.
    filesHeader: { ...row, marginHorizontal: -space.xs, paddingHorizontal: space.xs, borderRadius: 6 },
    // Edge to edge between the card's borders, one device pixel thick.
    divider: { ...hairline(tokens.platform, "bottom"), marginHorizontal: -inset, marginTop: space.xs / 2,
      marginBottom: space.xs, backgroundColor: tokens.border },
    filesTitle: { flexShrink: 1, minWidth: 0, color: tokens.foreground, fontFamily: tokens.fontUi, fontWeight: "500",
      fontSize: block.label.size, lineHeight: block.label.lineHeight },
    spacer: { flexGrow: 1 },
    viewButton: { paddingHorizontal: space.xs + 2, paddingVertical: 2, borderRadius: 6 },
    viewLabel: { color: tokens.accent, fontFamily: tokens.fontUi, fontSize: block.button.size, lineHeight: block.button.lineHeight },
    hovered: { backgroundColor: tokens.v2.surface1 },
    fileRow: listRow,
    path: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, color: tokens.row.target, fontFamily: tokens.fontMono,
      fontSize: block.target.size, lineHeight: block.target.lineHeight },
    stat: { flexShrink: 0, fontFamily: tokens.fontMono, fontWeight: "600", fontSize: block.meta.size,
      lineHeight: block.meta.lineHeight, fontVariant: ["tabular-nums"] },
    more: { ...listRow, paddingLeft: space.xs, gap: space.sm },
    moreLabel: { color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: block.button.size, lineHeight: block.button.lineHeight },
  });
}
