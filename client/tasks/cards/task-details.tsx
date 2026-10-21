import React, { useState } from "react";
import { Platform, Pressable, Text, View, type LayoutChangeEvent, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useHover } from "../../ui/use-hover";
import { useCopy } from "../../ui/use-copy";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import type { StatusKind, TaskCard } from "../model";
import { contextRatio, formatCost, formatRelative, formatTokens, since, tildePath } from "./format";
import { cardStrings } from "./strings";
import { taskTokens, type TaskTokens } from "./tokens";
import { modeIcon, THINKING_ICON } from "./mode-icons";
import { BrandMark } from "./brand-mark";
import { useTime, type TimeSource } from "./clock";
import { panelChrome } from "./panel";
import { contextRingTone } from "./context-ring";
import { ProjectIcon } from "./project-icon";
import { StatusIcon } from "./status-icon";
import { cardTimer } from "./task-card";
import { devicePixel } from "../board/board-style";
import { menuChrome } from "../board/menu-model";

export interface TaskDetailsProps extends TimeSource {
  card: TaskCard;
  theme: PluginTheme;
  onOpen?(agentId: string): void;
  /** The phone's bottom sheet: larger type and rows, no frame (the sheet draws its own). */
  compact?: boolean;
  language?: TasksLanguage;
  /** The popover's ceiling: the header stays, the rows below scroll. */
  maxHeight?: number;
}

/**
 * The details' geometry, after the board's menus (`board/menu-model.ts`):
 * rows 32 inset 6 with an 8 padding, 16 icons 8 from their text; the phone
 * sheet's in brackets of the prototype (`docs/prototypes/task-details-popover.md`).
 */
export const DETAILS = {
  width: 320,
  padV: 6,
  inset: 6,
  padH: 8,
  row: 32,
  infoRow: 28,
  icon: 16,
  gap: 8,
  font: 14,
  small: 13,
  open: 28,
} as const;

const SHEET = { ...DETAILS, inset: 8, padH: 10, row: 44, infoRow: 36, icon: 18, gap: 12, font: 15, small: 14, open: 36 } as const;

type Metrics = typeof DETAILS | typeof SHEET;

/** At most this many subtasks are listed; the rest are counted. */
export const SUBTASK_ROWS = 5;

/** A wide (CJK) character takes about two Latin ones. */
function charWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1;
}

function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

