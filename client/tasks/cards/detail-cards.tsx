import React, { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { openLink } from "../../components/open-link";
import { MarkdownView } from "../../components/markdown/markdown-view";
import { variantMetrics } from "../../components/markdown/render/styles";
import { useThemeTokens, withAlpha } from "../../components/theme-tokens";
import { useEnhancerPreferences } from "../../preferences";
import { TaskText as Text, TASK_MONO as MONO, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import { useHover } from "../../ui/use-hover";
import { useCopy } from "../../ui/use-copy";
import type { TasksLanguage } from "../i18n";
import type { SessionTokens } from "../../../shared/tasks-rpc";
import { opensInPaseo, turnRunning, type PermissionKind, type TaskCard, type TaskChild } from "../model";
import type { PermissionButton, StopPhase } from "../actions";
import type { FirstPrompt } from "../data/first-prompt";
import type { LastMessage } from "../data/last-message";
import { formatDuration, formatRelative, formatTokenTotal, since, tildePath } from "./format";
import { cardStrings } from "./strings";
import { taskTokens, type TaskTokens } from "./tokens";
import { TagMark } from "./tag-mark";
import { modeIcon, THINKING_ICON } from "./mode-icons";
import { BrandMark } from "./brand-mark";
import { ChildMark } from "./child-mark";
import { useTime, type TimeSource } from "./clock";
import { ProjectIcon } from "./project-icon";
import { SpinnerRing, StatusIcon } from "./status-icon";
import { cardTimer } from "./card-time";
import {
  branchHint,
  breakable,
  foldPath,
  NARROW_SUBTASKS,
  pathTokens,
  sortSubtasks,
  SUBTASK_ROWS,
  subtaskFinished,
  subtaskHeading,
  subtaskMeta,
  subtaskModels,
  subtaskTime,
  titlePrefix,
  type SubtaskMetaPart,
  type SubtaskSummaryPart,
} from "./details-format";
import { buttonHue, CardButton, CONFIRM_STOP_ICON, requestLook, type CardButtonLook } from "./task-card";
import { buttonOutline } from "../board/board-style";
import {
  contextView,
  detailHero,
  detailSections,
  errorLines,
  formatSpan,
  formatTurnClock,
  summaryTiles,
  timeline,
  tokenMix,
  usageSummary,
  type DetailSection,
} from "./detail-model";
import { Chip, ContextBar, SummaryTiles, TimelineChart, TokenBar, TurnHero, detailColors, statusColor } from "./detail-charts";
import { detailGutter, detailScrollProps } from "./detail-scrollbar";
import { sectionClosed, setSectionClosed, useSectionChoices } from "./detail-collapse";

/**
 * The details as one raised card, after Linear's issue panel
 * (`docs/prototypes/task-details-rich.md`): the header (status, title, the
 * agent's chips and labels, the actions), then the block the card needs
 * first (the running turn, the permission request, the error, or a summary),
 * then collapsible sections: the first prompt, the latest reply, properties, subtasks, usage and activity, in an
 * order that follows the state. The desktop sidebar draws it at desktop
 * sizes; the phone's sheet and a tablet's touch sidebar at touch sizes.
 */
export const DETAIL_CARD = {
  radius: 12,
  gap: 8,
  padH: 12,
  padV: 6,
  row: 32,
  listRow: 30,
  heading: 32,
  /** Body text: the host's base step. */
  font: F.sm,
  /** The card's title: the host's large step. */
  title: F.base,
  icon: 16,
  chip: 22,
  button: 32,
  round: 28,
} as const;

const TOUCH_CARD = { ...DETAIL_CARD, row: 44, listRow: 44, heading: 44, icon: 18, chip: 28, button: 44, round: 36 } as const;

type Metrics = typeof DETAIL_CARD | typeof TOUCH_CARD;

/** Code lines (a permission's command, an error), 1.5 of their size as the host spaces its diff lines. */
const CODE_LINE = Math.round(F.sm * 1.5);

/** The properties get a label column from this width and lose it under `hide`: the 8 between keeps a drag from flickering it. */
const LABEL_COLUMN = { show: 448, hide: 440 } as const;

/**
 * On the web a row with buttons inside is a focusable `group`, not a button:
 * a `<button>` inside another is invalid HTML (see `task-card.tsx`).
 */
const ROW_ROLE = Platform.OS === "web" ? ({ role: "group" } as const) : ({ accessibilityRole: "button" } as const);

export function detailCardFrame(tokens: TaskTokens): ViewStyle {
  return {
    backgroundColor: tokens.card.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.card.border,
    borderRadius: DETAIL_CARD.radius,
    boxShadow: tokens.card.shadow,
  } as ViewStyle;
}

/** One raised card of the sidebar. */
export function DetailCard(props: { tokens: TaskTokens; style?: ViewStyle; testID?: string; children: React.ReactNode }) {
  return (
    <View testID={props.testID} style={[detailCardFrame(props.tokens), { paddingVertical: DETAIL_CARD.padV }, props.style]}>
      {props.children}
    </View>
  );
}

export interface DetailCardsStrings {
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
  /** The task's first prompt, read from its timeline; absent leaves the section out (the settings preview). */
  firstPrompt?: { prompt: FirstPrompt; load(): void } | null;
  /** The agent's latest reply, read from its timeline's tail; absent leaves the section out. */
  lastMessage?: { prompt: LastMessage; load(): void } | null;
  /** A running task's whole session's tokens, from the provider's session files; absent leaves them out of the running turn. */
  sessionTokens?: SessionTokens | null;
  /** Unarchive for an archived parent, and for an archived card itself; absent where this host cannot. */
  unarchive?: { pending(agentId: string): boolean; press(agentId: string): void } | null;
  /** Archive for a done task; absent where the board has none (the settings preview). */
  archive?: { pending(agentId: string): boolean; press(agentId: string): void } | null;
  /** The sections scroll under the fixed header (the sidebar); else the card grows with them (the sheet). */
  scrollBody?: boolean;
  /**
   * Two columns that scroll on their own: the header (with the subtasks, when
   * the card has them) on the left, the other sections on the right. A
   * tablet's wide bottom sheet, where one column ran tall and sparse. The
   * card fills its parent.
   */
  columns?: boolean;
  /** False when the actions live elsewhere (the phone's bar under the sheet). */
  actions?: boolean;
  testID?: string;
}

const MINUTE = 60_000;

/** The details card: the header and the lead block, then the sections. */
export function TaskDetailCards(given: TaskDetailCardsProps) {
  // An archived task has no Open, here or on its subtasks: Paseo would show another tab.
  const props = opensInPaseo(given.card) ? given : { ...given, onOpen: undefined };
  const { card } = props;
  const tokens = taskTokens(props.theme);
  const m: Metrics = props.touch ? TOUCH_CARD : DETAIL_CARD;
  // Minutes are enough for "8 分钟前"; the running timer reads the clock itself.
  const now = useTime(props, (time) => Math.floor(time / MINUTE) * MINUTE);
  // The caller's source, for what ticks each second: `now` below is whole minutes.
  const time: TimeSource = { now: props.now, clock: props.clock };
  const choices = useSectionChoices();
  const { order, closed } = detailSections(card, !!props.firstPrompt, !!props.lastMessage);
  // Two columns: the subtasks sit under the header, everything else on the right.
  const leftSections: DetailSection[] = props.columns ? order.filter((section) => section === "subtasks") : [];
  const rightOrder = order.filter((section) => !leftSections.includes(section));
  // A scroller's content gives its scrollbar the right edge of its padding (`detail-scrollbar.ts`).
  const gutter = props.columns || props.scrollBody ? detailGutter("inset") : 0;
  const sectionView = (section: DetailSection, divider: boolean) => (
    <Section
      key={section}
      section={section}
      divider={divider}
      closed={sectionClosed(choices, section, closed.includes(section))}
      {...props}
      m={m}
      tokens={tokens}
      now={now}
      time={time}
      gutter={gutter}
    />
  );
  const sections = order.map((section) => sectionView(section, true));
  if (props.columns) {
    return (
      <View testID={props.testID ?? "detail-cards"} style={[detailCardFrame(tokens), { flex: 1, minHeight: 0, flexDirection: "row" }]}>
        {/* Plain views share the width (a ScrollView's own flex is not honoured on iOS); each scroll fills its half. */}
        <View style={{ flex: 1.2, minWidth: 0 }}>
          <ScrollView key={`${card.id}-head`} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 4 }} {...detailScrollProps("inset")} testID="detail-column-head">
            <DetailHeader {...props} m={m} tokens={tokens} now={now} time={time} gutter={gutter} />
            {leftSections.map((section) => sectionView(section, true))}
          </ScrollView>
        </View>
        <View style={{ width: StyleSheet.hairlineWidth, marginVertical: 12, backgroundColor: tokens.card.border }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <ScrollView key={`${card.id}-sections`} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 2, paddingBottom: 4 }} {...detailScrollProps("inset")} testID="detail-column-sections">
            {rightOrder.map((section, index) => sectionView(section, index > 0))}
          </ScrollView>
        </View>
      </View>
    );
  }
  return (
    <View testID={props.testID ?? "detail-cards"} style={[detailCardFrame(tokens), props.scrollBody ? { flexShrink: 1, minHeight: 0 } : null]}>
      <DetailHeader {...props} m={m} tokens={tokens} now={now} time={time} />
      {props.scrollBody ? (
        <ScrollView key={card.id} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 4 }} {...detailScrollProps("inset")} testID="detail-body-scroll">
          {sections}
        </ScrollView>
      ) : (
        <View style={{ paddingBottom: 4 }}>{sections}</View>
      )}
    </View>
  );
}

