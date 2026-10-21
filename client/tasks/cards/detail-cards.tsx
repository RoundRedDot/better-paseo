import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { openLink } from "../../components/open-link";
import { TaskText as Text, useTasksFontScale, taskControlHeight } from "../typography";
import { useHover } from "../../ui/use-hover";
import { useCopy } from "../../ui/use-copy";
import type { TasksLanguage } from "../i18n";
import type { PermissionKind, TaskCard } from "../model";
import type { PermissionButton, StopPhase } from "../actions";
import { formatDuration, formatRelative, since, tildePath } from "./format";
import { cardStrings } from "./strings";
import { taskTokens, type TaskTokens } from "./tokens";
import { modeIcon, THINKING_ICON } from "./mode-icons";
import { BrandMark } from "./brand-mark";
import { useTime, type TimeSource } from "./clock";
import { ProjectIcon } from "./project-icon";
import { StatusIcon } from "./status-icon";
import { cardTimer } from "./task-card";
import { branchHint, shortenPath, SUBTASK_ROWS } from "./details-format";
import {
  contextView,
  detailHero,
  detailSections,
  errorLines,
  formatSpan,
  formatTurnClock,
  subtaskSegments,
  summaryTiles,
  timeline,
  tokenMix,
  usageSummary,
  type DetailSection,
} from "./detail-model";
import { Badge, Chip, ContextBar, SubtaskBar, SummaryTiles, TimelineChart, TokenBar, TurnHero, detailColors, statusColor } from "./detail-charts";
import { sectionClosed, setSectionClosed, useSectionChoices } from "./detail-collapse";

/**
 * The details as one raised card, after Linear's issue panel
 * (`docs/prototypes/task-details-rich.md`): the header (status, title, the
 * agent's chips and labels, the actions), then the block the card needs
 * first (the running turn, the permission request, the error, or a summary),
 * then collapsible sections: properties, subtasks, usage and activity, in an
 * order that follows the state. The desktop sidebar draws it at desktop
 * sizes; the phone's sheet and a tablet's touch sidebar at touch sizes.
 */
export const DETAIL_CARD = {
  radius: 12,
  gap: 8,
  padH: 12,
  padV: 6,
  labelWidth: 64,
  row: 32,
  listRow: 30,
  heading: 32,
  font: 13,
  title: 15,
  icon: 16,
  chip: 22,
  button: 32,
  round: 28,
} as const;

const TOUCH_CARD = { ...DETAIL_CARD, labelWidth: 76, row: 44, listRow: 44, heading: 44, font: 15, title: 17, icon: 18, chip: 28, button: 44, round: 36 } as const;

type Metrics = typeof DETAIL_CARD | typeof TOUCH_CARD;

/** Properties go two columns once the card's content is this wide (a sidebar of about 480). */
const TWO_COLUMNS = 456;

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, SFMono-Regular, Menlo, monospace" });

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
  /** The sections scroll under the fixed header (the sidebar); else the card grows with them (the sheet). */
  scrollBody?: boolean;
  /** False when the actions live elsewhere (the phone's bar under the sheet). */
  actions?: boolean;
  testID?: string;
}

const MINUTE = 60_000;

/** The details card: the header and the lead block, then the sections. */
export function TaskDetailCards(props: TaskDetailCardsProps) {
  const { card } = props;
  const tokens = taskTokens(props.theme);
  const m: Metrics = props.touch ? TOUCH_CARD : DETAIL_CARD;
  // Minutes are enough for "8 分钟前"; the running timer reads the clock itself.
  const now = useTime(props, (time) => Math.floor(time / MINUTE) * MINUTE);
  const choices = useSectionChoices();
  const { order, closed } = detailSections(card);
  const sections = order.map((section) => (
    <Section
      key={section}
      section={section}
      closed={sectionClosed(choices, section, closed.includes(section))}
      {...props}
      m={m}
      tokens={tokens}
      now={now}
    />
  ));
  return (
    <View testID={props.testID ?? "detail-cards"} style={[detailCardFrame(tokens), props.scrollBody ? { flexShrink: 1, minHeight: 0 } : null]}>
      <DetailHeader {...props} m={m} tokens={tokens} now={now} />
      {props.scrollBody ? (
        <ScrollView key={card.id} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
          {sections}
        </ScrollView>
      ) : (
        <View style={{ paddingBottom: 4 }}>{sections}</View>
      )}
    </View>
  );
}

