import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, useTasksFontScale, taskControlHeight } from "../typography";
import { useHover } from "../../ui/use-hover";
import { useCopy } from "../../ui/use-copy";
import type { TasksLanguage } from "../i18n";
import type { StatusKind, TaskCard } from "../model";
import type { PermissionButton, StopPhase } from "../actions";
import { contextRatio, formatTokens, tildePath } from "./format";
import { cardStrings } from "./strings";
import { taskTokens, type TaskTokens } from "./tokens";
import { modeIcon, THINKING_ICON } from "./mode-icons";
import { BrandMark } from "./brand-mark";
import { useTime, type TimeSource } from "./clock";
import { contextRingTone } from "./context-ring";
import { ProjectIcon } from "./project-icon";
import { StatusIcon } from "./status-icon";
import { ActionButton, cardTimer } from "./task-card";
import { branchHint, shortenPath, usageRows, SUBTASK_ROWS } from "./details-format";

/**
 * The details as a stack of Linear sidebar cards (`docs/prototypes/task-details-sidebar.md`):
 * each block its own raised card, radius 12, a hairline and a faint shadow,
 * text 12 from the card's edge. The desktop sidebar draws them at desktop
 * sizes; the phone's sheet and a tablet's touch sidebar at touch sizes.
 */
export const DETAIL_CARD = {
  radius: 12,
  gap: 8,
  padH: 12,
  padV: 6,
  /** Property rows: a fixed label column, then an icon and the value. */
  labelWidth: 80,
  labelGap: 8,
  row: 36,
  listRow: 32,
  font: 13,
  title: 16,
  icon: 16,
  button: 32,
  round: 28,
} as const;

const TOUCH_CARD = { ...DETAIL_CARD, row: 44, listRow: 44, font: 15, title: 17, icon: 18, button: 44, round: 36 } as const;

type Metrics = typeof DETAIL_CARD | typeof TOUCH_CARD;

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, SFMono-Regular, Menlo, monospace" });

export function detailCardFrame(tokens: TaskTokens): ViewStyle {
  return {
    backgroundColor: tokens.card.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.card.border,
    borderRadius: DETAIL_CARD.radius,
    boxShadow: tokens.card.shadow,
  } as ViewStyle;
}

/** One raised card of the stack. */
export function DetailCard(props: { tokens: TaskTokens; style?: ViewStyle; testID?: string; children: React.ReactNode }) {
  return (
    <View testID={props.testID} style={[detailCardFrame(props.tokens), { paddingVertical: DETAIL_CARD.padV }, props.style]}>
      {props.children}
    </View>
  );
}

function statusColor(kind: StatusKind, tokens: TaskTokens): string {
  if (kind === "running") return tokens.status.running;
  if (kind === "needs_input") return tokens.warning;
  if (kind === "unread") return tokens.success;
  if (kind === "failed") return tokens.danger;
  return tokens.foregroundMuted;
}

export interface DetailCardsStrings {
  pin: string;
  unpin: string;
  pinned: string;
  close: string;
  back(title: string): string;
  stopRun: string;
  openTab: string;
  openToAnswer: string;
  property: { project: string; parent: string; branch: string; cwd: string; pr: string; labels: string };
}

export interface DetailNotice {
  icon: string;
  text: string;
  action?: { label: string; onPress(): void };
}

export interface TaskDetailCardsProps extends TimeSource {
  card: TaskCard;
  theme: PluginTheme;
  language: TasksLanguage;
  strings: DetailCardsStrings;
  /** Touch sizes: the phone's sheet, a tablet's sidebar. */
  touch?: boolean;
  pinned?: boolean;
  onTogglePin?(): void;
  onClose?(): void;
  /** The card to go back to after a parent or subtask jump. */
  back?: { title: string; onPress(): void } | null;
  notice?: DetailNotice | null;
  onOpen?(agentId: string): void;
  /** Stop, when the card can be stopped; its phase names the button. */
  stop?: { phase: StopPhase; onPress(): void } | null;
  permissionButtons?: PermissionButton[];
  onPermission?(button: PermissionButton): void;
  /** A parent or subtask row: show that card. */
  onJump?(agentId: string): void;
  testID?: string;
}