/** `gutter`: the room a scroller's scrollbar takes from the right padding (0 outside one). */
type Inner = TaskDetailCardsProps & { m: Metrics; tokens: TaskTokens; now: number; time: TimeSource; gutter?: number };

function stopLabel(props: TaskDetailCardsProps): string | null {
  if (!props.stop) return null;
  const cardText = cardStrings(props.language);
  // Stopping keeps the rest label; the button's spinner says it is working.
  if (props.stop.phase === "confirming") return cardText.confirmStop;
  return props.strings.stopRun;
}

function openLabel(props: TaskDetailCardsProps): string {
  if (props.card.lane === "needs_input") return props.strings.openToAnswer;
  return props.card.openTab ? cardStrings(props.language).details.switchTab : props.strings.openTab;
}

/** The header: status, title, the agent's chips and labels, the actions, then the block the card needs first. */
function DetailHeader(props: Inner) {
  const { card, m, tokens, touch = false } = props;
  const cardText = cardStrings(props.language);
  const small = F.sm;
  const chipFont = F.sm;
  const iconSize = touch ? 16 : 14;
  const kind = card.stoppedManually ? "stopped" : card.status;
  const hero = detailHero(card);
  const mode = card.modeLabel ? modeIcon(card.provider, card.modeLabel) : null;
  const stop = stopLabel(props);
  // An archived task can be brought back; one of an archived workspace has nothing of its own to unarchive.
  const unarchive = card.archived === "agent" ? props.unarchive ?? null : null;
  const archive = archivable(card) ? props.archive ?? null : null;
  const showActions = props.actions !== false && (!!props.onOpen || !!stop || !!unarchive || !!archive);
  // Open tab takes the row's room: first on desktop, last on touch, where the
  // phone's bar and the cards end with it too.
  const openButton = props.onOpen ? (
    <OutlineButton
      icon="AppWindow"
      label={openLabel(props)}
      hint={card.openTab ? <OpenHint tokens={tokens} label={cardText.details.tabOpen} /> : null}
      trailing="ArrowUpRight"
      height={m.button}
      font={m.font}
      tokens={tokens}
      grow
      onPress={() => props.onOpen?.(card.id)}
      testID="detail-open"
    />
  ) : null;
  // An archived task has no Open tab (Paseo would show another tab), so Unarchive takes its place.
  const unarchiveButton = unarchive ? (
    <OutlineButton
      icon="ArchiveRestore"
      label={cardText.details.unarchive}
      busy={unarchive.pending(card.id)}
      height={m.button}
      font={m.font}
      tokens={tokens}
      grow={!openButton}
      onPress={() => unarchive.press(card.id)}
      testID="detail-unarchive"
    />
  ) : null;
  // A done task's Archive sits beside Open tab.
  const archiveButton = archive ? (
    <OutlineButton
      icon="Archive"
      look="archive"
      label={cardText.details.archive}
      busy={archive.pending(card.id)}
      height={m.button}
      font={m.font}
      tokens={tokens}
      grow={!openButton}
      onPress={() => archive.press(card.id)}
      testID="detail-archive"
    />
  ) : null;
  const lead = openButton ?? unarchiveButton;
  return (
    <View style={{ paddingLeft: m.padH, paddingRight: m.padH - (props.gutter ?? 0), paddingTop: 8, paddingBottom: 12 }} testID="detail-header">
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
        <View testID="detail-notice" style={{ minHeight: touch ? 36 : 28, marginBottom: 4, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 6, backgroundColor: tokens.surface1 }}>
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
        <StatusIcon kind={kind} size={14} theme={props.theme} />
        <Text style={{ fontSize: small, fontWeight: "500", color: tokens.foreground }}>
          {card.stoppedManually ? cardText.details.stoppedTitle : cardText.status[card.status]}
        </Text>
        <StatusSub {...props} small={small} />
        <View style={{ flex: 1 }} />
        {props.onClose ? <RoundIcon icon="X" label={props.strings.close} size={m.round} tokens={tokens} onPress={props.onClose} testID="detail-close" /> : null}
      </View>
      <Text style={{ marginTop: 2, fontSize: m.title, lineHeight: HOST_LINE.base, fontWeight: "600", color: tokens.foreground }} testID="detail-title">
        {card.title}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }} testID="detail-agent">
        <Chip
          tokens={tokens}
          height={m.chip}
          font={chipFont}
          lead={card.providerMark !== null ? <BrandMark provider={card.provider} size={iconSize} tokens={tokens} /> : null}
          text={card.modelLabel ?? card.providerLabel}
          testID="detail-model"
        />
        {card.thinkingLabel ? (
          <Chip tokens={tokens} height={m.chip} font={chipFont} muted lead={<Icon name={THINKING_ICON} size={iconSize} color={tokens.foregroundMuted} />} text={card.thinkingLabel} testID="detail-thinking" />
        ) : null}
        {card.modeLabel && mode ? (
          <Chip
            tokens={tokens}
            height={m.chip}
            font={chipFont}
            muted
            // Bypassing permissions is worth a glance: its shield wears the warning colour.
            lead={<Icon name={mode} size={iconSize} color={mode === "ShieldOff" ? tokens.warning : tokens.foregroundMuted} />}
            text={card.modeLabel}
            testID="detail-mode"
          />
        ) : null}
      </View>
      {card.labels.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }} testID="detail-labels">
          {card.labels.map((tag) => (
            <Chip
              key={tag.name}
              tokens={tokens}
              height={m.chip}
              font={chipFont}
              lead={<TagMark size={iconSize} color={tag.color ?? tokens.foregroundMuted} hole={tokens.card.background} />}
              text={tag.name}
            />
          ))}
        </View>
      ) : null}
      {showActions ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }} testID="detail-actions">
          {touch ? null : lead}
          {stop && props.stop ? (
            <OutlineButton
              icon={props.stop.phase === "confirming" ? CONFIRM_STOP_ICON : "Power"}
              look="danger"
              label={stop}
              busy={props.stop.phase === "stopping"}
              height={m.button}
              font={m.font}
              tokens={tokens}
              onPress={props.stop.onPress}
              testID="detail-stop"
            />
          ) : null}
          {archiveButton}
          {openButton ? unarchiveButton : null}
          {touch ? lead : null}
        </View>
      ) : null}
      <View style={{ marginTop: 12 }}>
        {hero === "turn" ? <RunningTurn {...props} /> : null}
        {hero === "permission" ? <PermissionBlock {...props} /> : null}
        {hero === "error" ? <ErrorBlock {...props} /> : null}
        {hero === "summary" ? <SummaryTiles tiles={summaryTiles(card, props.now, props.language)} tokens={tokens} touch={touch} /> : null}
      </View>
    </View>
  );
}