type Inner = TaskDetailCardsProps & { m: Metrics; tokens: TaskTokens; now: number };

function stopLabel(props: TaskDetailCardsProps): string | null {
  if (!props.stop) return null;
  const cardText = cardStrings(props.language);
  if (props.stop.phase === "confirming") return cardText.confirmStop;
  if (props.stop.phase === "stopping") return cardText.stopping;
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
  const small = touch ? 14 : 12;
  const chipFont = touch ? 14 : 12;
  const iconSize = touch ? 16 : 14;
  const kind = card.stoppedManually ? "stopped" : card.status;
  const hero = detailHero(card);
  const mode = card.modeLabel ? modeIcon(card.provider, card.modeLabel) : null;
  const stop = stopLabel(props);
  const showActions = props.actions !== false && (!!props.onOpen || !!stop);
  return (
    <View style={{ paddingHorizontal: m.padH, paddingTop: 8, paddingBottom: 12 }} testID="detail-header">
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
      <Text style={{ marginTop: 2, fontSize: m.title, lineHeight: Math.round(m.title * 1.45), fontWeight: "600", color: tokens.foreground }} testID="detail-title">
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
              lead={
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    marginLeft: 2,
                    backgroundColor: tag.color ?? "transparent",
                    borderWidth: tag.color ? 0 : 1.5,
                    borderColor: tokens.foregroundMuted,
                  }}
                />
              }
              text={tag.name}
            />
          ))}
        </View>
      ) : null}
      {showActions ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }} testID="detail-actions">
          {props.onOpen ? (
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
          ) : null}
          {stop && props.stop ? (
            <OutlineButton icon="Square" iconColor={tokens.danger} label={stop} height={m.button} font={m.font} tokens={tokens} onPress={props.stop.onPress} testID="detail-stop" />
          ) : null}
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
  const running = card.lane === "running" && card.timing.turnStartedAt !== null;
  const text = useTime(props, (time) => {
    const ran = running ? since(card.timing.turnStartedAt, time) : null;
    if (ran !== null) return cardStrings(props.language).details.turnClock(formatTurnClock(ran));
    return cardTimer(card, props.now, props.language)?.text ?? "";
  });
  if (!text) return null;
  return (
    <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: props.small, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>
      {text}
    </Text>
  );
}

/** The running turn: its clock (ticking each second) and the context ring. */
function RunningTurn(props: Inner) {
  const { card } = props;
  const timer = useTime(props, (time) => {
    const ran = since(card.timing.turnStartedAt, time);
    return ran === null ? cardStrings(props.language).starting : formatTurnClock(ran);
  });
  return (
    <TurnHero
      timer={timer}
      lastTurn={card.timing.lastTurnMs !== null ? formatDuration(card.timing.lastTurnMs) : null}
      context={contextView(card)}
      tokens={props.tokens}
      touch={props.touch === true}
      language={props.language}
    />
  );
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
  const small = props.touch ? 14 : 12;
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
          <Text style={{ fontSize: 12, lineHeight: 18, fontFamily: MONO, color: tokens.foreground }}>{permission.summary}</Text>
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
              <Text style={{ fontSize: 11, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{formatSpan(waited)}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ height: 12 }} />
      )}
    </View>
  );
}