/** The header card: what the agent is, what it is doing, and the actions on it. */
export function DetailHeaderCard(props: TaskDetailCardsProps) {
  const { card, touch = false } = props;
  const tokens = taskTokens(props.theme);
  const m: Metrics = touch ? TOUCH_CARD : DETAIL_CARD;
  const cardText = cardStrings(props.language);
  const now = useTime(props, (time) => time);
  const timer = cardTimer(card, now, props.language);
  const kind = card.stoppedManually ? "stopped" : card.status;
  const muted: TextStyle = { fontSize: m.font, lineHeight: m.font + 5, color: tokens.foregroundMuted };
  const small = touch ? 14 : 12;

  const meta: React.ReactNode[] = [];
  const iconSize = touch ? 15 : 14;
  meta.push(
    <MetaItem key="model" testID="detail-model" lead={card.providerMark !== null ? <BrandMark provider={card.provider} size={iconSize} tokens={tokens} /> : null}>
      <Text style={[muted, { color: tokens.foreground }]}>{card.modelLabel ?? card.providerLabel}</Text>
    </MetaItem>,
  );
  if (card.thinkingLabel) {
    meta.push(
      <MetaItem key="thinking" testID="detail-thinking" lead={<Icon name={THINKING_ICON} size={iconSize} color={tokens.foregroundMuted} />}>
        <Text style={muted}>{card.thinkingLabel}</Text>
      </MetaItem>,
    );
  }
  if (card.modeLabel) {
    meta.push(
      <MetaItem key="mode" testID="detail-mode" lead={<Icon name={modeIcon(card.provider, card.modeLabel)} size={iconSize} color={tokens.foregroundMuted} />}>
        <Text style={muted}>{card.modeLabel}</Text>
      </MetaItem>,
    );
  }

  const buttons = props.permissionButtons ?? [];
  const asking = card.lane === "needs_input";
  const stopLabel = props.stop
    ? props.stop.phase === "confirming"
      ? cardText.confirmStop
      : props.stop.phase === "stopping"
        ? cardText.stopping
        : props.strings.stopRun
    : null;

  return (
    <DetailCard tokens={tokens} style={{ paddingHorizontal: m.padH, paddingTop: 8, paddingBottom: 12, gap: 6 }} testID="detail-header">
      {props.back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.strings.back(props.back.title)}
          onPress={props.back.onPress}
          testID="detail-back"
          style={{ minHeight: touch ? 36 : 24, flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}
        >
          <Icon name="ArrowLeft" size={14} color={tokens.foregroundMuted} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: small, color: tokens.foregroundMuted }}>
            {props.strings.back(props.back.title)}
          </Text>
          {Platform.OS === "web" && !touch ? <KeyCap label="Esc" tokens={tokens} /> : null}
        </Pressable>
      ) : null}
      {props.notice ? (
        <View testID="detail-notice" style={{ minHeight: touch ? 36 : 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 6, backgroundColor: tokens.surface1 }}>
          <Icon name={props.notice.icon} size={14} color={tokens.foregroundMuted} />
          <Text numberOfLines={2} style={{ flex: 1, fontSize: small, color: tokens.foregroundMuted }}>
            {props.notice.text}
          </Text>
          {props.notice.action ? (
            <Pressable accessibilityRole="button" onPress={props.notice.action.onPress} hitSlop={6}>
              <Text style={{ fontSize: small, fontWeight: "500", color: tokens.accentText }}>{props.notice.action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={{ minHeight: m.round, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <StatusIcon kind={kind} size={16} theme={props.theme} />
        <Text style={{ fontSize: small, fontWeight: "600", color: card.stoppedManually ? tokens.foregroundMuted : statusColor(card.status, tokens) }}>
          {card.stoppedManually ? card.error ?? cardText.status.done : cardText.status[card.status]}
        </Text>
        {timer ? (
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: small, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>
            {timer.text}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {props.pinned && !touch ? <Text style={{ fontSize: 12, color: tokens.foregroundMuted }}>{props.strings.pinned}</Text> : null}
        {props.onTogglePin ? (
          <RoundIcon
            icon={props.pinned ? "PinOff" : "Pin"}
            label={props.pinned ? props.strings.unpin : props.strings.pin}
            size={m.round}
            tokens={tokens}
            active={props.pinned}
            onPress={props.onTogglePin}
            testID="detail-pin"
          />
        ) : null}
        {props.onClose ? <RoundIcon icon="X" label={props.strings.close} size={m.round} tokens={tokens} onPress={props.onClose} testID="detail-close" /> : null}
      </View>
      <Text style={{ fontSize: m.title, lineHeight: m.title + 6, fontWeight: "600", color: tokens.foreground }} testID="detail-title">
        {card.title}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6, rowGap: 2 }} testID="detail-agent">
        {meta.flatMap((item, index) => (index === 0 ? [item] : [<Text key={`dot-${index}`} style={muted}>·</Text>, item]))}
      </View>
      {card.error && !card.stoppedManually ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 2 }} testID="detail-error">
          <View style={{ height: 18, justifyContent: "center" }}>
            <Icon name="CircleX" size={m.icon} color={tokens.danger} />
          </View>
          <Text style={{ flex: 1, fontSize: m.font, lineHeight: 18, color: tokens.foreground }}>{card.error}</Text>
        </View>
      ) : null}
      {card.permission ? (
        <View
          testID="detail-permission"
          style={{ marginTop: 2, paddingVertical: 8, paddingHorizontal: 10, gap: 4, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.border, backgroundColor: tokens.surface1 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="ShieldAlert" size={14} color={tokens.warning} />
            <Text style={{ flex: 1, fontSize: small, fontWeight: "600", color: tokens.warning }} numberOfLines={2}>
              {card.permission.title}
            </Text>
          </View>
          {card.permission.summary ? <Text style={{ fontSize: m.font, lineHeight: 18, color: tokens.foreground, fontFamily: MONO }}>{card.permission.summary}</Text> : null}
        </View>
      ) : null}
      {asking && buttons.length > 0 && props.onPermission ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }} testID="detail-permission-buttons">
          {buttons
            .filter((button) => button.kind !== "open")
            .map((button) => (
              <ActionButton key={button.key} button={button} tokens={tokens} compact={touch} onPress={() => props.onPermission?.(button)} />
            ))}
        </View>
      ) : null}
      {props.onOpen || stopLabel ? (
        <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }} testID="detail-actions">
          {props.onOpen ? (
            <OutlineButton
              icon="AppWindow"
              label={asking ? props.strings.openToAnswer : props.strings.openTab}
              trailing="ArrowUpRight"
              height={m.button}
              tokens={tokens}
              grow
              onPress={() => props.onOpen?.(card.id)}
              testID="detail-open"
            />
          ) : null}
          {stopLabel && props.stop ? (
            <OutlineButton icon="CircleStop" label={stopLabel} height={m.button} tokens={tokens} danger onPress={props.stop.onPress} testID="detail-stop" />
          ) : null}
        </View>
      ) : null}
    </DetailCard>
  );
}