/** The middle of `text` cut to `budget` columns: 40% of the head and 60% of the tail around "…". */
function middle(text: string, budget: number): string {
  const chars = [...text];
  const room = Math.max(2, budget - 1);
  const head = Math.floor(room * 0.4);
  const tail = room - head;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

/**
 * A path on one line of `budget` columns: whole when it fits, else "…/" and
 * as many trailing segments as fit. The last segment always shows, cut in
 * its middle when it alone is too long.
 */
export function shortenPath(path: string, budget: number): string {
  if (textWidth(path) <= budget) return path;
  const segments = path.split("/").filter((segment, index) => segment !== "" || index === 0);
  const last = segments.pop() ?? path;
  if (textWidth(`…/${last}`) > budget) return `…/${middle(last, budget - 2)}`;
  let tail = last;
  for (let index = segments.length - 1; index >= 0; index--) {
    const next = `${segments[index]}/${tail}`;
    if (textWidth(`…/${next}`) > budget) break;
    tail = next;
  }
  return `…/${tail}`;
}

/** Each status's word in the header, in its board colour. */
function statusColor(kind: StatusKind, tokens: TaskTokens): string {
  if (kind === "running") return tokens.status.running;
  if (kind === "needs_input") return tokens.warning;
  if (kind === "unread") return tokens.success;
  if (kind === "failed") return tokens.danger;
  return tokens.foregroundMuted;
}

function capitalize(text: string, language: TasksLanguage): string {
  return language === "en" ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Ahead/behind and uncommitted changes beside the branch; a clean, level branch says nothing. */
export function branchHint(git: TaskCard["location"]["git"]): { sync: string | null; dirty: boolean } {
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;
  return { sync: ahead !== 0 || behind !== 0 ? `↑${ahead} ↓${behind}` : null, dirty: git?.dirty === true };
}

/** The details shown on hover (desktop popover) or long press (phone sheet), in the board's menu style. */
export function TaskDetails(props: TaskDetailsProps) {
  const { card, compact = false } = props;
  const tokens = taskTokens(props.theme);
  const chrome = menuChrome(props.theme);
  const preferred = useTasksLanguage();
  const language = props.language ?? preferred;
  const strings = cardStrings(language);
  const m: Metrics = compact ? SHEET : DETAILS;
  // One open popover or sheet follows the clock; nothing else on the board does.
  const now = useTime(props, (time) => time);
  const timer = cardTimer(card, now, language);
  const kind = card.stoppedManually ? "stopped" : card.status;
  const edge = m.inset + m.padH;

  const frame: ViewStyle = compact
    ? {}
    : ({ width: DETAILS.width, maxHeight: props.maxHeight, paddingVertical: DETAILS.padV, ...panelChrome(props.theme) } as ViewStyle);
  const muted: TextStyle = { fontSize: m.small, lineHeight: m.small + 5, color: tokens.foregroundMuted };

  const agentItems: React.ReactNode[] = [];
  const iconSize = compact ? 15 : 14;
  agentItems.push(
    <AgentItem key="model" testID="task-details-model" lead={card.providerMark !== null ? <BrandMark provider={card.provider} size={iconSize} tokens={tokens} /> : null}>
      <Text style={[muted, { color: tokens.foreground }]}>{card.modelLabel ?? card.providerLabel}</Text>
    </AgentItem>,
  );
  if (card.thinkingLabel) {
    agentItems.push(
      <AgentItem key="thinking" testID="task-details-thinking" lead={<Icon name={THINKING_ICON} size={iconSize} color={tokens.foregroundMuted} />}>
        <Text style={muted}>{card.thinkingLabel}</Text>
      </AgentItem>,
    );
  }
  if (card.modeLabel) {
    agentItems.push(
      <AgentItem key="mode" testID="task-details-mode" lead={<Icon name={modeIcon(card.provider, card.modeLabel)} size={iconSize} color={tokens.foregroundMuted} />}>
        <Text style={muted}>{card.modeLabel}</Text>
      </AgentItem>,
    );
  }

  const header = (
    <View style={{ paddingHorizontal: edge, paddingTop: compact ? 4 : 2, paddingBottom: 10, gap: 6 }} testID="task-details-header">
      <View style={{ minHeight: 18, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <StatusIcon kind={kind} size={16} theme={props.theme} />
        <Text style={{ fontSize: compact ? 13 : 12, fontWeight: "600", color: card.stoppedManually ? tokens.foregroundMuted : statusColor(card.status, tokens) }}>
          {card.stoppedManually ? capitalize(card.error ?? strings.status.done, language) : capitalize(strings.status[card.status], language)}
        </Text>
        {timer ? <Text style={{ flexShrink: 1, fontSize: compact ? 13 : 12, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }} numberOfLines={1}>{timer.text}</Text> : null}
        <View style={{ flex: 1 }} />
        {props.onOpen ? <OpenTab size={m.open} chrome={chrome} tokens={tokens} label={strings.openTab} onPress={() => props.onOpen?.(card.id)} /> : null}
      </View>
      <Text style={{ fontSize: compact ? 17 : 14, lineHeight: compact ? 24 : 20, fontWeight: "600", color: tokens.foreground }}>{card.title}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6, rowGap: 2 }} testID="task-details-agent">
        {agentItems.flatMap((item, index) => (index === 0 ? [item] : [<Text key={`dot-${index}`} style={muted}>·</Text>, item]))}
      </View>
      {card.error && !card.stoppedManually ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: m.gap, marginTop: 2 }} testID="task-details-error">
          <View style={{ height: 18, justifyContent: "center" }}>
            <Icon name="CircleX" size={m.icon} color={tokens.danger} />
          </View>
          <Text style={{ flex: 1, fontSize: m.small, lineHeight: 18, color: tokens.foreground }}>{card.error}</Text>
        </View>
      ) : null}
      {card.permission ? (
        <View
          testID="task-details-permission"
          style={{ marginTop: 2, paddingVertical: 8, paddingHorizontal: 10, gap: 4, borderRadius: 8, borderWidth: devicePixel(), borderColor: tokens.border, backgroundColor: tokens.surface1 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="ShieldAlert" size={14} color={tokens.warning} />
            <Text style={{ flex: 1, fontSize: compact ? 13 : 12, fontWeight: "600", color: tokens.warning }} numberOfLines={2}>
              {card.permission.title}
            </Text>
          </View>
          {card.permission.summary ? <Text style={{ fontSize: m.small, lineHeight: 18, color: tokens.foreground, fontFamily: MONO }}>{card.permission.summary}</Text> : null}
        </View>
      ) : null}
    </View>
  );

  const groups = [
    <LocationGroup key="location" card={card} m={m} tokens={tokens} chrome={chrome} language={language} />,
    card.children.length > 0 ? <SubtaskGroup key="subtasks" card={card} m={m} tokens={tokens} theme={props.theme} language={language} /> : null,
    <UsageGroup key="usage" card={card} now={now} m={m} tokens={tokens} language={language} />,
  ].filter((group): group is React.ReactElement => group !== null);

  return (
    <View style={frame} testID="task-details">
      {header}
      <Rule color={tokens.border} top={0} />
      <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: compact ? 4 : 0 }} testID="task-details-body">
        {groups.map((group, index) => (
          <React.Fragment key={group.key}>
            {index > 0 ? <Rule color={tokens.border} top={6} /> : null}
            {group}
          </React.Fragment>
        ))}
      </ScrollView>
    </View>
  );
}

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, SFMono-Regular, Menlo, monospace" });