/** Allow is the solid accent; deny and the others are outlined; "Answer" opens the tab, solid. */
function RequestButton(props: { button: PermissionButton; tokens: TaskTokens; height: number; onPress(): void }) {
  const { button, tokens } = props;
  const { hovered, hoverProps } = useHover();
  const solid = button.kind === "open" || (button.variant === "primary" && button.action.behavior === "allow");
  const danger = button.variant === "danger";
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
        borderWidth: 1,
        borderColor: solid ? tokens.accent : tokens.border,
        backgroundColor: solid ? tokens.accent : hovered ? detailColors(tokens).rowHover : tokens.card.background,
        opacity: solid && hovered ? 0.9 : 1,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: solid ? tokens.card.onStrong : danger ? tokens.danger : tokens.foreground }}>
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
          <Text numberOfLines={open ? undefined : 3} style={{ marginTop: 4, fontSize: 12, lineHeight: 18, fontFamily: MONO, color: tokens.foreground }}>
            {body}
          </Text>
          {long ? (
            <Pressable accessibilityRole="button" onPress={() => setOpen((was) => !was)} hitSlop={4} style={{ marginTop: 6, alignSelf: "flex-start" }}>
              <Text style={{ fontSize: props.touch ? 14 : 12, color: tokens.foregroundMuted }}>{open ? words.showLess : words.showAll(lines.length)}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

// ---- Sections --------------------------------------------------------------

function Section(props: Inner & { section: DetailSection; closed: boolean }) {
  const { card, m, tokens, section } = props;
  const words = cardStrings(props.language).details;
  const title = { properties: words.properties, subtasks: words.subtasks, usage: words.usage, activity: words.activity }[section];
  const done = card.children.filter((child) => child.status === "done").length;
  const created = since(card.timing.createdAt, props.now);
  const summary = {
    properties: card.location.branch ?? "",
    subtasks: words.subtasksDone(done, card.children.length),
    usage: usageSummary(card, props.language),
    activity: created !== null ? words.createdAgo(formatRelative(created, props.language)) : "",
  }[section];
  const testID = { properties: "detail-location", subtasks: "detail-subtasks", usage: "detail-usage", activity: "detail-activity" }[section];
  return (
    <View testID={testID}>
      <View style={{ height: StyleSheet.hairlineWidth, marginHorizontal: m.padH, backgroundColor: tokens.card.border }} />
      <View style={{ paddingTop: 4, paddingBottom: 8, paddingHorizontal: m.padH - 6 }}>
        <SectionHeading m={m} tokens={tokens} title={title} summary={summary} closed={props.closed} language={props.language} onPress={() => setSectionClosed(section, !props.closed)} />
        {props.closed ? null : section === "properties" ? (
          <Properties {...props} />
        ) : section === "subtasks" ? (
          <Subtasks {...props} />
        ) : section === "usage" ? (
          <Usage {...props} />
        ) : (
          <Activity {...props} />
        )}
      </View>
    </View>
  );
}

function SectionHeading(props: { m: Metrics; tokens: TaskTokens; title: string; summary: string; closed: boolean; language: TasksLanguage; onPress(): void }) {
  const { m, tokens } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  const words = cardStrings(props.language).details;
  const color = hovered ? tokens.foreground : tokens.foregroundMuted;
  const font = m === TOUCH_CARD ? 13 : 12;
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
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: font, color, fontVariant: ["tabular-nums"] }}>
          {props.summary}
        </Text>
      ) : null}
    </Pressable>
  );
}

const WORKSPACE_ICONS = { local_checkout: "Laptop", worktree: "GitFork", checkout: "Laptop", directory: "Folder" } as const;