/** The cards under the header: where the agent works, its subtasks, its usage. */
export function DetailBodyCards(props: TaskDetailCardsProps) {
  const tokens = taskTokens(props.theme);
  const m: Metrics = props.touch ? TOUCH_CARD : DETAIL_CARD;
  const now = useTime(props, (time) => time);
  return (
    <View style={{ gap: DETAIL_CARD.gap }}>
      <LocationCard {...props} m={m} tokens={tokens} />
      {props.card.children.length > 0 ? <SubtasksCard {...props} m={m} tokens={tokens} /> : null}
      <UsageCard card={props.card} now={now} m={m} tokens={tokens} language={props.language} />
    </View>
  );
}

/** The whole stack, header first. */
export function TaskDetailCards(props: TaskDetailCardsProps) {
  return (
    <View style={{ gap: DETAIL_CARD.gap }} testID={props.testID ?? "detail-cards"}>
      <DetailHeaderCard {...props} />
      <DetailBodyCards {...props} />
    </View>
  );
}

function MetaItem(props: { lead: React.ReactNode; testID: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }} testID={props.testID}>
      {props.lead}
      {props.children}
    </View>
  );
}

function KeyCap(props: { label: string; tokens: TaskTokens }) {
  return (
    <View style={{ height: 16, paddingHorizontal: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: props.tokens.border, borderRadius: 3, justifyContent: "center" }}>
      <Text style={{ fontSize: 11, color: props.tokens.foregroundMuted }}>{props.label}</Text>
    </View>
  );
}