/** A full-width line one device pixel thin; groups keep 6 above and below it. */
function Rule(props: { color: string; top: number }) {
  return <View testID="task-details-rule" style={{ height: devicePixel(), marginTop: props.top, marginBottom: 6, backgroundColor: props.color }} />;
}

function AgentItem(props: { lead: React.ReactNode; testID: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }} testID={props.testID}>
      {props.lead}
      {props.children}
    </View>
  );
}

/** The open-tab arrow in the header's corner: a circle that fills on hover. */
function OpenTab(props: { size: number; chrome: { hover: string }; tokens: TaskTokens; label: string; onPress(): void }) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      {...hoverProps}
      testID="task-details-open"
      style={({ pressed }) => ({
        width: props.size,
        height: props.size,
        // Centred on the 18 status line without growing it.
        marginVertical: -(props.size - 18) / 2,
        marginRight: -4,
        borderRadius: props.size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: hovered || pressed ? props.chrome.hover : "transparent",
      })}
    >
      <Icon name="ArrowUpRight" size={16} color={hovered ? props.tokens.foreground : props.tokens.foregroundMuted} />
    </Pressable>
  );
}

/** Where the agent works: project and workspace, branch, folder, directory, PR, labels. Every value but the first copies on a press. */
function LocationGroup(props: { card: TaskCard; m: Metrics; tokens: TaskTokens; chrome: { hover: string }; language: TasksLanguage }) {
  const { card, m, tokens } = props;
  const strings = cardStrings(props.language);
  const location = card.location;
  const rows: React.ReactNode[] = [];
  if (location.projectName || location.workspaceName) {
    const kind = location.workspaceKind ? strings.kind[location.workspaceKind] : null;
    rows.push(
      <InfoRow key="place" m={m} lead={<ProjectIcon location={location} size={m.icon - 2} />} wraps testID="task-details-place" hint={kind} tokens={tokens}>
        <Text style={{ fontSize: m.font, lineHeight: m.font + 6, color: tokens.foreground }}>
          {location.projectName && location.workspaceName ? <Text style={{ color: tokens.foregroundMuted }}>{`${location.projectName} › `}</Text> : null}
          {location.workspaceName ?? location.projectName}
        </Text>
      </InfoRow>,
    );
  }
  if (card.parent) {
    rows.push(
      <InfoRow key="parent" m={m} lead={<Icon name="CornerLeftUp" size={m.icon} color={tokens.foregroundMuted} />} tokens={tokens} testID="task-details-parent">
        <Text numberOfLines={1} style={{ fontSize: m.font, color: tokens.foreground }}>
          <Text style={{ color: tokens.foregroundMuted }}>{`${strings.details.parent} `}</Text>
          {card.parent.title ?? (card.parent.missing ? strings.parentArchived : strings.parentUnknown)}
        </Text>
      </InfoRow>,
    );
  }
  if (location.branch) {
    const hint = branchHint(location.git);
    rows.push(
      <CopyRow
        key="branch"
        m={m}
        tokens={tokens}
        chrome={props.chrome}
        icon="GitBranch"
        text={location.branch}
        copyText={location.branch}
        label={strings.details.copyBranch}
        toastLabel="Copy branch name"
        testID="task-details-branch"
        hint={
          hint.sync || hint.dirty ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {hint.dirty ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.warning }} />
                  <Text style={{ fontSize: m.small, color: tokens.warning }}>{strings.uncommitted}</Text>
                </View>
              ) : null}
              {hint.sync ? <Text style={{ fontSize: m.small, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{hint.sync}</Text> : null}
            </View>
          ) : null
        }
      />,
    );
  } else if (location.git === null) {
    rows.push(
      <InfoRow key="branch" m={m} lead={<Icon name="GitBranch" size={m.icon} color={tokens.foregroundMuted} />} tokens={tokens} testID="task-details-branch">
        <Text style={{ fontSize: m.font, color: tokens.foregroundMuted }}>{strings.details.notGit}</Text>
      </InfoRow>,
    );
  }
  const folder = location.folderName ?? location.cwd.split("/").filter(Boolean).pop() ?? null;
  if (folder) {
    rows.push(
      <CopyRow key="folder" m={m} tokens={tokens} chrome={props.chrome} icon="Folder" text={folder} copyText={folder} label={strings.details.copyFolder} toastLabel="Copy folder name" testID="task-details-folder" />,
    );
  }
  rows.push(
    <CopyRow
      key="cwd"
      m={m}
      tokens={tokens}
      chrome={props.chrome}
      icon="SquareTerminal"
      text={tildePath(location.cwd)}
      path
      copyText={location.cwd}
      label={strings.details.copyPath}
      toastLabel="Copy path"
      testID="task-details-cwd"
    />,
  );
  if (location.pullRequest) {
    const pr = location.pullRequest;
    rows.push(
      <CopyRow
        key="pr"
        m={m}
        tokens={tokens}
        chrome={props.chrome}
        icon="GitPullRequest"
        text={`${pr.number !== null ? `#${pr.number} ` : ""}${pr.title}`}
        copyText={pr.url}
        label={strings.details.copyLink}
        toastLabel="Copy URL"
        testID="task-details-pr"
      />,
    );
  }
  if (card.labels.length > 0) {
    rows.push(
      <InfoRow key="labels" m={m} lead={<Icon name="Tag" size={m.icon} color={tokens.foregroundMuted} />} wraps tokens={tokens} testID="task-details-labels">
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 2 }}>
          {card.labels.map((tag) => (
            <View key={tag.name} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tag.color ?? tokens.foregroundMuted }} />
              <Text style={{ fontSize: m.small, lineHeight: m.small + 7, color: tokens.foreground }}>{tag.name}</Text>
            </View>
          ))}
        </View>
      </InfoRow>,
    );
  }
  return <View testID="task-details-location">{rows}</View>;
}