function Properties(props: Inner) {
  const { card, m, tokens } = props;
  const words = props.strings.property;
  const cardText = cardStrings(props.language);
  const location = card.location;
  const [width, setWidth] = useState(0);
  const wide = width >= TWO_COLUMNS;
  let place: React.ReactNode = null;
  if (location.projectName || location.workspaceName) {
    const kind = location.workspaceKind;
    place = (
      <PropertyRow
        language={props.language}
        key="place"
        m={m}
        tokens={tokens}
        label={words.project}
        lead={<ProjectIcon location={location} size={m.icon} />}
        pre={location.projectName && location.workspaceName ? `${location.projectName} ›` : null}
        value={location.workspaceName ?? location.projectName ?? ""}
        badges={kind ? <Badge tokens={tokens} icon={WORKSPACE_ICONS[kind]} text={cardText.kind[kind]} /> : null}
        testID="detail-place"
      />
    );
  }
  let branch: React.ReactNode = null;
  if (location.branch) {
    const hint = branchHint(location.git);
    branch = (
      <PropertyRow
        language={props.language}
        key="branch"
        m={m}
        tokens={tokens}
        label={words.branch}
        icon="GitBranch"
        value={location.branch}
        copy={{ text: location.branch, toast: "Copy branch name", label: cardText.details.copyBranch }}
        badges={
          hint.sync || hint.dirty ? (
            <>
              {hint.sync ? <Badge tokens={tokens} text={hint.sync} /> : null}
              {hint.dirty ? <Badge tokens={tokens} dot={tokens.warning} text={cardText.uncommitted} /> : null}
            </>
          ) : null
        }
        testID="detail-branch"
      />
    );
  } else if (location.git === null) {
    branch = <PropertyRow language={props.language} key="branch" m={m} tokens={tokens} label={words.branch} icon="GitBranch" value={cardText.details.notGit} muted testID="detail-branch" />;
  }
  const rows: React.ReactNode[] = [];
  if (wide && place && branch) {
    rows.push(
      <View key="pair" style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>{place}</View>
        <View style={{ flex: 1, minWidth: 0 }}>{branch}</View>
      </View>,
    );
  } else {
    if (place) rows.push(place);
    if (branch) rows.push(branch);
  }
  if (location.pullRequest) {
    const pr = location.pullRequest;
    rows.push(
      <PropertyRow
        language={props.language}
        key="pr"
        m={m}
        tokens={tokens}
        label={words.pr}
        icon="GitPullRequest"
        pre={pr.number !== null ? `#${pr.number}` : null}
        value={pr.title}
        copy={{ text: pr.url, toast: "Copy URL", label: cardText.details.copyLink }}
        link={pr.url}
        testID="detail-pr"
      />,
    );
  }
  rows.push(
    <PropertyRow
      language={props.language}
      key="cwd"
      m={m}
      tokens={tokens}
      label={words.cwd}
      icon="Folder"
      value={tildePath(location.cwd)}
      path
      copy={{ text: location.cwd, toast: "Copy path", label: cardText.details.copyPath }}
      testID="detail-cwd"
    />,
  );
  if (card.parent) {
    const parent = card.parent;
    const title = parent.title ?? (parent.missing ? cardText.parentArchived : cardText.parentUnknown);
    const jump = props.onJump && !parent.missing ? () => props.onJump?.(parent.id) : undefined;
    rows.push(
      <PropertyRow
        language={props.language}
        key="parent"
        m={m}
        tokens={tokens}
        label={words.parent}
        icon="CornerLeftUp"
        value={title}
        onPress={jump}
        accessibilityLabel={`${words.parent}: ${title}`}
        badges={parent.missing ? <Badge tokens={tokens} icon="Archive" text={cardText.details.archived} /> : null}
        chevron={!!jump}
        testID="detail-parent"
      />,
    );
  }
  return <View onLayout={(event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))}>{rows}</View>;
}

/**
 * A property: icon, a muted label column, the value (a muted prefix, then the
 * value cut to one line), its badges. A copyable row copies on a press; with a
 * pointer, hovering it shows its actions, and a copy says so in the row.
 */