/** A round icon button: transparent at rest, filled on hover, grey when on (Linear's header buttons). */
export function RoundIcon(props: { icon: string; label: string; size: number; tokens: TaskTokens; active?: boolean; onPress(): void; testID?: string }) {
  const { hovered, hoverProps } = useHover();
  const fill = props.active ? props.tokens.surface2 : hovered ? props.tokens.card.controlHover : "transparent";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={props.active === undefined ? undefined : { selected: props.active }}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={{
        width: props.size,
        height: props.size,
        marginVertical: -(props.size - 18) / 2,
        borderRadius: props.size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: fill,
      }}
    >
      <Icon name={props.icon} size={15} color={props.active ? props.tokens.accent : hovered ? props.tokens.foreground : props.tokens.foregroundMuted} />
    </Pressable>
  );
}

function OutlineButton(props: {
  icon: string;
  label: string;
  trailing?: string;
  height: number;
  tokens: TaskTokens;
  grow?: boolean;
  danger?: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { tokens } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  const color = props.danger ? tokens.danger : tokens.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={{
        flexGrow: props.grow ? 1 : 0,
        flexShrink: 1,
        height: taskControlHeight(props.height, scale),
        paddingHorizontal: 10,
        borderRadius: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: props.danger ? tokens.card.dangerFill : tokens.card.pillBorder,
        backgroundColor: hovered ? (props.danger ? tokens.card.dangerFill : tokens.card.controlHover) : tokens.card.background,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Icon name={props.icon} size={15} color={props.danger ? tokens.danger : tokens.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontWeight: "500", color }}>
        {props.label}
      </Text>
      {props.trailing ? (
        <>
          <View style={{ flex: 1 }} />
          <Icon name={props.trailing} size={14} color={tokens.foregroundMuted} />
        </>
      ) : null}
    </Pressable>
  );
}

/** A property row: a muted label column, an icon, the value. Pressable rows fill on hover. */
function PropertyRow(props: {
  m: Metrics;
  tokens: TaskTokens;
  label: string;
  lead: React.ReactNode;
  wraps?: boolean;
  onPress?(): void;
  accessibilityLabel?: string;
  trailing?: React.ReactNode;
  testID?: string;
  children: React.ReactNode;
}) {
  const { m, tokens } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  const height = taskControlHeight(m.row, scale);
  const line = Math.round((m.font + 6) * scale);
  const content = (
    <>
      <Text numberOfLines={1} style={{ width: DETAIL_CARD.labelWidth * Math.max(1, scale), fontSize: m.font, lineHeight: line, color: tokens.foregroundMuted }}>
        {props.label}
      </Text>
      <View style={{ width: m.icon, height: props.wraps ? line : m.icon, alignItems: "center", justifyContent: "center" }}>{props.lead}</View>
      <View style={{ flex: 1, minWidth: 0 }}>{props.children}</View>
      {props.trailing}
    </>
  );
  const style: ViewStyle = {
    minHeight: height,
    marginHorizontal: 6,
    paddingHorizontal: 6,
    paddingVertical: props.wraps ? (height - line) / 2 : 0,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: props.wraps ? "flex-start" : "center",
    gap: DETAIL_CARD.labelGap,
  };
  if (!props.onPress) {
    return (
      <View testID={props.testID} style={style}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={({ pressed }) => ({ ...style, backgroundColor: hovered || pressed ? tokens.card.controlHover : "transparent" })}
    >
      {content}
    </Pressable>
  );
}

/** A value that copies on a press; the copy mark shows on hover and turns into a check. */
function CopyValue(props: { m: Metrics; tokens: TaskTokens; label: string; text: string; copyText: string; toastLabel: string; path?: boolean; icon: string; hint?: React.ReactNode; testID: string; accessibilityLabel: string }) {
  const { m, tokens } = props;
  const scale = useTasksFontScale();
  const { copied, copy } = useCopy();
  const [columns, setColumns] = useState<number | null>(null);
  const onLayout = props.path
    ? (event: LayoutChangeEvent) => {
        const next = Math.max(8, Math.floor(event.nativeEvent.layout.width / (Math.round(m.font * scale) * 0.56)));
        setColumns((was) => (was === next ? was : next));
      }
    : undefined;
  const shown = props.path ? shortenPath(props.text, columns ?? 28) : props.text;
  return (
    <PropertyRow
      m={m}
      tokens={tokens}
      label={props.label}
      lead={<Icon name={props.icon} size={m.icon - 2} color={tokens.foregroundMuted} />}
      onPress={() => void copy(props.copyText, { label: props.toastLabel })}
      accessibilityLabel={`${props.accessibilityLabel}: ${props.copyText}`}
      testID={props.testID}
      trailing={
        <>
          {props.hint}
          <View style={{ width: 14, alignItems: "center", opacity: copied ? 1 : 0.55 }}>
            <Icon name={copied ? "Check" : "Copy"} size={13} color={copied ? tokens.success : tokens.foregroundMuted} />
          </View>
        </>
      }
    >
      <View onLayout={onLayout}>
        <Text numberOfLines={1} style={{ fontSize: m.font, color: tokens.foreground }}>
          {shown}
        </Text>
      </View>
    </PropertyRow>
  );
}

function LocationCard(props: TaskDetailCardsProps & { m: Metrics; tokens: TaskTokens }) {
  const { card, m, tokens } = props;
  const words = props.strings.property;
  const cardText = cardStrings(props.language);
  const location = card.location;
  const rows: React.ReactNode[] = [];
  if (location.projectName || location.workspaceName) {
    const kind = location.workspaceKind ? cardText.kind[location.workspaceKind] : null;
    rows.push(
      <PropertyRow
        key="place"
        m={m}
        tokens={tokens}
        label={words.project}
        lead={<ProjectIcon location={location} size={m.icon - 2} />}
        trailing={kind ? <Text style={{ fontSize: m.font - 1, color: tokens.foregroundMuted }}>{kind}</Text> : null}
        testID="detail-place"
      >
        <Text numberOfLines={1} style={{ fontSize: m.font, color: tokens.foreground }}>
          {location.projectName && location.workspaceName ? <Text style={{ color: tokens.foregroundMuted }}>{`${location.projectName} › `}</Text> : null}
          {location.workspaceName ?? location.projectName}
        </Text>
      </PropertyRow>,
    );
  }
  if (card.parent) {
    const parent = card.parent;
    const title = parent.title ?? (parent.missing ? cardText.parentArchived : cardText.parentUnknown);
    rows.push(
      <PropertyRow
        key="parent"
        m={m}
        tokens={tokens}
        label={words.parent}
        lead={<Icon name="CornerLeftUp" size={m.icon - 2} color={tokens.foregroundMuted} />}
        onPress={props.onJump && !parent.missing ? () => props.onJump?.(parent.id) : undefined}
        accessibilityLabel={`${words.parent}: ${title}`}
        trailing={props.onJump && !parent.missing ? <Icon name="ChevronRight" size={14} color={tokens.foregroundMuted} /> : null}
        testID="detail-parent"
      >
        <Text numberOfLines={1} style={{ fontSize: m.font, color: tokens.foreground }}>
          {title}
        </Text>
      </PropertyRow>,
    );
  }
  if (location.branch) {
    const hint = branchHint(location.git);
    rows.push(
      <CopyValue
        key="branch"
        m={m}
        tokens={tokens}
        label={words.branch}
        icon="GitBranch"
        text={location.branch}
        copyText={location.branch}
        toastLabel="Copy branch name"
        accessibilityLabel={cardText.details.copyBranch}
        testID="detail-branch"
        hint={
          hint.sync || hint.dirty ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {hint.sync ? <Text style={{ fontSize: m.font - 1, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{hint.sync}</Text> : null}
              {hint.dirty ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.warning }} />
                  <Text style={{ fontSize: m.font - 1, color: tokens.warning }}>{cardText.uncommitted}</Text>
                </View>
              ) : null}
            </View>
          ) : null
        }
      />,
    );
  } else if (location.git === null) {
    rows.push(
      <PropertyRow key="branch" m={m} tokens={tokens} label={words.branch} lead={<Icon name="GitBranch" size={m.icon - 2} color={tokens.foregroundMuted} />} testID="detail-branch">
        <Text style={{ fontSize: m.font, color: tokens.foregroundMuted }}>{cardText.details.notGit}</Text>
      </PropertyRow>,
    );
  }
  rows.push(
    <CopyValue
      key="cwd"
      m={m}
      tokens={tokens}
      label={words.cwd}
      icon="Folder"
      text={tildePath(location.cwd)}
      copyText={location.cwd}
      toastLabel="Copy path"
      accessibilityLabel={cardText.details.copyPath}
      path
      testID="detail-cwd"
    />,
  );
  if (location.pullRequest) {
    const pr = location.pullRequest;
    rows.push(
      <CopyValue
        key="pr"
        m={m}
        tokens={tokens}
        label={words.pr}
        icon="GitPullRequest"
        text={`${pr.number !== null ? `#${pr.number} ` : ""}${pr.title}`}
        copyText={pr.url}
        toastLabel="Copy URL"
        accessibilityLabel={cardText.details.copyLink}
        testID="detail-pr"
      />,
    );
  }
  if (card.labels.length > 0) {
    rows.push(
      <PropertyRow key="labels" m={m} tokens={tokens} label={words.labels} lead={<Icon name="Tag" size={m.icon - 2} color={tokens.foregroundMuted} />} wraps testID="detail-labels">
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 2 }}>
          {card.labels.map((tag) => (
            <View key={tag.name} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: tag.color ?? tokens.foregroundMuted }} />
              <Text style={{ fontSize: m.font, lineHeight: m.font + 6, color: tokens.foreground }}>{tag.name}</Text>
            </View>
          ))}
        </View>
      </PropertyRow>,
    );
  }
  return (
    <DetailCard tokens={tokens} testID="detail-location">
      {rows}
    </DetailCard>
  );
}