/** A row that only informs: no hover, the menu row's columns. */
function InfoRow(props: {
  m: Metrics;
  lead: React.ReactNode;
  tokens: TaskTokens;
  hint?: string | null;
  /** Long values wrap; the row grows from the menu row's height. */
  wraps?: boolean;
  height?: number;
  testID?: string;
  children: React.ReactNode;
}) {
  const { m } = props;
  const height = props.height ?? m.row;
  return (
    <View
      testID={props.testID}
      style={{
        minHeight: height,
        marginHorizontal: m.inset,
        paddingHorizontal: m.padH,
        paddingVertical: props.wraps ? (height - (m.font + 6)) / 2 : 0,
        flexDirection: "row",
        alignItems: props.wraps ? "flex-start" : "center",
        gap: m.gap,
      }}
    >
      <View style={{ width: m.icon, height: props.wraps ? m.font + 6 : m.icon, alignItems: "center", justifyContent: "center" }}>{props.lead}</View>
      <View style={{ flex: 1, minWidth: 0 }}>{props.children}</View>
      {props.hint ? <Text style={{ fontSize: m.small, lineHeight: m.font + 6, color: props.tokens.foregroundMuted }}>{props.hint}</Text> : null}
    </View>
  );
}

/** A value that copies on a press, as a menu row: hover fill, a copy mark at the right that turns into a check. */
function CopyRow(props: {
  m: Metrics;
  tokens: TaskTokens;
  chrome: { hover: string };
  icon: string;
  text: string;
  copyText: string;
  /** The row's accessibility label, in the board's language. */
  label: string;
  /** The toast's label, in the toolbar's English keys ("Copy path" → "已复制路径"). */
  toastLabel: string;
  hint?: React.ReactNode;
  /** A path: one line, cut in the middle to the row's width. */
  path?: boolean;
  testID: string;
}) {
  const { m, tokens } = props;
  const { hovered, hoverProps } = useHover();
  const { copied, copy } = useCopy();
  // Columns a path may take: measured, about 0.55 of the font size each.
  const [columns, setColumns] = useState<number | null>(null);
  const font = props.path ? m.small : m.font;
  const onLayout = props.path
    ? (event: LayoutChangeEvent) => {
        const next = Math.max(8, Math.floor(event.nativeEvent.layout.width / (font * 0.56)));
        setColumns((was) => (was === next ? was : next));
      }
    : undefined;
  const shown = props.path ? shortenPath(props.text, columns ?? Math.floor((DETAILS.width - 2 * (m.inset + m.padH) - m.icon - m.gap - 22) / (font * 0.56))) : props.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}: ${props.copyText}`}
      onPress={() => void copy(props.copyText, { label: props.toastLabel })}
      {...hoverProps}
      testID={props.testID}
      style={({ pressed }) => ({
        height: m.row,
        marginHorizontal: m.inset,
        paddingHorizontal: m.padH,
        borderRadius: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: m.gap,
        backgroundColor: hovered || pressed ? props.chrome.hover : "transparent",
      })}
    >
      <Icon name={props.icon} size={m.icon} color={tokens.foregroundMuted} />
      <View style={{ flex: 1, minWidth: 0 }} onLayout={onLayout}>
        <Text numberOfLines={1} style={{ fontSize: font, color: tokens.foreground }}>
          {shown}
        </Text>
      </View>
      {props.hint}
      {/* The slot always holds its width, so a hover never reflows the value. */}
      <View style={{ width: 14, alignItems: "center", opacity: hovered || copied ? 1 : 0 }}>
        <Icon name={copied ? "Check" : "Copy"} size={14} color={copied ? tokens.success : tokens.foregroundMuted} />
      </View>
    </Pressable>
  );
}

/** Direct children: a titled group, each with its status mark and word; the first five, then a count. */
function SubtaskGroup(props: { card: TaskCard; m: Metrics; tokens: TaskTokens; theme: PluginTheme; language: TasksLanguage }) {
  const { card, m, tokens } = props;
  const strings = cardStrings(props.language);
  const done = card.children.filter((child) => child.status === "done").length;
  const rest = card.children.length - SUBTASK_ROWS;
  return (
    <View testID="task-details-subtasks">
      <View style={{ height: 28, paddingHorizontal: m.inset + m.padH, flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, fontSize: m.small - 1, fontWeight: "500", color: tokens.foregroundMuted }}>{strings.details.subtasks}</Text>
        <Text style={{ fontSize: m.small - 1, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{strings.details.subtasksDone(done, card.children.length)}</Text>
      </View>
      {card.children.slice(0, SUBTASK_ROWS).map((child) => (
        <InfoRow key={child.id} m={m} height={m.infoRow} lead={<StatusIcon kind={child.status} size={m.icon} theme={props.theme} animated={false} />} hint={strings.status[child.status]} tokens={tokens}>
          <Text numberOfLines={1} style={{ fontSize: m.small, color: tokens.foreground }}>
            {child.title}
          </Text>
        </InfoRow>
      ))}
      {rest > 0 ? (
        <InfoRow m={m} height={m.infoRow} lead={null} tokens={tokens}>
          <Text style={{ fontSize: m.small, color: tokens.foregroundMuted }}>{strings.more(rest)}</Text>
        </InfoRow>
      ) : null}
    </View>
  );
}

interface UsageRow {
  key: string;
  icon: string;
  label: string;
  value: string;
  hint?: string;
}

/** The usage rows, in order; pure for the tests. "Updated" shows only once it differs from "Created" and no turn is running. */
export function usageRows(card: TaskCard, now: number, language: TasksLanguage): UsageRow[] {
  const strings = cardStrings(language).details;
  const rows: UsageRow[] = [];
  const created = since(card.timing.createdAt, now);
  if (created !== null) rows.push({ key: "created", icon: "CalendarPlus", label: strings.created, value: formatRelative(created, language) });
  const updated = since(card.timing.updatedAt, now);
  if (updated !== null && created !== null && card.status !== "running" && created - updated >= 60_000) {
    rows.push({ key: "updated", icon: "History", label: strings.updated, value: formatRelative(updated, language) });
  }
  const usage = card.usage;
  if (usage?.inputTokens != null) {
    const cached = usage.cachedInputTokens ? strings.cachedHint(formatTokens(usage.cachedInputTokens)) : undefined;
    rows.push({ key: "input", icon: "ArrowDownToLine", label: strings.input, value: formatTokens(usage.inputTokens), hint: cached });
  }
  if (usage?.outputTokens != null) rows.push({ key: "output", icon: "ArrowUpFromLine", label: strings.output, value: formatTokens(usage.outputTokens) });
  if (usage?.totalCostUsd != null) rows.push({ key: "cost", icon: "CircleDollarSign", label: strings.cost, value: formatCost(usage.totalCostUsd) });
  return rows;
}

function UsageGroup(props: { card: TaskCard; now: number; m: Metrics; tokens: TaskTokens; language: TasksLanguage }) {
  const { card, m, tokens } = props;
  const strings = cardStrings(props.language).details;
  const rows = usageRows(card, props.now, props.language);
  const ratio = contextRatio(card.context);
  const tone = ratio !== null ? contextRingTone(ratio) : "normal";
  const toneColor = tone === "danger" ? tokens.danger : tone === "warning" ? tokens.warning : tokens.foregroundMuted;
  const value = (text: string) => <Text style={{ fontSize: m.small, color: tokens.foreground, fontVariant: ["tabular-nums"] }}>{text}</Text>;
  const line = (row: UsageRow, children: React.ReactNode) => (
    <View
      key={row.key}
      testID={`detail-row-${row.key}`}
      style={{ height: m.infoRow, marginHorizontal: m.inset, paddingHorizontal: m.padH, flexDirection: "row", alignItems: "center", gap: m.gap }}
    >
      <Icon name={row.icon} size={m.icon} color={tokens.foregroundMuted} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: m.small, color: tokens.foregroundMuted }}>
        {row.label}
      </Text>
      {children}
    </View>
  );
  return (
    <View testID="task-details-usage">
      {rows.map((row) =>
        line(
          row,
          <>
            {row.hint ? <Text style={{ fontSize: m.small, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{row.hint}</Text> : null}
            {value(row.value)}
          </>,
        ),
      )}
      {card.context ? (
        <>
          {line(
            { key: "context", icon: "Gauge", label: strings.context, value: "" },
            <>
              {ratio !== null ? (
                <Text style={{ fontSize: m.small, fontWeight: "600", color: toneColor, fontVariant: ["tabular-nums"] }}>{`${Math.round(ratio * 100)}%`}</Text>
              ) : null}
              {value(`${formatTokens(card.context.usedTokens)} / ${formatTokens(card.context.maxTokens)}`)}
            </>,
          )}
          {ratio !== null ? (
            // From the label's start to the value's end, 4 high, under the row.
            <View
              testID="task-details-context-bar"
              style={{ height: 4, borderRadius: 2, marginLeft: m.inset + m.padH + m.icon + m.gap, marginRight: m.inset + m.padH, marginBottom: 8, backgroundColor: tokens.surface2, overflow: "hidden" }}
            >
              <View style={{ width: `${Math.round(ratio * 1000) / 10}%`, height: 4, borderRadius: 2, backgroundColor: toneColor }} />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