function PropertyRow(props: {
  m: Metrics;
  tokens: TaskTokens;
  language: TasksLanguage;
  label: string;
  icon?: string;
  lead?: React.ReactNode;
  pre?: string | null;
  value: string;
  muted?: boolean;
  path?: boolean;
  badges?: React.ReactNode;
  copy?: { text: string; toast: string; label: string };
  link?: string;
  onPress?(): void;
  accessibilityLabel?: string;
  chevron?: boolean;
  testID?: string;
}) {
  const { m, tokens } = props;
  const words = cardStrings(props.language).details;
  const scale = useTasksFontScale();
  const colors = detailColors(tokens);
  const { hovered, hoverProps } = useHover();
  const { copied, copy } = useCopy();
  const [columns, setColumns] = useState<number | null>(null);
  const touch = m === TOUCH_CARD;
  const doCopy = props.copy ? () => void copy(props.copy!.text, { label: props.copy!.toast }) : undefined;
  const press = props.onPress ?? doCopy;
  const shown = props.path ? shortenPath(props.value, columns ?? 28) : props.value;
  const onValueLayout = props.path
    ? (event: LayoutChangeEvent) => {
        const next = Math.max(8, Math.floor(event.nativeEvent.layout.width / (Math.round(m.font * scale) * 0.56)));
        setColumns((was) => (was === next ? was : next));
      }
    : undefined;
  const actions = !touch && hovered && !copied && (props.copy || props.link);
  const valueText: TextStyle = { fontSize: m.font, color: props.muted ? tokens.foregroundMuted : tokens.foreground };
  const content = (
    <>
      <View style={{ width: m.icon, alignItems: "center" }}>{props.lead ?? (props.icon ? <Icon name={props.icon} size={m.icon} color={tokens.foregroundMuted} /> : null)}</View>
      <Text numberOfLines={1} style={{ width: m.labelWidth * Math.max(1, scale), fontSize: m.font, color: tokens.foregroundMuted }}>
        {props.label}
      </Text>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 4 }} onLayout={onValueLayout}>
        {props.pre ? (
          <Text numberOfLines={1} style={{ flexShrink: 2, fontSize: m.font, color: tokens.foregroundMuted }}>
            {props.pre}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={[valueText, { flexShrink: 1 }]}>
          {shown}
        </Text>
      </View>
      {props.badges}
      {actions ? (
        <View style={{ flexDirection: "row", gap: 2, marginRight: -2 }}>
          {props.link ? <RowAction icon="ExternalLink" label={words.openLink} tokens={tokens} onPress={() => openLink(props.link!)} /> : null}
          {props.copy ? <RowAction icon="Copy" label={props.copy.label} tokens={tokens} onPress={doCopy!} /> : null}
        </View>
      ) : null}
      {copied ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="Check" size={14} color={tokens.success} />
          {!touch ? <Text style={{ fontSize: 12, color: tokens.success }}>{words.copied}</Text> : null}
        </View>
      ) : null}
      {props.chevron ? <Icon name="ChevronRight" size={14} color={tokens.foregroundMuted} /> : null}
    </>
  );
  const style: ViewStyle = {
    minHeight: taskControlHeight(m.row, scale),
    paddingHorizontal: 6,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  };
  if (!press) {
    return (
      <View testID={props.testID} style={style}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      {...(props.copy || props.link ? ROW_ROLE : { accessibilityRole: "button" as const })}
      accessibilityLabel={props.accessibilityLabel ?? (props.copy ? `${props.copy.label}: ${props.copy.text}` : props.label)}
      onPress={press}
      {...hoverProps}
      testID={props.testID}
      style={({ pressed }) => ({ ...style, backgroundColor: hovered || pressed || copied ? colors.rowHover : "transparent" })}
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

function Subtasks(props: Inner) {
  const { card, m, tokens } = props;
  const scale = useTasksFontScale();
  const cardText = cardStrings(props.language);
  const shown = card.children.slice(0, SUBTASK_ROWS * 2);
  const rest = card.children.length - shown.length;
  return (
    <View>
      <SubtaskBar segments={subtaskSegments(card)} tokens={tokens} language={props.language} font={m === TOUCH_CARD ? 14 : 13} />
      {shown.map((child) => (
        <SubtaskRow key={child.id} m={m} tokens={tokens} title={child.title} color={statusColor(child.status, tokens)} word={cardText.status[child.status]} onPress={props.onJump ? () => props.onJump?.(child.id) : undefined} />
      ))}
      {rest > 0 ? (
        <View style={{ height: taskControlHeight(m.listRow, scale), paddingHorizontal: 6, justifyContent: "center" }}>
          <Text style={{ fontSize: m.font, color: tokens.foregroundMuted }}>{cardText.more(rest)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SubtaskRow(props: { m: Metrics; tokens: TaskTokens; title: string; color: string; word: string; onPress?(): void }) {
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
        paddingHorizontal: 6,
        borderRadius: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: props.onPress && (hovered || pressed) ? detailColors(tokens).rowHover : "transparent",
      })}
    >
      <View style={{ width: 8, height: 8, marginHorizontal: 4, borderRadius: 4, backgroundColor: props.color }} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: m.font, color: tokens.foreground }}>
        {props.title}
      </Text>
      <Text style={{ fontSize: m.font - 1, color: tokens.foregroundMuted }}>{props.word}</Text>
      {props.onPress ? <Icon name="ChevronRight" size={14} color={tokens.foregroundMuted} /> : null}
    </Pressable>
  );
}

function Usage(props: Inner) {
  const { card, m, tokens } = props;
  const words = cardStrings(props.language).details;
  const touch = props.touch === true;
  const font = touch ? 14 : 13;
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
  return <TimelineChart timeline={line} liveColor={statusColor(props.card.status, props.tokens)} tokens={props.tokens} />;
}

// ---- Buttons ---------------------------------------------------------------

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

function OpenHint(props: { tokens: TaskTokens; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: props.tokens.success }} />
      <Text style={{ fontSize: 11, color: props.tokens.foregroundMuted }}>{props.label}</Text>
    </View>
  );
}