function SubtasksCard(props: TaskDetailCardsProps & { m: Metrics; tokens: TaskTokens }) {
  const { card, m, tokens } = props;
  const scale = useTasksFontScale();
  const cardText = cardStrings(props.language);
  const done = card.children.filter((child) => child.status === "done").length;
  const shown = card.children.slice(0, SUBTASK_ROWS * 2);
  const rest = card.children.length - shown.length;
  return (
    <DetailCard tokens={tokens} testID="detail-subtasks">
      <View style={{ height: taskControlHeight(30, scale), paddingHorizontal: DETAIL_CARD.padH, flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, fontSize: m.font - 1, fontWeight: "500", color: tokens.foregroundMuted }}>{cardText.details.subtasks}</Text>
        <Text style={{ fontSize: m.font - 1, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{cardText.details.subtasksDone(done, card.children.length)}</Text>
      </View>
      {shown.map((child) => (
        <SubtaskRow key={child.id} m={m} tokens={tokens} theme={props.theme} title={child.title} status={child.status} word={cardText.status[child.status]} onPress={props.onJump ? () => props.onJump?.(child.id) : undefined} />
      ))}
      {rest > 0 ? (
        <View style={{ height: taskControlHeight(m.listRow, scale), paddingHorizontal: DETAIL_CARD.padH, justifyContent: "center" }}>
          <Text style={{ fontSize: m.font, color: tokens.foregroundMuted }}>{cardText.more(rest)}</Text>
        </View>
      ) : null}
    </DetailCard>
  );
}

function SubtaskRow(props: { m: Metrics; tokens: TaskTokens; theme: PluginTheme; title: string; status: StatusKind; word: string; onPress?(): void }) {
  const { m, tokens } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.title} ${props.word}`}
      disabled={!props.onPress}
      onPress={props.onPress}
      {...hoverProps}
      style={({ pressed }) => ({
        height: taskControlHeight(m.listRow, scale),
        marginHorizontal: 6,
        paddingHorizontal: 6,
        borderRadius: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: props.onPress && (hovered || pressed) ? tokens.card.controlHover : "transparent",
      })}
    >
      <StatusIcon kind={props.status} size={m.icon - 2} theme={props.theme} animated={false} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: m.font, color: tokens.foreground }}>
        {props.title}
      </Text>
      <Text style={{ fontSize: m.font - 1, color: tokens.foregroundMuted }}>{props.word}</Text>
      {props.onPress ? <Icon name="ChevronRight" size={14} color={tokens.foregroundMuted} /> : null}
    </Pressable>
  );
}

function UsageCard(props: { card: TaskCard; now: number; m: Metrics; tokens: TaskTokens; language: TasksLanguage }) {
  const { card, m, tokens } = props;
  const scale = useTasksFontScale();
  const words = cardStrings(props.language).details;
  const rows = usageRows(card, props.now, props.language);
  const ratio = contextRatio(card.context);
  const tone = ratio !== null ? contextRingTone(ratio) : "normal";
  const toneColor = tone === "danger" ? tokens.danger : tone === "warning" ? tokens.warning : tokens.foregroundMuted;
  if (rows.length === 0 && !card.context) return null;
  const line = (key: string, label: string, children: React.ReactNode) => (
    <View key={key} testID={`detail-usage-${key}`} style={{ height: taskControlHeight(m.listRow, scale), paddingHorizontal: DETAIL_CARD.padH, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: m.font, color: tokens.foregroundMuted }}>
        {label}
      </Text>
      {children}
    </View>
  );
  const value = (text: string) => <Text style={{ fontSize: m.font, color: tokens.foreground, fontVariant: ["tabular-nums"] }}>{text}</Text>;
  return (
    <DetailCard tokens={tokens} testID="detail-usage">
      {rows.map((row) =>
        line(
          row.key,
          row.label,
          <>
            {row.hint ? <Text style={{ fontSize: m.font - 1, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{row.hint}</Text> : null}
            {value(row.value)}
          </>,
        ),
      )}
      {card.context ? (
        <>
          {line(
            "context",
            words.context,
            <>
              {ratio !== null ? <Text style={{ fontSize: m.font, fontWeight: "600", color: toneColor, fontVariant: ["tabular-nums"] }}>{`${Math.round(ratio * 100)}%`}</Text> : null}
              {value(`${formatTokens(card.context.usedTokens)} / ${formatTokens(card.context.maxTokens)}`)}
            </>,
          )}
          {ratio !== null ? (
            <View testID="detail-context-bar" style={{ height: 4, borderRadius: 2, marginHorizontal: DETAIL_CARD.padH, marginBottom: 8, backgroundColor: tokens.surface2, overflow: "hidden" }}>
              <View style={{ width: `${Math.round(ratio * 1000) / 10}%`, height: 4, borderRadius: 2, backgroundColor: toneColor }} />
            </View>
          ) : null}
        </>
      ) : null}
    </DetailCard>
  );
}