/** Beside the status: the running turn's clock, else the card's timer ("等待 3m", "约 8m · 12 分钟前"). */
function StatusSub(props: Inner & { small: number }) {
  const { card, tokens } = props;
  const running = turnRunning(card) && card.timing.turnStartedAt !== null;
  const text = useTime(props.time, (time) => {
    const ran = running ? since(card.timing.turnStartedAt, time) : null;
    if (ran !== null) return cardStrings(props.language).details.turnClock(formatTurnClock(ran));
    return cardTimer(card, props.now, props.language)?.text ?? "";
  });
  if (!text) return null;
  return (
    <Text numberOfLines={2} style={{ flexShrink: 1, fontSize: props.small, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>
      {text}
    </Text>
  );
}

/** The running turn: its clock (ticking each second), the session's tokens so far and the context ring. */
function RunningTurn(props: Inner) {
  const { card } = props;
  const timer = useTime(props.time, (time) => {
    const ran = since(card.timing.turnStartedAt, time);
    return ran === null ? cardStrings(props.language).starting : formatTurnClock(ran);
  });
  return (
    <TurnHero
      timer={timer}
      lastTurn={card.timing.lastTurnMs !== null ? formatDuration(card.timing.lastTurnMs) : null}
      total={sessionTotal(props.sessionTokens ?? null, props.language)}
      context={contextView(card)}
      tokens={props.tokens}
      touch={props.touch === true}
      language={props.language}
    />
  );
}

/** The session's tokens as the running turn shows them: the total over the cached share. */
function sessionTotal(tokens: SessionTokens | null, language: TasksLanguage): { value: string; sub: string } | null {
  if (!tokens || tokens.total <= 0) return null;
  const words = cardStrings(language).details;
  return {
    value: formatTokenTotal(tokens.total),
    sub: tokens.cached > 0 ? words.cacheShare(`${Math.round((tokens.cached / tokens.total) * 100)}%`) : words.total,
  };
}

const PERMISSION_ICONS: Record<PermissionKind, string> = {
  tool: "SquareTerminal",
  plan: "ClipboardList",
  question: "MessageCircleQuestion",
  mode: "ShieldQuestion",
  other: "CircleHelp",
};

/** Needs input: the request, its command, and its buttons (unless the phone's bar has them). */
function PermissionBlock(props: Inner) {
  const { card, tokens, m } = props;
  const colors = detailColors(tokens);
  const words = cardStrings(props.language).details;
  const permission = card.permission!;
  const small = F.sm;
  const waited = since(card.timing.attentionAt, props.now) ?? since(card.timing.turnStartedAt, props.now);
  const buttons = props.actions !== false && props.onPermission ? (props.permissionButtons ?? []) : [];
  return (
    <View testID="detail-permission" style={{ borderWidth: 1, borderColor: tokens.border, borderRadius: 10, backgroundColor: colors.sunk }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
        <Icon name={PERMISSION_ICONS[permission.kind]} size={m.icon} color={tokens.status.warning} />
        <Text numberOfLines={2} style={{ flex: 1, fontSize: m.font, fontWeight: "500", color: tokens.foreground }}>
          {permission.title}
        </Text>
        {permission.remaining > 0 ? <Text style={{ fontSize: small, color: tokens.foregroundMuted }}>{words.moreRequests(permission.remaining)}</Text> : null}
      </View>
      {permission.summary ? (
        <View style={{ marginHorizontal: 12, marginTop: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: tokens.border, backgroundColor: tokens.card.background }}>
          <Text style={{ fontSize: F.sm, lineHeight: CODE_LINE, fontFamily: MONO, color: tokens.foreground }}>{permission.summary}</Text>
        </View>
      ) : null}
      {buttons.length > 0 ? (
        <View testID="detail-permission-buttons" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 }}>
          {buttons.map((button) => (
            <RequestButton key={button.key} button={button} tokens={tokens} height={props.touch ? 36 : 28} onPress={() => props.onPermission?.(button)} />
          ))}
          <View style={{ flex: 1 }} />
          {waited !== null ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="Hourglass" size={12} color={tokens.foregroundMuted} />
              <Text style={{ fontSize: F.sm, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{formatSpan(waited)}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ height: 12 }} />
      )}
    </View>
  );
}

/** The card's permission buttons, by `requestLook`: Allow's accent, Deny's danger, "Answer"'s amber, the rest plain. */
function RequestButton(props: { button: PermissionButton; tokens: TaskTokens; height: number; onPress(): void }) {
  const { button, tokens } = props;
  const { hovered, hoverProps } = useHover();
  const hue = buttonHue(tokens, requestLook(button));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={button.label}
      onPress={props.onPress}
      {...hoverProps}
      style={{
        height: props.height,
        paddingHorizontal: 14,
        borderRadius: 6,
        ...buttonOutline(hue.border),
        backgroundColor: hovered ? hue.hover : tokens.card.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: F.sm, fontWeight: "500", color: hue.color }}>
        {button.label}
      </Text>
    </Pressable>
  );
}

/** Failed or stopped: the error's first lines, copyable, with "show all" for a longer one. */
function ErrorBlock(props: Inner) {
  const { card, tokens, m } = props;
  const colors = detailColors(tokens);
  const words = cardStrings(props.language).details;
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy();
  const stopped = card.stoppedManually === true;
  const text = card.error ?? "";
  const lines = errorLines(text);
  const long = lines.length > 3 || text.length > 160;
  // A manual stop has no original to show: one line, in grey.
  const body = stopped && lines.length <= 1 ? null : text;
  return (
    <View
      testID="detail-error"
      style={{
        borderWidth: 1,
        borderColor: stopped ? tokens.border : colors.errorBorder,
        backgroundColor: stopped ? colors.sunk : colors.errorFill,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: body ? 10 : 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 }}>
        <Icon name={stopped ? "OctagonX" : "CircleAlert"} size={m.icon} color={stopped ? tokens.foregroundMuted : tokens.danger} />
        <Text style={{ flex: 1, fontSize: m.font, fontWeight: "500", color: tokens.foreground }}>{stopped ? words.stoppedTitle : words.failedTitle}</Text>
        {body ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={words.copyError}
            onPress={() => void copy(text, { label: "Copy error" })}
            hitSlop={6}
            style={{ width: 24, height: 24, marginRight: -6, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
          >
            <Icon name={copied ? "Check" : "Copy"} size={14} color={copied ? tokens.success : tokens.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
      {body ? (
        <>
          <Text numberOfLines={open ? undefined : 3} style={{ marginTop: 4, fontSize: F.sm, lineHeight: CODE_LINE, fontFamily: MONO, color: tokens.foreground }}>
            {body}
          </Text>
          {long ? (
            <Pressable accessibilityRole="button" onPress={() => setOpen((was) => !was)} hitSlop={4} style={{ marginTop: 6, alignSelf: "flex-start" }}>
              <Text style={{ fontSize: F.sm, color: tokens.foregroundMuted }}>{open ? words.showLess : words.showAll(lines.length)}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

// ---- Sections --------------------------------------------------------------

function Section(props: Inner & { section: DetailSection; closed: boolean; divider: boolean }) {
  const { card, m, tokens, section, gutter = 0 } = props;
  const words = cardStrings(props.language).details;
  const title = { prompt: words.prompt, message: words.message, properties: words.properties, subtasks: words.subtasks, usage: words.usage, activity: words.activity }[section];
  // A narrow card's subtasks drop the running count, the start times and the low context shares.
  const [narrow, setNarrow] = useState(false);
  const onLayout =
    section === "subtasks"
      ? (event: LayoutChangeEvent) => {
          const next = event.nativeEvent.layout.width <= NARROW_SUBTASKS;
          setNarrow((was) => (was === next ? was : next));
        }
      : undefined;
  const created = since(card.timing.createdAt, props.now);
  const heading = section === "subtasks" ? subtaskHeading(card.children, props.language, narrow) : null;
  const summary = {
    prompt: "",
    message: "",
    properties: card.location.branch ?? (card.location.git === null ? words.notGit : ""),
    subtasks: heading && heading.parts.length > 0 ? <SubtaskSummaryText parts={heading.parts} tokens={tokens} /> : "",
    usage: usageSummary(card, props.language),
    activity: created !== null ? words.createdAgo(formatRelative(created, props.language)) : "",
  }[section];
  const testID = { prompt: "detail-prompt", message: "detail-message", properties: "detail-location", subtasks: "detail-subtasks", usage: "detail-usage", activity: "detail-activity" }[section];
  // The last subtask row keeps 8 (touch 10) above the next hairline.
  const bottom = section === "subtasks" && m === TOUCH_CARD ? 10 : 8;
  return (
    <View testID={testID} onLayout={onLayout}>
      {props.divider ? <View style={{ height: StyleSheet.hairlineWidth, marginLeft: m.padH, marginRight: m.padH - gutter, backgroundColor: tokens.card.border }} /> : null}
      <View style={{ paddingTop: 4, paddingBottom: bottom, paddingLeft: m.padH - 6, paddingRight: m.padH - 6 - gutter }}>
        <SectionHeading
          m={m}
          tokens={tokens}
          title={title}
          summary={summary}
          summaryStyle={section === "properties" && card.location.branch ? { maxWidth: "60%", fontFamily: MONO } : undefined}
          trailing={heading?.check ? <Icon name="CircleCheck" size={14} color={tokens.success} /> : undefined}
          closed={props.closed}
          language={props.language}
          onPress={() => setSectionClosed(section, !props.closed)}
        />
        {props.closed ? null : section === "prompt" ? (
          <TimelineTextBody {...props} read={props.firstPrompt} id="detail-prompt" none={words.promptNone} error={words.promptError} copyLabel={words.copyPrompt} copyToast="Copy prompt" />
        ) : section === "message" ? (
          <TimelineTextBody {...props} read={props.lastMessage} id="detail-message" none={words.messageNone} error={words.messageError} copyLabel={words.copyMessage} copyToast="Copy message" />
        ) : section === "properties" ? (
          <Properties {...props} />
        ) : section === "subtasks" ? (
          <Subtasks {...props} narrow={narrow} />
        ) : section === "usage" ? (
          <Usage {...props} />
        ) : (
          <Activity {...props} />
        )}
      </View>
    </View>
  );
}

/** "1 needs input · 2 running · 4/8 done": each count in its status's colour and the words muted; a lone status word in its colour. */
function SubtaskSummaryText(props: { parts: SubtaskSummaryPart[]; tokens: TaskTokens }) {
  const { tokens } = props;
  return (
    <>
      {props.parts.map((part, index) => {
        const color = part.tone ? statusColor(part.tone, tokens) : undefined;
        return (
          <React.Fragment key={index}>
            {index > 0 ? " \u00b7 " : null}
            {part.count !== null ? <Text style={{ color }}>{part.count}</Text> : null}
            {part.count !== null ? ` ${part.text}` : color ? <Text style={{ color }}>{part.text}</Text> : part.text}
          </React.Fragment>
        );
      })}
    </>
  );
}

function SectionHeading(props: { m: Metrics; tokens: TaskTokens; title: string; summary: React.ReactNode; summaryStyle?: TextStyle; trailing?: React.ReactNode; closed: boolean; language: TasksLanguage; onPress(): void }) {
  const { m, tokens } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  const words = cardStrings(props.language).details;
  const color = hovered ? tokens.foreground : tokens.foregroundMuted;
  const font = F.sm;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.closed ? words.expand(props.title) : words.collapse(props.title)}
      accessibilityState={{ expanded: !props.closed }}
      onPress={props.onPress}
      {...hoverProps}
      style={{ height: taskControlHeight(m.heading, scale), paddingHorizontal: 6, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 4 }}
    >
      <Text style={{ fontSize: font, fontWeight: "500", color }}>{props.title}</Text>
      <View style={{ transform: [{ rotate: props.closed ? "-90deg" : "0deg" }] }}>
        <Icon name="ChevronDown" size={14} color={color} />
      </View>
      <View style={{ flex: 1 }} />
      {props.summary ? (
        <Text numberOfLines={1} style={[{ flexShrink: 1, fontSize: font, color, fontVariant: ["tabular-nums"] }, props.summaryStyle]}>
          {props.summary}
        </Text>
      ) : null}
      {props.trailing ? <View style={{ marginLeft: 2 }}>{props.trailing}</View> : null}
    </Pressable>
  );
}

/**
 * The properties (`docs/prototypes/task-details-properties.md`): one row per
 * field, icon 16 · value · trailing 16, no label column until the card is
 * wide (≥ 448, gone under 440). Every state the old badges carried is a
 * muted note line under the value; values wrap to a few lines instead of
 * cutting off.
 */
function Properties(props: Inner) {
  const { card, m, tokens } = props;
  const words = props.strings.property;
  const cardText = cardStrings(props.language);
  const details = cardText.details;
  const location = card.location;
  const [wide, setWide] = useState(false);
  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setWide((was) => (width >= LABEL_COLUMN.show ? true : width < LABEL_COLUMN.hide ? false : was));
  };
  const common = { m, tokens, language: props.language, wide };
  const rows: React.ReactNode[] = [];

  const placeName = location.projectName ?? location.workspaceName;
  if (placeName) {
    const kind = location.workspaceKind;
    const notes: Note[] = [];
    if (location.projectName && location.workspaceName) notes.push({ text: location.workspaceName });
    if (kind) notes.push({ text: cardText.kind[kind] });
    rows.push(<PropertyRow {...common} key="place" label={words.project} lead={<ProjectIcon location={location} size={16} />} value={placeName} strong hyphens lines={2} notes={notes} testID="detail-place" />);
  }

  if (location.branch) {
    const hint = branchHint(location.git);
    const notes: Note[] = [];
    if (hint.sync) {
      const { ahead, behind } = hint.sync;
      notes.push({
        text: `↑${ahead} ↓${behind}`,
        parts: [
          { text: `↑${ahead}`, color: ahead > 0 ? tokens.success : undefined },
          { text: ` ↓${behind}`, color: behind > 0 ? tokens.warning : undefined },
        ],
      });
    }
    if (hint.dirty) notes.push({ text: details.uncommittedNote, warn: true });
    rows.push(
      <PropertyRow
        {...common}
        key="branch"
        label={words.branch}
        icon="GitBranch"
        value={location.branch}
        mono="branch"
        lines={3}
        notes={notes}
        copy={{ text: location.branch, toast: "Copy branch name", label: details.copyBranch }}
        testID="detail-branch"
      />,
    );
  } else if (location.git === null) {
    rows.push(<PropertyRow {...common} key="branch" label={words.branch} icon="GitBranch" value={details.notGit} muted lines={1} testID="detail-branch" />);
  }

  rows.push(
    <PropertyRow
      {...common}
      key="cwd"
      label={words.cwd}
      icon="Folder"
      value={tildePath(location.cwd)}
      mono="path"
      lines={2}
      copy={{ text: location.cwd, toast: "Copy path", label: details.copyPath }}
      testID="detail-cwd"
    />,
  );

  if (location.pullRequest) {
    const pr = location.pullRequest;
    rows.push(
      <PropertyRow
        {...common}
        key="pr"
        label={words.pr}
        icon="GitPullRequest"
        pre={pr.number !== null ? `#${pr.number}` : null}
        value={pr.title}
        lines={2}
        link={pr.url}
        copy={{ text: pr.url, toast: "Copy URL", label: details.copyLink }}
        testID="detail-pr"
      />,
    );
  }

  if (card.parent) {
    const parent = card.parent;
    const archived = parent.missing && parent.archived === true;
    // Off the board but not archived: an old done task the window left out. Its tab still opens.
    const offBoard = parent.missing && parent.archived === false;
    const title = parent.title ?? (archived ? cardText.parentArchived : cardText.parentUnknown);
    let jump: (() => void) | undefined;
    if (!parent.missing) jump = props.onJump ? () => props.onJump?.(parent.id) : undefined;
    else if (offBoard) jump = props.onOpen ? () => props.onOpen?.(parent.id) : undefined;
    const unarchive = archived ? props.unarchive : null;
    const unarchiving = unarchive?.pending(parent.id) === true;
    let notes: Note[] = [];
    // An archived parent can be brought back; once it is, the row turns into a jump.
    if (archived) notes = unarchive ? [{ text: details.archived }] : [{ text: details.archived }, { text: details.cannotJump }];
    else if (offBoard) notes = [{ text: details.offBoard }];
    rows.push(
      <PropertyRow
        {...common}
        key="parent"
        label={words.parent}
        icon="CornerLeftUp"
        value={title}
        lines={3}
        muted={parent.missing}
        notes={notes}
        button={
          unarchive ? (
            <CardButton
              look="primary"
              icon="ArchiveRestore"
              label={details.unarchive}
              busy={unarchiving}
              tokens={tokens}
              compact={false}
              onPress={() => unarchive.press(parent.id)}
              testID="detail-parent-unarchive"
            />
          ) : undefined
        }
        onPress={jump}
        accessibilityLabel={`${words.parent}: ${title}`}
        testID="detail-parent"
      />,
    );
  }
  return (
    <View onLayout={onLayout} testID="detail-properties">
      {rows}
    </View>
  );
}

/** A part of a property's note line: workspace, kind, ahead/behind, uncommitted, archived. */
interface Note {
  text: string;
  /** Uncommitted changes: the warning colour after a dot. */
  warn?: boolean;
  /** Runs of the text in their own colour: ahead in green, behind in orange, a zero left muted. */
  parts?: { text: string; color?: string }[];
}

/**
 * One property: [label 72 when wide] · icon 16 · the value over its note
 * line · trailing 16. The value wraps to `lines` lines; a branch breaks after
 * "/" and "-", a path after "/" and folds its middle into "…/" past two
 * lines. With a pointer, hovering an actionable row shows its buttons at the
 * top right; on touch its trailing mark (copy, ↗, ›) always shows and a tap
 * on the row runs it. A copy is confirmed by the host's toast.
 */
function PropertyRow(props: {
  m: Metrics;
  tokens: TaskTokens;
  language: TasksLanguage;
  wide: boolean;
  label: string;
  icon?: string;
  lead?: React.ReactNode;
  pre?: string | null;
  value: string;
  strong?: boolean;
  muted?: boolean;
  mono?: "branch" | "path";
  /** A name ("ideashell-android") that may break after its hyphens, as a branch does. */
  hyphens?: boolean;
  lines: number;
  notes?: Note[];
  /** A button at the row's end, in the card's style: an archived parent's Unarchive. */
  button?: React.ReactNode;
  copy?: { text: string; toast: string; label: string };
  link?: string;
  onPress?(): void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { m, tokens } = props;
  const words = cardStrings(props.language).details;
  const scale = useTasksFontScale();
  const colors = detailColors(tokens);
  const { hovered, hoverProps } = useHover();
  const { copy } = useCopy();
  const [columns, setColumns] = useState(36);
  const touch = m === TOUCH_CARD;
  // The host's steps: base for the value (as the usage rows and subtasks), small for code and the note.
  const font = F.sm;
  const line = HOST_LINE.smRead;
  const monoFont = F.sm;
  const noteFont = F.sm;
  const rowHeight = taskControlHeight(touch ? 36 : 30, scale);
  // The host's toast confirms a copy; the row itself does not change.
  const doCopy = props.copy ? () => void copy(props.copy!.text, { label: props.copy!.toast, feedback: "toast" }) : undefined;
  const doOpen = props.link ? () => openLink(props.link!) : undefined;
  // The row's own action: open a PR, jump to the parent, else copy.
  const press = props.onPress ?? doOpen ?? doCopy;
  // With a pointer, the copy / open buttons take a slot of their own at the row's end, kept while
  // they are hidden, so they never cover the value's last word and the value does not reflow on hover.
  const actionSlot = touch ? 0 : (props.copy ? 24 : 0) + (props.link ? 26 : 0);
  const showActions = actionSlot > 0 && hovered;
  let shown = props.value;
  if (props.mono === "branch" || props.hyphens) shown = breakable(props.value);
  // A path wraps as runs in a row, so its breaks are the layout's on every platform.
  const runs = props.mono === "path" ? pathTokens(foldPath(props.value, columns, props.lines), columns) : null;
  const onValueLayout =
    props.mono === "path"
      ? (event: LayoutChangeEvent) => {
          // A monospace glyph measures 0.62 em (ui-monospace, Menlo); one column spare absorbs the rest.
          const next = Math.max(12, Math.floor(event.nativeEvent.layout.width / (monoFont * scale * 0.62)) - 1);
          setColumns((was) => (was === next ? was : next));
        }
      : undefined;
  let color = tokens.foreground;
  if (props.muted) color = tokens.foregroundMuted;
  const valueStyle: TextStyle = {
    fontSize: props.mono ? monoFont : font,
    lineHeight: line,
    color,
    fontWeight: props.strong ? "500" : "400",
    ...(props.mono ? { fontFamily: MONO } : null),
  };
  let trailing: React.ReactNode = null;
  if (props.onPress) trailing = <Icon name="ChevronRight" size={14} color={tokens.foregroundMuted} />;
  else if (touch && props.link) trailing = <Icon name="ArrowUpRight" size={16} color={tokens.foregroundMuted} />;
  else if (touch && props.copy) trailing = <Icon name="Copy" size={14} color={tokens.foregroundMuted} />;
  const notes = props.notes ?? [];
  // One run of text, so a long workspace name wraps and the next part follows it on the same line.
  const noteText: TextStyle = { fontSize: noteFont, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted, marginTop: 1 };
  const noteLine =
    notes.length > 0 ? (
      <Text style={noteText} testID={props.testID ? `${props.testID}-note` : undefined}>
        {notes.map((note, index) => (
          <Text key={note.text} style={note.warn ? { color: tokens.warning } : note.parts ? { fontVariant: ["tabular-nums"] } : undefined}>
            {index > 0 ? <Text style={{ color: tokens.foregroundMuted }}>{" \u00b7 "}</Text> : null}
            {note.warn ? "\u25cf " : null}
            {note.parts ? note.parts.map((part) => (part.color ? <Text key={part.text} style={{ color: part.color }}>{part.text}</Text> : part.text)) : note.text}
          </Text>
        ))}
      </Text>
    ) : null;
  const content = (
    <>
      {props.wide ? (
        <Text numberOfLines={1} style={{ width: 72, fontSize: F.sm, lineHeight: line, color: tokens.foregroundMuted }}>
          {props.label}
        </Text>
      ) : null}
      <View style={{ width: 16, height: line, alignItems: "center", justifyContent: "center" }}>
        {props.lead ?? (props.icon ? <Icon name={props.icon} size={16} color={tokens.foregroundMuted} /> : null)}
      </View>
      <View style={{ flex: 1, minWidth: 0 }} onLayout={onValueLayout}>
        {runs ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap" }} testID={props.testID ? `${props.testID}-value` : undefined}>
            {runs.map((token, index) => (
              <Text key={index} style={valueStyle}>
                {token}
              </Text>
            ))}
          </View>
        ) : (
          <Text numberOfLines={props.lines} style={valueStyle} testID={props.testID ? `${props.testID}-value` : undefined}>
            {props.pre ? <Text style={{ fontSize: font, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{`${props.pre}\u2002`}</Text> : null}
            {shown}
          </Text>
        )}
        {noteLine}
      </View>
      {trailing ? <View style={{ width: 16, height: line, alignItems: "center", justifyContent: "center" }}>{trailing}</View> : null}
      {props.button ? <View style={{ alignSelf: "center" }}>{props.button}</View> : null}
      {actionSlot > 0 ? (
        <View style={{ width: actionSlot, height: line, marginRight: -4, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
          {showActions && props.copy ? <RowAction icon="Copy" label={props.copy.label} tokens={tokens} onPress={doCopy!} /> : null}
          {showActions && props.link ? <RowAction icon="ExternalLink" label={words.openLink} tokens={tokens} onPress={doOpen!} /> : null}
        </View>
      ) : null}
    </>
  );
  const style: ViewStyle = {
    minHeight: rowHeight,
    paddingHorizontal: 8,
    paddingVertical: Math.max(4, Math.floor((rowHeight - line) / 2)),
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  };
  if (!press) {
    return (
      <View testID={props.testID} accessibilityLabel={props.accessibilityLabel ?? `${props.label}: ${props.value}`} style={style}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      {...(props.copy || props.link ? ROW_ROLE : { accessibilityRole: "button" as const })}
      accessibilityLabel={props.accessibilityLabel ?? (props.copy ? `${props.copy.label}: ${props.copy.text}` : props.label)}
      onPress={press}
      onLongPress={touch && props.link ? doCopy : undefined}
      delayLongPress={450}
      {...hoverProps}
      testID={props.testID}
      style={({ pressed }) => ({ ...style, backgroundColor: hovered || pressed ? colors.rowHover : "transparent" })}
    >
      {content}
    </Pressable>
  );
}

function RowAction(props: { icon: string; label: string; tokens: TaskTokens; onPress(): void }) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      {...hoverProps}
      style={{ width: 24, height: 24, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? detailColors(props.tokens).track : "transparent" }}
    >
      <Icon name={props.icon} size={14} color={hovered ? props.tokens.foreground : props.tokens.foregroundMuted} />
    </Pressable>
  );
}

/**
 * The children (`docs/prototypes/task-subtasks.md`), most urgent first: each
 * row's status icon on its title's first line, the time at the line's end,
 * a muted meta line under it. A model the rows share is left out and, when
 * it is not the parent's, named once under them. The first ten show; the
 * rest open on demand, closed again on the next card.
 */
function Subtasks(props: Inner & { narrow: boolean }) {
  const { card, m, tokens } = props;
  const scale = useTasksFontScale();
  const cardText = cardStrings(props.language);
  const words = cardText.details;
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === card.id;
  const sorted = sortSubtasks(card.children);
  const hidden = sorted.slice(SUBTASK_ROWS);
  const shown = open ? sorted : sorted.slice(0, SUBTASK_ROWS);
  const { baseline, footnote } = subtaskModels(card, props.language);
  // Finished rows step back while others still need a look; all finished, none does.
  const mixed = card.children.some((child) => !subtaskFinished(child));
  const time = props.time;
  const touch = m === TOUCH_CARD;
  return (
    <View>
      {shown.map((child) => (
        <SubtaskRow
          key={child.id}
          m={m}
          tokens={tokens}
          theme={props.theme}
          language={props.language}
          child={child}
          meta={subtaskMeta(child, baseline, props.now, props.language, props.narrow)}
          muted={mixed && child.status === "done"}
          time={time}
          word={cardText.status[child.status]}
          openLabel={props.strings.openTab}
          onPress={subtaskPress(props, child)}
          onOpen={props.onOpen && child.kind !== "provider" ? () => props.onOpen?.(child.id) : undefined}
        />
      ))}
      {hidden.length > 0 ? (
        <MoreRow
          tokens={tokens}
          label={open ? cardText.showFewer : words.subtasksShowAll(sorted.length)}
          note={open ? null : hidden.every(subtaskFinished) ? words.subtasksHiddenDone(hidden.length) : words.subtasksHidden(hidden.length)}
          open={open}
          onPress={() => setOpenFor(open ? null : card.id)}
          height={taskControlHeight(touch ? 44 : 32, scale)}
        />
      ) : null}
      {footnote ? (
        <View style={{ marginHorizontal: -2, paddingTop: 6, paddingLeft: 34, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 4 }} testID="detail-subtasks-footnote">
          {footnote.provider ? <BrandMark provider={footnote.provider} size={14} tokens={tokens} mono={tokens.foregroundMuted} /> : null}
          <Text style={{ flexShrink: 1, fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }}>{footnote.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** A Paseo child jumps to its card; a provider subagent has none, so it opens the parent's tab. */
function subtaskPress(props: Inner, child: TaskChild): (() => void) | undefined {
  if (child.kind === "provider") return props.onOpen ? () => props.onOpen?.(props.card.id) : undefined;
  return props.onJump ? () => props.onJump?.(child.id) : undefined;
}

/** "Show all 14" and what the hidden rows are, or "Show fewer"; the chevron in the rows' status column. */
function MoreRow(props: { tokens: TaskTokens; label: string; note: string | null; open: boolean; height: number; onPress(): void }) {
  const { tokens } = props;
  const { hovered, hoverProps } = useHover();
  const colors = detailColors(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.note ? `${props.label} ${props.note}` : props.label}
      accessibilityState={{ expanded: props.open }}
      onPress={props.onPress}
      {...hoverProps}
      testID="detail-subtasks-more"
      style={({ pressed }) => ({
        minHeight: props.height,
        marginHorizontal: -2,
        paddingHorizontal: 8,
        borderRadius: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: pressed ? colors.rowPress : hovered ? colors.rowHover : "transparent",
      })}
    >
      <View style={{ width: 16, alignItems: "center" }}>
        <Icon name={props.open ? "ChevronUp" : "ChevronDown"} size={14} color={tokens.foregroundMuted} />
      </View>
      <View style={{ flexShrink: 1, flexDirection: "row", flexWrap: "wrap", columnGap: 6 }}>
        <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, fontWeight: "500", color: tokens.foregroundMuted }}>{props.label}</Text>
        {props.note ? <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }}>{props.note}</Text> : null}
      </View>
    </Pressable>
  );
}

/** A row's sizes: the details body's small step, the title on the reading line; touch only adds padding and a 44 floor. */
const SUBTASK_TEXT = {
  desktop: { title: F.sm, titleLine: HOST_LINE.smRead, meta: F.sm, metaLine: HOST_LINE.sm, padV: 7, minHeight: 0 },
  touch: { title: F.sm, titleLine: HOST_LINE.smRead, meta: F.sm, metaLine: HOST_LINE.sm, padV: 10, minHeight: 44 },
} as const;

/**
 * One child: its agent's mark, its status on the corner, centred on the
 * title's first line; the title, its leading tag or Linear id muted, over
 * the meta line, which
 * wraps between its parts, never inside one; the time at the first line's
 * end. A press shows the child here. With a pointer, hovering shows ↗,
 * which opens its tab; on touch a long press does.
 */
function SubtaskRow(props: {
  m: Metrics;
  tokens: TaskTokens;
  theme: PluginTheme;
  language: TasksLanguage;
  child: TaskChild;
  meta: SubtaskMetaPart[];
  muted: boolean;
  time: TimeSource;
  word: string;
  openLabel: string;
  onPress?(): void;
  onOpen?(): void;
}) {
  const { m, tokens, child } = props;
  const scale = useTasksFontScale();
  const touch = m === TOUCH_CARD;
  const size = touch ? SUBTASK_TEXT.touch : SUBTASK_TEXT.desktop;
  // DOM hover on web, as the board card's subtask row: the row's own Pressable
  // hover would end when the pointer reaches ↗, and hide it.
  const rowRef = useRef<View>(null);
  const { hovered, hoverProps } = useHover(rowRef);
  const colors = detailColors(tokens);
  const active = !!props.onPress && hovered && !touch;
  const showOpen = !touch && hovered && !!props.onOpen;
  const { prefix, rest } = titlePrefix(child.title);
  const line = Math.round(size.titleLine * scale);
  const metaText: TextStyle = { fontSize: size.meta, lineHeight: size.metaLine, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] };
  const toneColor = (part: SubtaskMetaPart) => (part.tone === "danger" ? tokens.danger : part.tone === "warning" ? tokens.warning : tokens.foregroundMuted);
  return (
    <Pressable
      {...(!touch && props.onOpen ? ROW_ROLE : { accessibilityRole: "button" as const })}
      accessibilityLabel={`${child.title} ${props.word}`}
      disabled={!props.onPress && !props.onOpen}
      onPress={props.onPress}
      onLongPress={touch ? props.onOpen : undefined}
      delayLongPress={450}
      ref={rowRef}
      {...(Platform.OS === "web" ? null : hoverProps)}
      testID={`detail-subtask-${child.id}`}
      style={({ pressed }) => ({
        minHeight: size.minHeight ? taskControlHeight(size.minHeight, scale) : undefined,
        marginHorizontal: -2,
        paddingHorizontal: 8,
        paddingVertical: size.padV,
        borderRadius: 8,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        backgroundColor: props.onPress && pressed ? colors.rowPress : active ? colors.rowHover : "transparent",
      })}
    >
      <View style={{ width: 16, height: line, alignItems: "center", justifyContent: "center" }} testID={`detail-subtask-status-${child.id}`}>
        <ChildMark child={child} tokens={tokens} theme={props.theme} backdrop={active ? colors.rowHover : tokens.card.background} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <Text numberOfLines={2} style={{ flex: 1, fontSize: size.title, lineHeight: size.titleLine, color: props.muted ? tokens.foregroundMuted : tokens.foreground }}>
            {prefix ? <Text style={{ color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{`${prefix} `}</Text> : null}
            {rest}
          </Text>
          <View style={{ height: line, flexDirection: "row", alignItems: "center", gap: 6, marginRight: showOpen ? -3 : 0 }}>
            <SubtaskTime child={child} language={props.language} source={props.time} tokens={tokens} lineHeight={size.titleLine} />
            {showOpen ? <OpenChild tokens={tokens} label={props.openLabel} onPress={props.onOpen!} /> : null}
          </View>
        </View>
        {props.meta.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 4 }} testID={`detail-subtask-meta-${child.id}`}>
            {props.meta.map((part, index) => (
              <Text key={index} numberOfLines={1} style={metaText}>
                <Text style={part.tone ? { color: toneColor(part) } : undefined}>{part.text}</Text>
                {index < props.meta.length - 1 ? " ·" : null}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A row's time: a running child's timer in the foreground colour, each second; else when it ended, muted. */
function SubtaskTime(props: { child: TaskChild; language: TasksLanguage; source: TimeSource; tokens: TaskTokens; lineHeight: number }) {
  const { child, language } = props;
  const value = useTime(props.source, (now) => subtaskTime(child, now, language)?.text ?? "");
  if (!value) return null;
  const live = child.status === "running";
  return (
    <Text numberOfLines={1} style={{ fontSize: F.sm, lineHeight: props.lineHeight, color: live ? props.tokens.foreground : props.tokens.foregroundMuted, fontVariant: ["tabular-nums"] }} testID={`detail-subtask-time-${child.id}`}>
      {value}
    </Text>
  );
}

/** ↗ after a hovered row's time: opens the child's tab. */
function OpenChild(props: { tokens: TaskTokens; label: string; onPress(): void }) {
  const { tokens } = props;
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      {...hoverProps}
      testID="detail-subtask-open"
      style={{ width: 20, height: 20, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? detailColors(tokens).track : "transparent" }}
    >
      <Icon name="ArrowUpRight" size={14} color={tokens.foreground} />
    </Pressable>
  );
}

/** The lines a prompt or reply shows before "show all". */
const PROMPT_LINES = 4;
/** A prompt or reply is Markdown, set in the chat's tightest variant to fit the card. */
const PROSE = "compact";
const FADE_STEPS = 6;

/**
 * Text read from the task's timeline: the first prompt in full (the title
 * being only its first line), or the agent's latest reply. Four lines, then
 * "show all"; drawn as Markdown, copyable as written. A closed agent waits for
 * "Load", since reading its timeline resumes it.
 */
function TimelineTextBody(props: Inner & { read: { prompt: FirstPrompt; load(): void } | null | undefined; id: string; none: string; error: string; copyLabel: string; copyToast: string }) {
  const { tokens, id } = props;
  const words = cardStrings(props.language).details;
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy();
  const prose = useThemeTokens(props.theme, useEnhancerPreferences());
  const first = props.read;
  if (!first) return null;
  const font = props.touch ? 15 : 13;
  const small = props.touch ? 14 : 12;
  const prompt = first.prompt;
  if (prompt.state !== "ready") {
    const retry = prompt.state === "idle" || prompt.state === "error";
    const note = prompt.state === "loading" ? words.promptLoading : prompt.state === "none" ? props.none : prompt.state === "error" ? props.error : null;
    return (
      <View style={{ minHeight: props.touch ? 36 : 28, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 8 }} testID={`${id}-state`}>
        {note ? <Text style={{ flexShrink: 1, fontSize: small, color: tokens.foregroundMuted }}>{note}</Text> : null}
        {retry ? (
          <Pressable accessibilityRole="button" onPress={first.load} hitSlop={6} testID={`${id}-load`}>
            <Text style={{ fontSize: small, fontWeight: "500", color: tokens.accentText }}>{words.promptLoad}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  const text = prompt.text;
  const lines = errorLines(text);
  const long = lines.length > PROMPT_LINES || text.length > 240;
  const folded = long && !open;
  const line = variantMetrics(PROSE, font).bodyLineHeight;
  const sunk = detailColors(tokens).sunk;
  return (
    <View style={{ paddingHorizontal: 6, paddingTop: 2 }}>
      <View style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: sunk }}>
        <View style={folded ? { maxHeight: PROMPT_LINES * line, overflow: "hidden" } : null} testID={`${id}-text`}>
          <MarkdownView text={text} tokens={prose} variant={PROSE} size={font} />
          {folded ? (
            // A heading or code block cuts the last line anywhere: fade it out.
            <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: line, flexDirection: "column" }}>
              {Array.from({ length: FADE_STEPS }, (_, step) => (
                <View key={step} style={{ flex: 1, backgroundColor: withAlpha(sunk, (step + 1) / FADE_STEPS) }} />
              ))}
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ minHeight: props.touch ? 36 : 28, flexDirection: "row", alignItems: "center", gap: 8 }}>
        {long ? (
          <Pressable accessibilityRole="button" onPress={() => setOpen((was) => !was)} hitSlop={4} testID={`${id}-more`}>
            <Text style={{ fontSize: small, color: tokens.foregroundMuted }}>{open ? words.showLess : words.showAll(lines.length)}</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.copyLabel}
          onPress={() => void copy(text, { label: props.copyToast })}
          hitSlop={6}
          testID={`${id}-copy`}
          style={{ width: 24, height: 24, marginRight: -4, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
        >
          <Icon name={copied ? "Check" : "Copy"} size={14} color={copied ? tokens.success : tokens.foregroundMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function Usage(props: Inner) {
  const { card, m, tokens } = props;
  const words = cardStrings(props.language).details;
  const touch = props.touch === true;
  const font = F.sm;
  const cost = card.usage?.totalCostUsd ?? null;
  const line = (key: string, icon: string, label: string, value: string, strong: boolean) => (
    <View key={key} testID={`detail-usage-${key}`} style={{ height: touch ? 32 : 24, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name={icon} size={14} color={tokens.foregroundMuted} />
      <Text style={{ fontSize: font, color: tokens.foregroundMuted }}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Text style={{ fontSize: font, fontWeight: strong ? "600" : "400", color: value === "—" ? tokens.foregroundMuted : tokens.foreground, fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
  return (
    <View style={{ paddingHorizontal: 6, paddingTop: 4, paddingBottom: 4, gap: 14 }}>
      {detailHero(card) !== "turn" ? <ContextBar context={contextView(card)} tokens={tokens} touch={touch} language={props.language} font={font} /> : null}
      <TokenBar mix={tokenMix(card)} tokens={tokens} touch={touch} language={props.language} font={font} />
      <View>
        {line("cost", "Coins", words.totalCost, cost !== null ? `$${cost.toFixed(2)}` : "—", true)}
        {line("turn", "Hourglass", words.lastTurnTime, card.timing.lastTurnMs !== null ? formatDuration(card.timing.lastTurnMs) : "—", false)}
      </View>
    </View>
  );
}

function Activity(props: Inner) {
  const line = timeline(props.card, props.now, props.language);
  if (!line) return null;
  const kind = props.card.stoppedManually ? "stopped" : props.card.status;
  return (
    <TimelineChart
      timeline={line}
      liveColor={statusColor(props.card.status, props.tokens)}
      tokens={props.tokens}
      endMark={<StatusIcon kind={kind} size={14} theme={props.theme} />}
    />
  );
}

// ---- Buttons ---------------------------------------------------------------

function KeyCap(props: { label: string; tokens: TaskTokens }) {
  return (
    <View style={{ height: 16, paddingHorizontal: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: props.tokens.border, borderRadius: 3, justifyContent: "center" }}>
      <Text style={{ fontSize: F.sm, color: props.tokens.foregroundMuted }}>{props.label}</Text>
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

function OpenHint(props: { tokens: TaskTokens; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: props.tokens.success }} />
      <Text style={{ fontSize: F.sm, color: props.tokens.foregroundMuted }}>{props.label}</Text>
    </View>
  );
}

function OutlineButton(props: {
  icon: string;
  label: string;
  /** The card button's colours (`buttonHue`); plain by default, its icon then muted. */
  look?: CardButtonLook;
  hint?: React.ReactNode;
  trailing?: string;
  height: number;
  font: number;
  tokens: TaskTokens;
  grow?: boolean;
  /** Working: the same label, dimmed, a spinner in place of the icon, and no second press. */
  busy?: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { tokens } = props;
  const scale = useTasksFontScale();
  const { hovered: hover, hoverProps } = useHover();
  const hovered = hover && !props.busy;
  const look = props.look ?? "plain";
  const hue = buttonHue(tokens, look);
  const iconColor = look === "plain" ? tokens.foregroundMuted : hue.color;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={props.busy ? { disabled: true, busy: true } : undefined}
      disabled={props.busy}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={{
        flexGrow: props.grow ? 1 : 0,
        flexShrink: 1,
        minWidth: 0,
        height: taskControlHeight(props.height, scale),
        paddingHorizontal: props.grow ? 10 : 12,
        borderRadius: 8,
        ...buttonOutline(hue.border),
        backgroundColor: hovered ? hue.hover : tokens.card.background,
        flexDirection: "row",
        alignItems: "center",
        gap: props.grow ? 8 : 6,
        opacity: props.busy ? 0.6 : 1,
      }}
    >
      {props.busy ? (
        // The running ring without its dot, in the icon's box so the button keeps its width.
        <SpinnerRing size={15} color={iconColor} testID={props.testID ? `${props.testID}-spinner` : undefined} />
      ) : (
        <Icon name={props.icon} size={15} color={iconColor} />
      )}
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: props.font, fontWeight: "500", color: hue.color }}>
        {props.label}
      </Text>
      {props.hint}
      {props.trailing ? (
        <>
          <View style={{ flex: 1 }} />
          <Icon name={props.trailing} size={14} color={tokens.foregroundMuted} />
        </>
      ) : null}
    </Pressable>
  );
}

// ---- The phone's action bar ------------------------------------------------

/**
 * Under the phone's sheet: the card's actions at thumb height (48, radius 12).
 * Running: stop, then open the tab at the right. Asking: deny, allow as the
 * main button, and the tab shrunk to a square at the right. Otherwise: open the tab.
 */
export function DetailActionBar(props: {
  card: TaskCard;
  theme: PluginTheme;
  language: TasksLanguage;
  strings: DetailCardsStrings;
  onOpen?(agentId: string): void;
  stop?: { phase: StopPhase; onPress(): void } | null;
  permissionButtons?: PermissionButton[];
  onPermission?(button: PermissionButton): void;
  unarchive?: { pending(agentId: string): boolean; press(agentId: string): void } | null;
  archive?: { pending(agentId: string): boolean; press(agentId: string): void } | null;
}) {
  const { card } = props;
  const onOpen = opensInPaseo(card) ? props.onOpen : undefined;
  // An archived task's main button is Unarchive, in Open tab's place.
  const unarchive = card.archived === "agent" ? props.unarchive ?? null : null;
  const archive = archivable(card) ? props.archive ?? null : null;
  const tokens = taskTokens(props.theme);
  const stop = stopLabel(props as TaskDetailCardsProps);
  const buttons = card.lane === "needs_input" && props.onPermission ? (props.permissionButtons ?? []) : [];
  const respond = buttons.filter((button) => button.kind === "respond");
  const answer = buttons.find((button) => button.kind === "open");
  const asking = respond.length > 0 || !!answer;
  if (!onOpen && !stop && !asking && !unarchive && !archive) return null;
  const open = () => onOpen?.(card.id);
  // Deny first, allow last: the main button sits under the thumb.
  const ordered = [...respond].sort((a, b) => (a.action.behavior === "allow" ? 1 : 0) - (b.action.behavior === "allow" ? 1 : 0));
  return (
    <View testID="detail-action-bar" style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.border }}>
      {asking ? (
        <>
          {ordered.map((button) => (
            <BarButton
              key={button.key}
              tokens={tokens}
              label={button.label}
              look={requestLook(button)}
              onPress={() => props.onPermission?.(button)}
            />
          ))}
          {answer ? <BarButton tokens={tokens} label={answer.label} look="answer" onPress={() => props.onPermission?.(answer)} /> : null}
          {onOpen ? <BarButton tokens={tokens} icon="AppWindow" label={openLabel(props as TaskDetailCardsProps)} square onPress={open} testID="detail-bar-open" /> : null}
        </>
      ) : (
        <>
          {stop && props.stop ? (
            <BarButton
              tokens={tokens}
              icon={props.stop.phase === "confirming" ? CONFIRM_STOP_ICON : "Power"}
              look="danger"
              label={stop}
              busy={props.stop.phase === "stopping"}
              grow={false}
              onPress={props.stop.onPress}
              testID="detail-bar-stop"
            />
          ) : null}
          {archive ? (
            <BarButton
              tokens={tokens}
              icon="Archive"
              look="archive"
              label={cardStrings(props.language).details.archive}
              busy={archive.pending(card.id)}
              grow={!onOpen}
              onPress={() => archive.press(card.id)}
              testID="detail-bar-archive"
            />
          ) : null}
          {onOpen ? <BarButton tokens={tokens} icon="AppWindow" label={openLabel(props as TaskDetailCardsProps)} look="primary" onPress={open} testID="detail-bar-open" /> : null}
          {unarchive ? (
            <BarButton
              tokens={tokens}
              icon="ArchiveRestore"
              label={cardStrings(props.language).details.unarchive}
              busy={unarchive.pending(card.id)}
              look="primary"
              onPress={() => unarchive.press(card.id)}
              testID="detail-bar-unarchive"
            />
          ) : null}
        </>
      )}
    </View>
  );
}

/** A done task, not archived: Archive is offered for it. */
function archivable(card: TaskCard): boolean {
  return card.lane === "done" && !card.archived;
}

/** The phone bar's button: the card button's outline (`buttonHue`) at thumb size, tinted while pressed. */
function BarButton(props: { tokens: TaskTokens; icon?: string; look?: CardButtonLook; label: string; square?: boolean; grow?: boolean; busy?: boolean; onPress(): void; testID?: string }) {
  const { tokens } = props;
  const scale = useTasksFontScale();
  const height = taskControlHeight(48, scale);
  const look = props.look ?? "plain";
  const hue = buttonHue(tokens, look);
  const text = hue.color;
  const iconColor = look === "plain" ? tokens.foregroundMuted : text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={props.busy ? { disabled: true, busy: true } : undefined}
      disabled={props.busy}
      onPress={props.onPress}
      testID={props.testID}
      style={({ pressed }) => ({
        height,
        width: props.square ? height : undefined,
        flexGrow: props.square || props.grow === false ? 0 : 1,
        flexShrink: props.square ? 0 : 1,
        paddingHorizontal: props.square ? 0 : 16,
        borderRadius: 12,
        ...buttonOutline(hue.border),
        backgroundColor: pressed && !props.busy ? hue.hover : tokens.card.background,
        opacity: props.busy ? 0.6 : 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      })}
    >
      {props.busy ? (
        // The running ring without its dot, in the icon's box so the button keeps its width.
        <SpinnerRing size={18} color={iconColor} testID={props.testID ? `${props.testID}-spinner` : undefined} />
      ) : props.icon ? (
        <Icon name={props.icon} size={18} color={iconColor} />
      ) : null}
      {props.square ? null : (
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: F.base, fontWeight: "600", color: text }}>
          {props.label}
        </Text>
      )}
    </Pressable>
  );
}