function OutlineButton(props: {
  icon: string;
  iconColor?: string;
  label: string;
  hint?: React.ReactNode;
  trailing?: string;
  height: number;
  font: number;
  tokens: TaskTokens;
  grow?: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { tokens } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
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
        minWidth: 0,
        height: taskControlHeight(props.height, scale),
        paddingHorizontal: props.grow ? 10 : 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: hovered ? detailColors(tokens).rowHover : tokens.card.background,
        flexDirection: "row",
        alignItems: "center",
        gap: props.grow ? 8 : 6,
      }}
    >
      <Icon name={props.icon} size={15} color={props.iconColor ?? tokens.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: props.font, fontWeight: "500", color: tokens.foreground }}>
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
 * Running: open the tab and stop. Asking: allow as the main button, deny
 * beside it, and the tab shrunk to a square. Otherwise: open the tab.
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
}) {
  const { card } = props;
  const tokens = taskTokens(props.theme);
  const stop = stopLabel(props as TaskDetailCardsProps);
  const buttons = card.lane === "needs_input" && props.onPermission ? (props.permissionButtons ?? []) : [];
  const respond = buttons.filter((button) => button.kind === "respond");
  const answer = buttons.find((button) => button.kind === "open");
  const asking = respond.length > 0 || !!answer;
  if (!props.onOpen && !stop && !asking) return null;
  const open = () => props.onOpen?.(card.id);
  // Deny first, allow last: the main button sits under the thumb.
  const ordered = [...respond].sort((a, b) => (a.action.behavior === "allow" ? 1 : 0) - (b.action.behavior === "allow" ? 1 : 0));
  return (
    <View testID="detail-action-bar" style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.border }}>
      {asking ? (
        <>
          {props.onOpen ? <BarButton tokens={tokens} icon="AppWindow" label={openLabel(props as TaskDetailCardsProps)} square onPress={open} testID="detail-bar-open" /> : null}
          {ordered.map((button) => (
            <BarButton
              key={button.key}
              tokens={tokens}
              label={button.label}
              primary={button.action.behavior === "allow" && button.variant === "primary"}
              danger={button.variant === "danger"}
              onPress={() => props.onPermission?.(button)}
            />
          ))}
          {answer ? <BarButton tokens={tokens} label={answer.label} primary onPress={() => props.onPermission?.(answer)} /> : null}
        </>
      ) : (
        <>
          {props.onOpen ? <BarButton tokens={tokens} icon="AppWindow" label={openLabel(props as TaskDetailCardsProps)} primary onPress={open} testID="detail-bar-open" /> : null}
          {stop && props.stop ? <BarButton tokens={tokens} icon="Square" iconColor={tokens.danger} label={stop} grow={false} onPress={props.stop.onPress} testID="detail-bar-stop" /> : null}
        </>
      )}
    </View>
  );
}

function BarButton(props: { tokens: TaskTokens; icon?: string; iconColor?: string; label: string; primary?: boolean; danger?: boolean; square?: boolean; grow?: boolean; onPress(): void; testID?: string }) {
  const { tokens } = props;
  const scale = useTasksFontScale();
  const height = taskControlHeight(48, scale);
  const text = props.primary ? tokens.card.onStrong : props.danger ? tokens.danger : tokens.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      testID={props.testID}
      style={({ pressed }) => ({
        height,
        width: props.square ? height : undefined,
        flexGrow: props.square || props.grow === false ? 0 : 1,
        flexShrink: props.square ? 0 : 1,
        paddingHorizontal: props.square ? 0 : 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: props.primary ? tokens.accent : tokens.border,
        backgroundColor: props.primary ? tokens.accent : tokens.card.background,
        opacity: pressed ? 0.85 : 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      })}
    >
      {props.icon ? <Icon name={props.icon} size={18} color={props.primary ? text : props.iconColor ?? tokens.foregroundMuted} /> : null}
      {props.square ? null : (
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 16, fontWeight: "600", color: text }}>
          {props.label}
        </Text>
      )}
    </Pressable>
  );
}
