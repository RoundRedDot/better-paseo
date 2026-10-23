import React, { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions, type GestureResponderEvent, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, HOST_LINE, HOST_FONT as F, laneTitle, TASK_MONO, useTasksFontScale, taskControlHeight } from "../typography";
import { labelLimitCount, type CardSettings } from "../../../shared/tasks-settings";
import { useHover } from "../../ui/use-hover";
import { useCopy } from "../../ui/use-copy";
import { toolbarLabel } from "../../i18n/toolbar-strings";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { duration, PREVIEW_REVEAL } from "../../ui/tokens/motion";
import type { PermissionButton, StopPhase } from "../actions";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import { opensInPaseo, turnRunning, type StatusKind, type TaskCard, type TaskChild } from "../model";
import { contextRatio, tildePath } from "./format";
import { cardStart, cardTimer, startHint, timerHint, type Timed } from "./card-time";
import { CardHints, hintProps, type CardHintTexts } from "./card-hints";
import { useTime, type TaskClock, type TimeSource } from "./clock";
import { ContextRing, contextRingTone, formatSessionCost, formatTokenCount } from "./context-ring";
import { agentPillColors, BrandMark, branchPillColors, neutralPillColors, type AgentPillColors } from "./brand-mark";
import { THINKING_ICON } from "./mode-icons";
import { ProjectIcon } from "./project-icon";
import { SpinnerRing, StatusIcon } from "./status-icon";
import { ChildMark } from "./child-mark";
import { CardContextMenu } from "./card-menu";
import { bindContextMenu } from "../../web";
import { CascadeMenu, MENU, type MenuSection } from "../board/menu";
import { layoutMenu } from "../board/menu-model";
import { buttonOutline } from "../board/board-style";
import { panelChrome } from "./panel";
import { cardStrings, subtaskSummary } from "./strings";
import { TagMark } from "./tag-mark";
import { pillTint, taskTokens, type TaskTokens } from "./tokens";
import { mix, withAlpha } from "../../components/theme-tokens";

export interface CardCallbacks {
  /** Jump to the agent's tab (`navigation.openAgent`). Absent on hosts without navigation: hide Open tab. */
  onOpen?(agentId: string): void;
  /** Scroll the board to a card and highlight it (child → parent link). */
  onReveal(agentId: string): void;
  /**
   * Stop, if the card is stoppable and Stop is available. `dialog`: a context
   * menu's Stop, which asks in a dialog instead of arming the button (unless
   * `board.confirmStop` is off).
   */
  onStop?(card: TaskCard, options?: { withChildren?: boolean; dialog?: boolean }): void;
  onCancelStop?(agentId: string): void;
  /** Mark read, if the card is readable and the server reaches the daemon. */
  onRead?(card: TaskCard): void;
  /** Unarchive an archived task, if the daemon's CLI is reachable (as for Stop). */
  onUnarchive?(agentId: string): void;
  /** Archive a done task, as Paseo's own Archive does. */
  onArchive?(agentId: string): void;
  onPermission?(card: TaskCard, button: PermissionButton): void;
  /** A long press on a phone or touch screen: the details sheet or sidebar. */
  onDetails?(card: TaskCard): void;
  /**
   * A press on the body chooses the card for the details sidebar instead of
   * opening its tab; on desktop a second click right after opens the tab.
   */
  onSelect?(card: TaskCard): void;
}

export interface TaskCardViewProps extends CardCallbacks {
  card: TaskCard;
  /** Field switches after `effectiveCard`. */
  fields: CardSettings;
  theme: PluginTheme;
  /** Phone layout (`layout.compact`): must/default/details-only tiers, larger type and targets. */
  compact: boolean;
  /** The permission buttons for `card.permission` (from `permissionButtons`). */
  permissionButtons: PermissionButton[];
  stopPhase: StopPhase;
  /** A mark read is on its way: the button waits, disabled. */
  readPending?: boolean;
  /** An unarchive is on its way: the button spins, and a second press does nothing. */
  unarchivePending?: boolean;
  /** An archive is on its way: the button spins, and a second press does nothing. */
  archivePending?: boolean;
  /** Keyboard focus ring. */
  focused: boolean;
  /** The 1 s highlight after a parent link scrolled here. */
  highlighted: boolean;
  /** The card the details sidebar shows. */
  current?: boolean;
  /** A fixed instant (ms) for the timer: previews and tests. Beats `clock`. */
  now?: number;
  /**
   * The board's clock, ticking once a second while visible. Only the timer
   * text reads it, so a tick re-renders that text and not the card.
   */
  clock?: TaskClock;
  /** The board's language; read from the preferences when absent. */
  language?: TasksLanguage;
  /** False stops the running ring (a hidden pane, a static preview). Default true. */
  animated?: boolean;
  /** False keeps the model, branch and folder pills plain: a static preview copies nothing. Default true. */
  copyable?: boolean;
  /** The host's id: with the project id it keys the project icon's colour, as Paseo's sidebar does. */
  hostId?: string;
}

const WEB = Platform.OS === "web";
/** No hover: the stop button and the subtask jump buttons stay visible. */
const TOUCH = !WEB;
/** Between the footer's timer and its buttons. */
const FOOT_GAP = 6;
/**
 * The card and a subtask row hold buttons of their own, so on web they must not
 * be buttons: React Native Web draws `role="button"` as a `<button>`, and a
 * `<button>` inside another is invalid HTML (React reports it, and Paseo shows
 * the error badge). As a `group` the Pressable is a focusable `<div>`: a click
 * on the body presses it, Enter on it while focused presses it (RNW's
 * PressResponder), and an inner button's click and keydown stop propagating
 * before they reach it. Native has no such nesting rule, and the responder
 * system gives a touch to the innermost Pressable, so it keeps the button role.
 */
const CONTAINER_ROLE = WEB ? ({ role: "group" } as const) : ({ accessibilityRole: "button" } as const);
/** Touch: a long press. */
const LONG_PRESS_MS = 450;
/**
 * The card a single click just chose, and how to open its tab. Choosing a card
 * can bring in the floating details panel and scroll the lanes clear of it, so
 * a double click's second click often lands on the panel or on another card. A
 * capture listener on the document takes that second click, wherever it lands,
 * and opens the card the first one chose. Any other click disarms it.
 */
let armedOpen: { id: string; open(agentId: string): void } | null = null;
let doubleClickListening = false;

function armDoubleClick(id: string, open: (agentId: string) => void) {
  armedOpen = { id, open };
  if (doubleClickListening || typeof document === "undefined") return;
  doubleClickListening = true;
  document.addEventListener(
    "click",
    (event) => {
      const armed = armedOpen;
      armedOpen = null;
      // `detail` counts the clicks at the system's double-click speed.
      if (!armed || event.detail !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      armed.open(armed.id);
    },
    true,
  );
}
const NBSP = "\u00a0";
/** " > " between meta segments; non-breaking, since a web text box drops a leading space. */
const SEPARATOR = `${NBSP}\u203a${NBSP}`;
const PARENT_SHRINK = 1000;

// --- Geometry (Linear's issue card, measured on the desktop app) -------------

interface Metrics {
  padH: number;
  padTop: number;
  padBottom: number;
  /** Meta row: project, workspace, parent; muted, one line. */
  metaSize: number;
  metaLine: number;
  /** Meta row to title row. */
  titleGap: number;
  titleSize: number;
  titleLine: number;
  /** The status icon's slot; its box is two wider so the mark keeps the sidebar's 12 px. */
  iconSlot: number;
  iconBox: number;
  /** Title to pills, pills to footer, footer to a lane block. */
  rowGap: number;
  pillHeight: number;
  pillText: number;
  pillLine: number;
  pillPad: number;
  /** A pill's icons and brand mark, and the gap between them. */
  pillIcon: number;
  pillGap: number;
  icon: number;
  footSize: number;
  footLine: number;
  /** Lane block text. */
  blockSize: number;
  blockLine: number;
  buttonHeight: number;
}

/**
 * A pill's text against the card's small text (meta row, footer): at the same
 * size the pills read as loud as the title beside them, so they sit a notch
 * under it. A ratio, not a size, so the pills follow whatever step the card's
 * text takes, and TaskText scales both with the interface size.
 */
const PILL_TEXT_RATIO = 11 / 12;
/** A pill holds one line, so its line sits tighter than the ramp's 1.4. */
const PILL_LINE_RATIO = 1.25;

function pillType(small: number): Pick<Metrics, "pillText" | "pillLine"> {
  const text = small * PILL_TEXT_RATIO;
  return { pillText: text, pillLine: Math.round(text * PILL_LINE_RATIO) };
}

// Text sizes are steps of the host's type ramp (`HOST_FONT`), which TaskText scales with the user's interface size.
const DESKTOP: Metrics = {
  padH: 12,
  padTop: 10,
  padBottom: 12,
  metaSize: F.sm,
  metaLine: HOST_LINE.sm,
  titleGap: 5,
  // At `sm` on desktop the title read no louder than the meta row and pills around it.
  get titleSize() {
    return laneTitle().size;
  },
  get titleLine() {
    return laneTitle().line;
  },
  iconSlot: 14,
  iconBox: 16,
  rowGap: 10,
  pillHeight: 20,
  ...pillType(F.sm),
  pillPad: 8,
  pillIcon: 11,
  pillGap: 5,
  icon: 12,
  footSize: F.sm,
  footLine: HOST_LINE.sm,
  blockSize: F.sm,
  blockLine: HOST_LINE.sm,
  buttonHeight: 28,
};

const PHONE: Metrics = {
  padH: 14,
  padTop: 12,
  padBottom: 14,
  metaSize: F.sm,
  metaLine: HOST_LINE.sm,
  titleGap: 6,
  titleSize: F.base,
  titleLine: HOST_LINE.base,
  iconSlot: 18,
  iconBox: 20,
  rowGap: 12,
  pillHeight: 24,
  ...pillType(F.sm),
  pillPad: 9,
  pillIcon: 12,
  pillGap: 6,
  icon: 14,
  footSize: F.sm,
  footLine: HOST_LINE.sm,
  blockSize: F.sm,
  blockLine: HOST_LINE.smRead,
  buttonHeight: 32,
};

const GAP = 6;
const tabular: TextStyle = { fontVariant: ["tabular-nums"] };
const webTransition = (WEB
  ? { transitionProperty: "background-color, border-color, box-shadow, color, opacity", transitionDuration: "120ms", transitionTimingFunction: "ease-out" }
  : {}) as ViewStyle;

/**
 * Stop's hover entrance on web: a fade with the preview's 4px drift in from
 * the card's right edge, then a plain fade out. RNW compiles keyframes only
 * through `StyleSheet.create`. Native shows Stop all the time, so has none.
 */
const STOP_EXIT_MS = duration.fast;
const stopMotion = WEB
  ? StyleSheet.create({
      enter: {
        // A string: RNW drops an array transform inside keyframes.
        animationKeyframes: [{ from: { opacity: 0, transform: `translateX(${PREVIEW_REVEAL.shift}px)` } }],
        animationDuration: `${PREVIEW_REVEAL.ms}ms`,
        animationTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
      } as ViewStyle,
      exit: {
        animationKeyframes: [{ to: { opacity: 0 } }],
        animationDuration: `${STOP_EXIT_MS}ms`,
        animationTimingFunction: "ease-out",
        animationFillMode: "forwards",
      } as ViewStyle,
    })
  : null;

/** True for `ms` after `shown` turns false, so a control can fade out before it unmounts. */
function useLeaving(shown: boolean, ms: number): boolean {
  const [was, setWas] = useState(shown);
  const [leaving, setLeaving] = useState(false);
  if (was !== shown) {
    setWas(shown);
    setLeaving(!shown && ms > 0);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), ms);
    return () => clearTimeout(timer);
  }, [leaving, ms]);
  return leaving;
}

// --- What the card shows ----------------------------------------------------

/** The rows and pills a card draws for a field set; pure, so tier and collapse rules are testable. */
export interface CardLayout {
  /** The model pill: brand mark (`brand`) and the model, or the provider's name when the model is off or unknown. */
  modelPill: boolean;
  brand: boolean;
  model: boolean;
  thinking: boolean;
  project: boolean;
  /** Paseo's project icon before the project name: its image, or the generated initial square. */
  projectAvatar: boolean;
  workspace: boolean;
  branch: boolean;
  gitStatus: boolean;
  folder: boolean;
  path: boolean;
  pullRequest: boolean;
  labels: number;
  labelLimit: number;
  timer: boolean;
  context: boolean;
  subtasks: boolean;
  failure: boolean;
  permission: boolean;
}

/**
 * Desktop follows the switches. Compact keeps the must tier whatever the
 * switches say (status, title, agent, model, thinking, timer, actions,
 * permission, failure), lets the default tier follow them (project,
 * workspace, branch, first label, subtasks) and never draws the
 * details-only tier (folder, path, git status, PR, project icon).
 */
export function cardLayout(card: TaskCard, fields: CardSettings, compact: boolean): CardLayout {
  const location = card.location;
  const project = fields.project && !!location.projectName;
  const ratio = contextRatio(card.context);
  const path = !compact && fields.path && !!location.cwd;
  const projectAvatar = project && !compact && fields.projectIcon;
  return {
    modelPill: compact || fields.provider || fields.model,
    brand: card.providerMark !== null && (compact || fields.provider),
    model: !!card.modelLabel && (compact || fields.model),
    thinking: !!card.thinkingLabel && (compact || fields.thinking),
    project,
    projectAvatar,
    workspace: fields.workspace && !!location.workspaceName,
    branch: fields.branch && !!location.branch,
    gitStatus: !compact && fields.branch && fields.gitStatus && !!location.branch && location.git !== null,
    folder: !compact && !path && fields.folder && !!location.folder,
    path,
    pullRequest: !compact && fields.pullRequest && location.pullRequest !== null,
    labels: fields.labels ? card.labels.length : 0,
    labelLimit: compact ? 1 : labelLimitCount(fields.labelLimit),
    timer: compact || fields.timer,
    context: turnRunning(card) && ratio !== null && (compact ? ratio > 0.8 : fields.context),
    subtasks: fields.subtasks && card.children.length > 0,
    // Review: a failure or a manual stop. Done: the board's "Stopped manually" after a stop the daemon filed as idle.
    failure: (card.lane === "review" || card.lane === "done") && !!card.error,
    permission: card.lane === "needs_input" && card.permission !== null,
  };
}

/**
 * The request's summary after its title, unless the title already says it:
 * "Run npm run db:migrate · npm run db:migrate" reads the command twice.
 */
function summaryBeyondTitle(title: string, summary: string | null): string | null {
  if (!summary) return null;
  const words = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  return words(title).includes(words(summary)) ? null : summary;
}

/** Children that Stop with subtasks would reach. */
function activeChildren(card: TaskCard): number {
  return card.children.filter((child) => child.kind !== "provider" && (child.status === "running" || child.status === "needs_input")).length;
}

/** The subtasks pill's groups, most urgent first. */
const SUBTASK_ORDER: readonly StatusKind[] = ["needs_input", "running", "failed", "unread", "done", "archived"];

/** A status's colour for a tint: the StatusIcon band for running, the theme's status roles otherwise. */
function statusTint(kind: StatusKind, tokens: TaskTokens): string | null {
  if (kind === "running") return tokens.status.running;
  if (kind === "needs_input") return tokens.warning;
  if (kind === "failed") return tokens.danger;
  if (kind === "unread") return tokens.success;
  return null;
}

// --- Overlays and control hover ----------------------------------------------

/**
 * RNW gives every View `position: relative; z-index: 0`, so each one is a
 * stacking context: an overlay's own zIndex only counts inside its row, and a
 * later sibling row (transparent, but still a hit target) sits above it. The
 * rows that hold overlays (the stop menu, the phone action bar's menu) are
 * therefore raised above the rows after them.
 */
export const OVERLAY_ROW_Z = 2;

// --- The card -----------------------------------------------------------------

function TaskCardViewImpl(given: TaskCardViewProps) {
  // An archived task has no Open, here or on its subtasks: Paseo would show another tab.
  // A provider subagent's card is read-only: no details, Stop, Mark read or
  // Archive, and a press or Open opens its parent's tab (the board's `onOpen`).
  const props = given.card.subagent
    ? { ...given, onSelect: undefined, onDetails: undefined, onStop: undefined, onRead: undefined, onArchive: undefined, onUnarchive: undefined, onPermission: undefined }
    : opensInPaseo(given.card) ? given : { ...given, onOpen: undefined };
  const { card, fields, compact, theme } = props;
  const scale = useTasksFontScale();
  const tokens = taskTokens(theme);
  const look = tokens.card;
  const preferred = useTasksLanguage();
  const language = props.language ?? preferred;
  const strings = cardStrings(language);
  const m = compact ? PHONE : DESKTOP;
  const layout = cardLayout(card, fields, compact);
  // On web the hover is the DOM's, child controls included (`bindRowHover`):
  // RNW's Pressable ends an ancestor's hover as soon as the pointer enters an
  // inner Pressable (its `hover:lock` event), which dropped the Stop button
  // the moment the pointer reached it. Native keeps the Pressable's own hover.
  const rootRef = useRef<View>(null);
  const { hovered, hoverProps } = useHover(rootRef);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stopAll, setStopAll] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [ringOpen, setRingOpen] = useState(false);
  // The right-click menu's window point (web). A right click inside the open menu leaves it be.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(
    () =>
      bindContextMenu(rootRef.current, (point, target) => {
        if ((target as Element | null)?.closest?.('[data-testid="task-card-menu"]')) return;
        setMenuAt(point);
      }),
    [],
  );

  const latest = useRef(props);
  latest.current = props;

  const parentHover = useHover();

  // Hover hints: each mark registers what it means under a key; the card's
  // hint layer reads the text only when a pointer rests on that mark.
  const hintTexts = useRef<CardHintTexts>(new Map());
  hintTexts.current.clear();
  const hint = (key: string, text: () => string | null) => {
    hintTexts.current.set(key, () => text() ?? "");
    return key;
  };
  const lines = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join("\n");
  const { pair } = strings.hint;

  // Leaving the card closes the menu and cancels an armed stop.
  const wasHovered = useRef(false);
  useEffect(() => {
    if (hovered === wasHovered.current) return;
    wasHovered.current = hovered;
    if (hovered) return;
    const current = latest.current;
    setMenuOpen(false);
    if (current.stopPhase === "confirming") current.onCancelStop?.(current.card.id);
  }, [hovered]);

  // A failed card stands out in danger red; the highlight and the sidebar's card still win.
  const failed = card.status === "failed";
  // The card a right-click menu belongs to keeps its hover look while the menu is open.
  const lit = hovered || menuAt !== null;
  /** The card's fill right now: the highlight, the sidebar's card, the failure tint, the hover grey, or the card. */
  const background = props.highlighted
    ? look.highlight
    : props.current
      ? look.current
      : failed
        ? lit ? look.failedHover : look.failed
        : lit ? look.hoverBackground : look.background;
  const canStop = card.stoppable && !!props.onStop;
  const parentStop = canStop && activeChildren(card) > 0;
  // A waiting card's hover buttons share the row with its answer buttons, so
  // Stop stays in the menu and the sidebar there and Open tab floats alone.
  const footStop = canStop && (TOUCH || card.lane !== "needs_input");
  const showStop = footStop && !compact && (TOUCH || hovered || props.stopPhase !== "idle" || menuOpen);
  // Mark read takes Stop's place: a card is never both (Stop needs a running
  // or waiting agent, Mark read one in review).
  const canRead = !canStop && card.readable === true && !!props.onRead;
  const readPending = props.readPending === true;
  const showRead = canRead && !compact && (TOUCH || hovered || readPending);
  // "Open tab" comes with them on a desktop card, or alone on one with neither;
  // a question's "Answer" already opens the tab.
  const canOpen = !compact && !!props.onOpen && !(layout.permission && props.permissionButtons.some((button) => button.kind === "open"));
  const showOpen = canOpen && (TOUCH || hovered || showStop || showRead);
  // An archived task has Unarchive where Open tab was: Paseo opens it only once it is back.
  const canUnarchive = card.archived === "agent" && !!props.onUnarchive;
  const unarchivePending = props.unarchivePending === true;
  const showUnarchive = canUnarchive && !compact && (TOUCH || hovered || unarchivePending);
  // A done task can be archived from its card, before Open tab.
  const canArchive = card.lane === "done" && !card.archived && !!props.onArchive;
  const archivePending = props.archivePending === true;
  const showArchive = canArchive && !compact && (TOUCH || hovered || archivePending);
  const showControl = showStop || showRead || showOpen || showUnarchive || showArchive;
  const reducedMotion = useReducedMotion();
  const controlLeaving = useLeaving(showControl && !TOUCH, reducedMotion ? 0 : STOP_EXIT_MS);
  const read = { tokens, strings, pending: readPending, unread: !failed, onPress: () => props.onRead?.(card) };
  const pressStop = (withChildren: boolean) => {
    setMenuOpen(false);
    setStopAll(withChildren);
    props.onStop?.(card, { withChildren });
  };
  const stop = {
    tokens,
    strings,
    phase: props.stopPhase,
    all: stopAll,
    parent: parentStop,
    count: activeChildren(card),
    menuOpen,
    onPress: () => pressStop(props.stopPhase === "confirming" ? stopAll : false),
    onToggleMenu: () => setMenuOpen((open) => !open),
    onCloseMenu: () => setMenuOpen(false),
    theme,
    onPick: pressStop,
  };

  const shadows = [lit ? look.shadowHover : look.shadow];
  if (props.focused) shadows.push(`0px 0px 0px 3px ${tokens.accentRing}`);
  const cardStyle = {
    paddingHorizontal: m.padH,
    paddingTop: m.padTop,
    paddingBottom: m.padBottom,
    // Linear's card: radius 8 (measured: the arc settles 16 device px in at 2x), a hairline,
    // and on hover only the fill and shadow change.
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: props.focused || props.highlighted ? tokens.accent : props.current ? look.currentBorder : failed ? look.failedBorder : look.border,
    backgroundColor: background,
    boxShadow: shadows.join(", "),
    zIndex: menuOpen ? 30 : hovered ? 2 : 1,
    ...webTransition,
  } as ViewStyle;

  const text = (size: number, line: number, color: string, weight: TextStyle["fontWeight"] = "400"): TextStyle => ({
    fontSize: size,
    lineHeight: line,
    color,
    fontWeight: weight,
  });
  const muted = tokens.foregroundMuted;
  const block: ViewStyle = {
    marginTop: m.rowGap,
    paddingTop: m.rowGap,
    borderTopWidth: 1,
    borderTopColor: failed && !props.current && !props.highlighted ? look.failedBorder : look.border,
  };

  const location = card.location;
  const metaParts: string[] = [];
  if (layout.project && location.projectName) metaParts.push(location.projectName);
  if (layout.workspace && location.workspaceName) metaParts.push(location.workspaceName);
  const metaText = metaParts.join(SEPARATOR);
  const hasMeta = metaText !== "" || card.parent !== null;

  // The context ring at the top right: on the meta row, or on the title row
  // when the meta row has nothing to say. Its details card opens downwards
  // over the rows below, so the ring's row is raised above them while it shows.
  const ratio = contextRatio(card.context);
  const ringFor = (line: number) =>
    layout.context && ratio !== null && card.context ? (
      <ContextMeter
        tokens={tokens}
        strings={strings}
        compact={compact}
        line={line}
        context={card.context}
        ratio={ratio}
        cost={card.usage?.totalCostUsd ?? null}
        theme={theme}
        onOpenChange={setRingOpen}
      />
    ) : null;
  const ringZ = ringOpen ? OVERLAY_ROW_Z + 1 : undefined;

  // Meta row ---------------------------------------------------------------
  const avatar = layout.projectAvatar;
  const metaStyle = text(m.metaSize, m.metaLine, muted);
  const parentLabel = card.parent
    ? card.parent.missing && card.parent.archived === true
      ? strings.parentArchived
      : card.parent.title ?? strings.parentUnknown
    : null;
  const metaRow = hasMeta ? (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: GAP, minHeight: Math.round(m.metaLine * scale), zIndex: ringZ }}
      testID="task-card-meta"
    >
      {avatar ? (
        <View {...hintProps(location.projectName ? hint("project", () => pair(strings.hint.project, location.projectName!)) : undefined)}>
          <ProjectIcon location={location} size={12} hostId={props.hostId} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>
        {metaText ? (
          <Text
            numberOfLines={1}
            style={[metaStyle, { flexShrink: 1, minWidth: 0 }]}
            testID="task-card-meta-location"
            {...hintProps(
              hint("location", () =>
                lines(
                  layout.project && location.projectName && pair(strings.hint.project, location.projectName),
                  layout.workspace && location.workspaceName && pair(strings.hint.workspace, location.workspaceName),
                ),
              ),
            )}
          >
            {metaText}
          </Text>
        ) : null}
        {metaText && parentLabel !== null ? (
          <Text style={[metaStyle, { flexShrink: 0 }]}>{SEPARATOR}</Text>
        ) : null}
        {parentLabel !== null ? (
          // The parent link gives way first: it shrinks a thousand times faster
          // than "project > workspace", which only truncates once the link is gone.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.revealParent}
            onPress={() => props.onReveal(card.parent!.id)}
            {...parentHover.hoverProps}
            style={{ flexShrink: PARENT_SHRINK, minWidth: 0 }}
            testID="task-card-meta-parent"
            {...hintProps(hint("parent", () => pair(strings.details.parent, parentLabel)))}
          >
            <Text numberOfLines={1} style={[metaStyle, parentHover.hovered ? { color: tokens.foreground } : null]}>
              {`↳${NBSP}${parentLabel}`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {ringFor(m.metaLine)}
    </View>
  ) : null;

  // Title row --------------------------------------------------------------
  const titleRow = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: GAP,
        marginTop: hasMeta ? m.titleGap : 0,
        zIndex: hasMeta ? undefined : ringZ,
      }}
      testID="task-card-title-row"
    >
      <View
        style={{ width: m.iconSlot, alignItems: "center" }}
        {...hintProps(hint("status", () => lines(pair(strings.hint.status, card.stoppedManually ? strings.hint.stopped : strings.status[card.status]), card.subagent && strings.subagentCard)))}
      >
        <StatusIcon
          kind={card.stoppedManually ? "stopped" : card.status}
          size={m.iconBox}
          height={Math.round(m.titleLine * scale)}
          theme={theme}
          backdrop={background}
          animated={props.animated}
        />
      </View>
      <Text
        numberOfLines={2}
        ellipsizeMode="tail"
        style={[text(m.titleSize, m.titleLine, tokens.foreground, "500"), { flex: 1 }]}
        testID="task-card-title"
      >
        {card.title}
      </Text>
      {hasMeta ? null : ringFor(m.titleLine)}
    </View>
  );

  // Pills ------------------------------------------------------------------
  // A pill that copies takes the touch, so it carries the card's long press too.
  const longPress = props.onDetails && (compact || TOUCH) ? () => props.onDetails?.(card) : undefined;
  const pill = { tokens, compact, language };
  // Model, branch and folder copy what they show; a pointer's hint says so.
  const copyOn = props.copyable !== false;
  const copyOf = (text: string, toast: string) => (copyOn ? { text, toast } : undefined);
  const withCopyHint = (hintText: string | null) => (copyOn ? lines(hintText, strings.hint.clickToCopy) : hintText);
  const pills: ReactNode[] = [];
  // Model and thinking in one item, in the brand's borderless status-pill colours:
  // the mark and the model, a middle dot, then the Brain icon and the thinking level. With the model
  // pill off the thinking level keeps a neutral pill of its own.
  const agentColors = agentPillColors(tokens, card.provider);
  const thinking = layout.thinking ? card.thinkingLabel : null;
  // A subagent's card shows the provider's facts line (type, model, effort, tokens) in the model's place.
  const facts = card.subagent?.subtitle ?? null;
  if (layout.modelPill) {
    const model = facts ?? (layout.model && card.modelLabel ? card.modelLabel : card.providerLabel);
    const name = model === card.providerLabel ? model : `${card.providerLabel} ${model}`;
    pills.push(
      <Pill
        key="model"
        {...pill}
        testID="pill-model"
        solid={agentColors}
        lead={layout.brand ? <BrandMark provider={card.provider} size={m.pillIcon} tokens={tokens} /> : undefined}
        label={model}
        accessibilityLabel={thinking ? `${name} ${thinking}` : name}
        copy={facts ? undefined : copyOf(model, model === card.providerLabel ? "Copy agent" : "Copy model name")}
        onLongPress={longPress}
        hint={hint("model", () => (facts ? lines(card.providerLabel, facts) : withCopyHint(lines(pair(strings.hint.model, name), thinking && pair(strings.hint.thinking, thinking)))))}
      >
        {thinking ? (
          <>
            {/* The dot sits closer than the pill's gap: the glyph brings its own side bearings. */}
            <Text
              style={{ fontSize: m.pillText, lineHeight: m.pillLine, color: mix(agentColors.background, agentColors.text, 0.7), marginHorizontal: -3 }}
              testID="agent-pill-dot"
            >
              ·
            </Text>
            <Icon name={THINKING_ICON} size={m.pillIcon} color={agentColors.icon} />
            <Text
              numberOfLines={1}
              style={{ fontSize: m.pillText, lineHeight: m.pillLine, color: agentColors.text, flexShrink: 0 }}
              testID="agent-pill-thinking"
            >
              {thinking}
            </Text>
          </>
        ) : null}
      </Pill>,
    );
  } else if (thinking) {
    pills.push(
      <Pill
        key="thinking"
        {...pill}
        testID="pill-thinking"
        solid={neutralPillColors(tokens, muted)}
        icon={THINKING_ICON}
        label={thinking}
        hint={hint("thinking", () => pair(strings.hint.thinking, thinking))}
      />,
    );
  }
  if (layout.branch && location.branch) {
    pills.push(
      // The branch: a faint blue fill, a blue icon and the name in monospace.
      <Pill
        key="branch"
        {...pill}
        testID="pill-branch"
        solid={branchPillColors(tokens)}
        icon="GitBranch"
        label={location.branch}
        mono
        copy={copyOf(location.branch, "Copy branch name")}
        onLongPress={longPress}
        hint={hint("branch", () => {
          const git = location.git;
          return withCopyHint(
            lines(
              pair(strings.hint.branch, location.branch!),
              git?.dirty && strings.details.dirty,
              git?.ahead ? strings.hint.ahead(git.ahead) : null,
              git?.behind ? strings.hint.behind(git.behind) : null,
            ),
          );
        })}
      >
        {layout.gitStatus && location.git ? (
          <GitStatus git={location.git} tokens={tokens} size={m.pillText} line={m.pillLine} />
        ) : null}
      </Pill>,
    );
  }
  if (layout.path) {
    pills.push(
      <Pill
        key="path"
        {...pill}
        testID="pill-path"
        icon="FolderOpen"
        label={tildePath(location.cwd)}
        copy={copyOf(location.cwd, "Copy path")}
        onLongPress={longPress}
        hint={hint("path", () => withCopyHint(pair(strings.hint.path, tildePath(location.cwd))))}
      />,
    );
  } else if (layout.folder && location.folder) {
    pills.push(
      <Pill
        key="folder"
        {...pill}
        testID="pill-folder"
        icon="Folder"
        label={location.folder}
        copy={copyOf(location.folder, "Copy folder name")}
        onLongPress={longPress}
        hint={hint("folder", () => withCopyHint(lines(pair(strings.hint.folder, location.folder!), tildePath(location.cwd))))}
      />,
    );
  }
  if (layout.labels > 0) {
    const shown = card.labels.slice(0, layout.labelLimit);
    for (const label of shown) {
      pills.push(
        <Pill
          key={`label-${label.name}`}
          {...pill}
          testID={`pill-label-${label.name}`}
          clear
          // The pill has no fill, so the tag's hole takes the card's, hovered or not.
          lead={<TagMark size={m.pillIcon} color={label.color ?? tokens.foregroundMuted} hole={background} />}
          label={label.name}
          hint={hint(`label-${label.name}`, () => pair(strings.hint.label, label.name))}
        />,
      );
    }
    const hidden = card.labels.length - shown.length;
    if (hidden > 0) {
      pills.push(
        <Pill
          key="labels-more"
          {...pill}
          clear
          testID="pill-labels-more"
          label={`+${hidden}`}
          tabular
          accessibilityLabel={card.labels
            .slice(shown.length)
            .map((label) => label.name)
            .join(", ")}
          hint={hint("labels-more", () =>
            pair(
              strings.hint.moreLabels,
              card.labels
                .slice(shown.length)
                .map((label) => label.name)
                .join(", "),
            ),
          )}
        />,
      );
    }
  }
  if (layout.pullRequest && location.pullRequest) {
    const pr = location.pullRequest;
    pills.push(
      <Pill
        key="pr"
        {...pill}
        testID="pill-pr"
        icon="GitPullRequest"
        label={pr.number !== null ? `#${pr.number}` : pr.title}
        tabular
        accessibilityLabel={pr.number !== null ? `#${pr.number} ${pr.title}` : pr.title}
        hint={hint("pr", () => pair(strings.hint.pr, pr.number !== null ? `#${pr.number} ${pr.title}` : pr.title))}
      />,
    );
  }
  if (layout.subtasks) {
    // Icons and counts, no words: ListTree, then each status the children are in.
    const counts = new Map<StatusKind, number>();
    for (const child of card.children) counts.set(child.status, (counts.get(child.status) ?? 0) + 1);
    // Tinted by the status most children are in; ties go to the more urgent one.
    let dominant: StatusKind | null = null;
    for (const kind of SUBTASK_ORDER) if ((counts.get(kind) ?? 0) > (dominant ? counts.get(dominant)! : 0)) dominant = kind;
    pills.push(
      <PillButton
        key="subtasks"
        {...pill}
        testID="pill-subtasks"
        tint={dominant ? statusTint(dominant, tokens) : null}
        icon="ListTree"
        accessibilityLabel={subtaskSummary(card.children, language)}
        hint={hint("subtasks", () => subtaskSummary(card.children, language))}
        expanded={expanded}
        onPress={() => setExpanded((open) => !open)}
      >
        {SUBTASK_ORDER.filter((kind) => counts.has(kind)).map((kind) => (
          <View key={kind} style={{ flexDirection: "row", alignItems: "center", gap: 3 }} testID={`subtask-count-${kind}`}>
            <StatusIcon kind={kind} size={m.pillIcon + 2} height={Math.round(m.pillLine * scale)} theme={theme} animated={props.animated} />
            <Text style={[{ fontSize: m.pillText, lineHeight: m.pillLine, color: muted }, tabular]}>{counts.get(kind)}</Text>
          </View>
        ))}
      </PillButton>,
    );
  }
  const pillRow =
    pills.length > 0 ? (
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 4, rowGap: 6, marginTop: m.rowGap }}
        testID="task-card-pills"
      >
        {pills}
      </View>
    ) : null;

  // Footer: the timer, and the hover buttons at the far right ---------------
  // Whether there is a timer and its tone do not change with the time; the text does, in `TimerText`.
  const timer = layout.timer ? cardTimer(card, props.now ?? 0, language) : null;
  // A running turn's start behind a clock, then how long it has run behind an hourglass, as the turn footer draws them;
  // a card waiting on its subtasks draws their work the same way.
  const started = timer && cardStart(card, props.now ?? 0) !== null;
  const timerColor =
    timer?.tone === "warning" ? tokens.warning : timer?.tone === "running" ? tokens.status.running : muted;
  // Stop's menu opens downwards over the blocks below, so the row holding the footer is raised while it can show.
  const footerZ = showControl || controlLeaving ? OVERLAY_ROW_Z : undefined;
  // A desktop card that can open, stop or be read keeps the footer even when
  // it has nothing else, so its buttons have a place to appear. A tablet's
  // buttons take a row of their own under it instead.
  const stopSlot = (footStop || canRead || canOpen || canUnarchive || canArchive) && !compact && !TOUCH;
  // The footer is as tall as the hover buttons on a desktop card that can
  // show them, hovered or not, so the button sits inside it with the card's
  // own gaps above and below instead of overhanging the pills, and hovering
  // still moves nothing.
  const footHeight = stopSlot && !TOUCH ? taskControlHeight(m.buttonHeight, scale) : Math.round(m.footLine * scale);
  // A desktop request's buttons take the footer in on their row: the wait sits
  // beside the answer it waits for, as the details sidebar shows it, rather
  // than above the divider with the buttons alone on a row of their own.
  const answerRow = layout.permission && card.permission !== null && !compact && props.permissionButtons.length > 0;
  const unarchiveButton = (onPhone: boolean) => (
    <CardButton
      label={strings.details.unarchive}
      look="plain"
      icon="ArchiveRestore"
      busy={unarchivePending}
      tokens={tokens}
      compact={onPhone}
      onPress={() => props.onUnarchive?.(card.id)}
      testID="task-card-unarchive"
    />
  );
  const archiveButton = (onPhone: boolean, hug = false) => (
    <CardButton
      label={strings.details.archive}
      look="archive"
      icon="Archive"
      busy={archivePending}
      tokens={tokens}
      compact={onPhone}
      hug={hug}
      onPress={() => props.onArchive?.(card.id)}
      testID="task-card-archive"
    />
  );
  // Stop, Mark read or Archive, then "Open tab" in the corner, centred on the line they sit on.
  const footControls = (line: number) => (
    <View style={{ flexDirection: "row", gap: GAP, marginVertical: (Math.round(line * scale) - taskControlHeight(m.buttonHeight, scale)) / 2 }}>
      {footStop ? <StopControl {...stop} compact={false} line={m.buttonHeight} menuLeft={canOpen} /> : canRead ? <ReadControl {...read} compact={false} line={m.buttonHeight} /> : null}
      {canArchive ? archiveButton(false) : null}
      {canOpen ? (
        <CardButton
          label={strings.openTab}
          look="plain"
          icon="AppWindow"
          tokens={tokens}
          compact={false}
          onPress={() => props.onOpen?.(card.id)}
          testID="task-card-open-tab"
        />
      ) : null}
      {canUnarchive ? unarchiveButton(false) : null}
    </View>
  );
  if (parentStop) hint("stop-options", () => strings.stopOptions);
  const footerContent =
    timer || stopSlot ? (
      <>
        {timer ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {started ? (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                testID="task-card-started"
                {...hintProps(hint("started", () => startHint(card, language)))}
              >
                <Icon name="Clock" size={m.icon} color={muted} />
                <StartText card={card} now={props.now} clock={props.clock} style={[text(m.footSize, m.footLine, muted), tabular]} />
              </View>
            ) : null}
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              testID="task-card-timer"
              {...hintProps(hint("timer", () => timerHint(card, props.now ?? Date.now(), language)))}
            >
              {timer.tone === "warning" ? <Icon name="Clock" size={m.icon} color={timerColor} /> : null}
              {started ? <Icon name="Hourglass" size={m.icon} color={timerColor} /> : null}
              <TimerText card={card} language={language} now={props.now} clock={props.clock} style={[text(m.footSize, m.footLine, timerColor), tabular]} />
            </View>
          </View>
        ) : null}
        {(showControl || controlLeaving) && !TOUCH ? (
          // On web the buttons appear on hover, so they float over the ring (the card's
          // fill behind it hides what it covers) instead of taking room from the
          // row: hovering must not move anything. Native shows it all the time, in flow.
          <View
            pointerEvents={controlLeaving ? "none" : "auto"}
            aria-hidden={controlLeaving || undefined}
            style={[
              {
                position: "absolute",
                right: 0,
                top: (footHeight - taskControlHeight(m.buttonHeight, scale)) / 2,
                paddingLeft: GAP,
                // Follows the card's fill as it eases back from the hover grey.
                backgroundColor: background,
                ...webTransition,
              },
              reducedMotion ? null : controlLeaving ? stopMotion?.exit : stopMotion?.enter,
            ]}
            testID={footStop ? "task-card-stop-overlay" : canRead ? "task-card-read-overlay" : canUnarchive ? "task-card-unarchive-overlay" : canArchive ? "task-card-archive-overlay" : "task-card-open-overlay"}
          >
            {footControls(m.buttonHeight)}
          </View>
        ) : null}
      </>
    ) : null;
  const footer =
    footerContent && !answerRow ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: FOOT_GAP, minHeight: footHeight, marginTop: m.rowGap, zIndex: footerZ }} testID="task-card-footer">
        {footerContent}
      </View>
    ) : null;
  // A tablet's buttons always take a row of their own, at the bottom right
  // under the timer (or under a request's answer row): beside the timer they
  // ran off a narrow lane's card. Stop's menu opens downwards over the blocks
  // below, so the row is raised.
  const controlRow =
    showControl && TOUCH ? (
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: answerRow ? 0 : m.rowGap, zIndex: OVERLAY_ROW_Z }} testID="task-card-control-row">
        {footControls(m.buttonHeight)}
      </View>
    ) : null;

  // Lane blocks ------------------------------------------------------------
  const iconCell: ViewStyle = { width: m.iconSlot, height: Math.round(m.blockLine * scale), alignItems: "center", justifyContent: "center" };
  const failure = layout.failure ? (
    <View style={[block, { flexDirection: "row", alignItems: "flex-start", gap: GAP }]} testID="task-card-reason">
      <View style={iconCell}>
        {card.stoppedManually && !failed ? (
          // Stopped: the stop pill's solid square, not Lucide's hollow one.
          <View style={{ width: m.icon - 4, height: m.icon - 4, borderRadius: 2, backgroundColor: muted }} testID="task-card-reason-stopped" />
        ) : (
          // A failure, in red; one marked read is done, in grey.
          <Icon name="CircleX" size={m.icon} color={failed ? tokens.danger : muted} />
        )}
      </View>
      <Text style={[text(m.blockSize, m.blockLine, failed ? tokens.danger : muted), { flex: 1 }]}>{card.error}</Text>
    </View>
  ) : null;

  const permission = card.permission;
  const asksQuestion = permission?.kind === "question" || permission?.kind === "other";
  const permissionSummary = permission ? summaryBeyondTitle(permission.title, permission.summary) : null;
  const permissionBlock =
    layout.permission && permission ? (
      <View style={[block, { gap: 8, zIndex: answerRow ? footerZ : undefined }]} testID="task-card-permission">
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: GAP }}>
          <View style={iconCell}>
            <Icon name={permissionIcon(permission.kind)} size={m.icon + 1} color={tokens.status.warning} />
          </View>
          <Text numberOfLines={2} style={[text(m.blockSize, m.blockLine, tokens.foreground), { flex: 1 }]}>
            <Text style={{ fontWeight: asksQuestion ? "500" : "600" }}>{permission.title}</Text>
            {permissionSummary ? <Text style={{ color: muted }}> · </Text> : null}
            {permissionSummary}
          </Text>
          {permission.remaining > 0 ? (
            <Text style={[text(m.blockSize - 1, m.blockLine, muted), tabular]}>{strings.more(permission.remaining)}</Text>
          ) : null}
        </View>
        {answerRow ? (
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: GAP }} testID="task-card-answer-row">
            {props.permissionButtons.map((button) => (
              <ActionButton
                key={button.key}
                button={button}
                tokens={tokens}
                compact={false}
                onPress={() => props.onPermission?.(card, button)}
              />
            ))}
            {footerContent ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: FOOT_GAP, minHeight: footHeight, marginLeft: "auto" }} testID="task-card-footer">
                {footerContent}
              </View>
            ) : null}
          </View>
        ) : null}
        {answerRow ? controlRow : null}
      </View>
    ) : null;

  const subtaskList =
    layout.subtasks && expanded ? (
      <View style={[block, { paddingTop: m.rowGap - 4 }]} testID="task-card-subtasks">
        {card.children.map((child) => (
          <SubtaskRow
            key={child.id}
            child={child}
            parentId={card.id}
            theme={theme}
            tokens={tokens}
            compact={compact}
            openLabel={strings.openInWorkspace}
            parentTabLabel={strings.openParentTab}
            statusHint={hint(`child-${child.id}`, () =>
              lines(pair(strings.hint.status, strings.status[child.status]), child.kind === "provider" && strings.subagent),
            )}
            openHint={hint("child-open", () => strings.openInWorkspace)}
            parentTabHint={hint("child-parent-tab", () => lines(strings.openParentTab, strings.subagent))}
            backdrop={background}
            animated={props.animated}
            language={language}
            now={props.now}
            clock={props.clock}
            onReveal={props.onReveal}
            onOpen={props.onOpen}
          />
        ))}
      </View>
    ) : null;

  // Phone action bar -------------------------------------------------------
  const buttons = compact && layout.permission ? props.permissionButtons : [];
  // "Answer" already opens the tab, so it stands in for "Open tab". As in the
  // details sheet's bar, "Open tab" sits last, at the right, taking the room
  // Stop or Mark read leaves, and beside Allow and Deny it is a square icon.
  const openTab = compact && !!props.onOpen && !buttons.some((button) => button.kind === "open");
  const openSquare = openTab && buttons.length > 0;
  // Stop is as wide as its label beside a button that opens the tab ("Open tab" or "Answer").
  const stopHugs = (openTab && !openSquare) || buttons.some((button) => button.kind === "open");
  const actionBar =
    compact && (openTab || buttons.length > 0 || canStop || canRead || canUnarchive || canArchive) ? (
      // One row: no flexWrap, whose Yoga layout left a phantom second row's
      // height under the buttons on Android.
      <View style={{ flexDirection: "row", gap: 8, marginTop: m.rowGap, zIndex: OVERLAY_ROW_Z }} testID="task-card-actions">
        {buttons.map((button) => (
          <ActionButton
            key={button.key}
            button={button}
            tokens={tokens}
            compact
            onPress={() => props.onPermission?.(card, button)}
          />
        ))}
        {canStop ? <StopControl {...stop} compact hug={stopHugs} line={m.buttonHeight} menuLeft={openTab && buttons.length === 0} /> : null}
        {canRead ? <ReadControl {...read} compact hug={openTab} line={m.buttonHeight} /> : null}
        {canArchive ? archiveButton(true, openTab) : null}
        {openTab ? (
          <CardButton
            label={strings.openTab}
            look="plain"
            icon="AppWindow"
            square={openSquare}
            tokens={tokens}
            compact
            onPress={() => props.onOpen?.(card.id)}
            testID="task-card-open-tab"
          />
        ) : null}
        {canUnarchive ? unarchiveButton(true) : null}
      </View>
    ) : null;

  const pressBody = props.onSelect
    ? (event?: GestureResponderEvent) => {
        // On web the press is the DOM click. The document's listener takes a
        // double click's second click, so a later one (a triple click) changes
        // nothing here; Enter on a focused card counts 0 and only chooses it.
        const clicks = (event?.nativeEvent as { detail?: number } | undefined)?.detail ?? 0;
        if (WEB && clicks >= 2) return;
        if (WEB && clicks === 1 && props.onOpen) armDoubleClick(card.id, props.onOpen);
        props.onSelect?.(card);
      }
    : props.onOpen
      ? () => props.onOpen?.(card.id)
      : undefined;

  return (
    <Pressable
      {...CONTAINER_ROLE}
      accessibilityLabel={card.title}
      onPress={pressBody}
      onLongPress={longPress}
      delayLongPress={LONG_PRESS_MS}
      ref={rootRef}
      {...(WEB ? null : hoverProps)}
      style={cardStyle}
      testID={`task-card-${card.id}`}
    >
      {metaRow}
      {titleRow}
      {pillRow}
      {footer}
      {answerRow ? null : controlRow}
      {permissionBlock}
      {failure}
      {subtaskList}
      {actionBar}
      {WEB ? <CardHints root={rootRef} texts={hintTexts} theme={theme} color={tokens.foreground} /> : null}
      {menuAt ? (
        <CardContextMenu
          point={menuAt}
          card={card}
          strings={strings}
          theme={theme}
          actions={{
            open: props.onOpen ? () => props.onOpen?.(card.id) : undefined,
            // Stop asks in a dialog first (unless confirm before stopping is off): there is no button to arm.
            stop: canStop && props.stopPhase !== "stopping"
              ? (withChildren) => {
                  setStopAll(withChildren);
                  props.onStop?.(card, { withChildren, dialog: true });
                }
              : undefined,
            children: parentStop ? activeChildren(card) : 0,
            stopAllLeading: <StopTreeGlyph tokens={tokens} color={tokens.danger} />,
            read: canRead && !readPending ? () => props.onRead?.(card) : undefined,
            unarchive: canUnarchive ? () => props.onUnarchive?.(card.id) : undefined,
            archive: canArchive && !archivePending ? () => props.onArchive?.(card.id) : undefined,
          }}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
    </Pressable>
  );
}

function permissionIcon(kind: string): string {
  if (kind === "question" || kind === "other") return "MessageCircleQuestion";
  if (kind === "plan") return "ListChecks";
  if (kind === "mode") return "ShieldCheck";
  return "Terminal";
}

// --- Pills ------------------------------------------------------------------

interface PillProps {
  tokens: TaskTokens;
  compact: boolean;
  /** The pill's text; a pill of icons and counts passes children instead. */
  label?: string;
  /** A Lucide icon before the text. */
  icon?: string;
  /** Any other leading mark (the agent's brand, a label's tag). */
  lead?: ReactNode;
  /** No fill, only the neutral hairline: the card shows through (the label pills). */
  clear?: boolean;
  /** Text and icon colour; muted by default. */
  color?: string;
  /** The data colour the pill is tinted with (label, status); null or absent for the neutral pill. */
  tint?: string | null;
  /** A borderless filled pill (the agent pills): its fill, label and icon colours. */
  solid?: AgentPillColors;
  tabular?: boolean;
  /** The label in monospace, a size down (a branch name). */
  mono?: boolean;
  accessibilityLabel?: string;
  /** The key of its hover hint (`CardHints`). */
  hint?: string;
  testID?: string;
  children?: ReactNode;
  /** The card's language, for a copy pill's accessibility hint. */
  language?: TasksLanguage;
  /**
   * A press copies `text`; `toast` names the copy as a toolbar button would
   * ("Copy branch name"), so the toast says what was copied.
   */
  copy?: { text: string; toast: string };
  /** The card's own long press, kept on a pill that takes the touch. */
  onLongPress?(): void;
}

/**
 * Linear's property pill, 20 high (24 on a phone), fully rounded, with a
 * hairline; filled with a light tint of its data colour, or neutral grey.
 */
export function pillStyle(tokens: TaskTokens, compact: boolean, tint: string | null = null, solid?: AgentPillColors, scale = 1): ViewStyle {
  const m = compact ? PHONE : DESKTOP;
  const colors = solid ? { background: solid.background, border: "transparent" } : pillTint(tokens, tint);
  return {
    height: taskControlHeight(m.pillHeight, scale),
    minWidth: taskControlHeight(m.pillHeight, scale),
    maxWidth: "100%",
    borderRadius: taskControlHeight(m.pillHeight, scale) / 2,
    borderWidth: solid ? 0 : StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: m.pillPad,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: m.pillGap,
  };
}

function PillContent(props: PillProps) {
  const m = props.compact ? PHONE : DESKTOP;
  const color = props.solid?.text ?? props.color ?? props.tokens.foregroundMuted;
  return (
    <>
      {props.lead ?? null}
      {props.icon ? <Icon name={props.icon} size={m.pillIcon} color={props.solid?.icon ?? color} /> : null}
      {props.label !== undefined ? (
        <Text
          numberOfLines={1}
          style={[
          { fontSize: m.pillText, lineHeight: m.pillLine, color, flexShrink: 1, fontWeight: props.solid ? "500" : "400" },
          props.tabular ? tabular : null,
          props.mono ? { fontFamily: TASK_MONO } : null,
        ]}
        >
          {props.label}
        </Text>
      ) : null}
      {props.children}
    </>
  );
}

function Pill(props: PillProps) {
  const scale = useTasksFontScale();
  if (props.copy) return <CopyPill {...props} copy={props.copy} />;
  return (
    <View
      style={[pillStyle(props.tokens, props.compact, props.tint ?? null, props.solid, scale), props.clear ? { backgroundColor: "transparent" } : null]}
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
      {...hintProps(props.hint)}
    >
      <PillContent {...props} />
    </View>
  );
}

/**
 * A pill whose press copies what it shows (model, branch, folder, path). It
 * keeps its look; a pointer over it darkens it a step as the subtasks pill
 * does, and the host's toast confirms the copy. The press stays on the pill,
 * so the card behind it is not chosen or opened.
 */
function CopyPill(props: PillProps & { copy: NonNullable<PillProps["copy"]> }) {
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  const { copy } = useCopy();
  const base = pillStyle(props.tokens, props.compact, props.tint ?? null, props.solid, scale);
  const { text, toast } = props.copy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityHint={toolbarLabel(toast, props.language ?? "en")}
      onPress={() => void copy(text, { label: toast, feedback: "toast" })}
      onLongPress={props.onLongPress}
      delayLongPress={LONG_PRESS_MS}
      {...hoverProps}
      {...hintProps(props.hint)}
      testID={props.testID}
      style={[
        base,
        hovered ? { backgroundColor: mix(base.backgroundColor as string, props.tokens.foreground, 0.06) } : null,
        webTransition,
      ]}
    >
      <PillContent {...props} />
    </Pressable>
  );
}

function PillButton(props: PillProps & { expanded: boolean; onPress(): void }) {
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ expanded: props.expanded }}
      onPress={props.onPress}
      {...hoverProps}
      {...hintProps(props.hint)}
      testID={props.testID}
      style={[
        pillStyle(props.tokens, props.compact, props.tint ?? null, undefined, scale),
        hovered || props.expanded ? { backgroundColor: mix(pillTint(props.tokens, props.tint ?? null).background, props.tokens.foreground, 0.06) } : null,
        webTransition,
      ]}
    >
      <PillContent {...props} color={hovered ? props.tokens.foreground : props.color} />
    </Pressable>
  );
}

function GitStatus(props: {
  git: NonNullable<TaskCard["location"]["git"]>;
  tokens: TaskTokens;
  size: number;
  line: number;
}) {
  const { git, tokens } = props;
  const hasArrows = git.ahead !== null || git.behind !== null;
  if (!git.dirty && !hasArrows) return null;
  return (
    <>
      {git.dirty ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.warning }} /> : null}
      {hasArrows ? (
        <Text style={[{ fontSize: props.size, lineHeight: props.line, color: tokens.foregroundMuted }, tabular]}>
          {git.ahead !== null ? <Text style={{ color: git.ahead > 0 ? tokens.success : tokens.foregroundMuted }}>{`↑${git.ahead}`}</Text> : null}
          {git.ahead !== null && git.behind !== null ? " " : null}
          {git.behind !== null ? <Text style={{ color: git.behind > 0 ? tokens.warning : tokens.foregroundMuted }}>{`↓${git.behind}`}</Text> : null}
        </Text>
      ) : null}
    </>
  );
}

// --- Context ------------------------------------------------------------------

/**
 * The host composer's context ring, at the card's top right; on desktop a
 * hover shows the host's context details in a small card below it. The card floats
 * (absolutely positioned), so showing it moves nothing.
 */
function ContextMeter(props: {
  tokens: TaskTokens;
  strings: ReturnType<typeof cardStrings>;
  compact: boolean;
  line: number;
  context: NonNullable<TaskCard["context"]>;
  ratio: number;
  cost: number | null;
  theme: PluginTheme;
  onOpenChange(open: boolean): void;
}) {
  const { tokens, strings, context } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  const open = hovered && !props.compact;
  const { onOpenChange } = props;
  useEffect(() => {
    onOpenChange(open);
    return () => onOpenChange(false);
  }, [open, onOpenChange]);
  const tone = contextRingTone(props.ratio);
  const color = tone === "danger" ? tokens.danger : tone === "warning" ? tokens.warning : tokens.foregroundMuted;
  const percent = Math.round(props.ratio * 100);
  const cost = formatSessionCost(props.cost);
  return (
    <Pressable
      accessibilityRole="image"
      accessibilityLabel={`${strings.contextWindow} ${strings.contextUsed(percent)}`}
      focusable={false}
      {...hoverProps}
      style={{ height: Math.round(props.line * scale), justifyContent: "center" }}
      testID="task-card-context"
    >
      <ContextRing ratio={props.ratio} color={color} track={withAlpha(tokens.foregroundMuted, 0.25)} />
      {open ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: -8,
            top: Math.round(props.line * scale) + 6,
            minWidth: 180,
            paddingHorizontal: 10,
            paddingVertical: 8,
            gap: 4,
            ...panelChrome(props.theme),
          } as ViewStyle}
          testID="task-card-context-details"
        >
          <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, fontWeight: "500", color: tokens.foreground }}>{strings.contextWindow}</Text>
          <Text style={[{ fontSize: F.base, lineHeight: HOST_LINE.base, color: tokens.foreground }, tabular]}>{strings.contextUsed(percent)}</Text>
          <Text style={[{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }, tabular]}>
            {strings.contextTokens(formatTokenCount(context.usedTokens), formatTokenCount(context.maxTokens))}
          </Text>
          {cost ? (
            <Text style={[{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }, tabular]}>{strings.sessionCost(cost)}</Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// --- Buttons ------------------------------------------------------------------

/** A system font at least this much larger than normal lets a phone button's label wrap. */
export const LARGE_FONT_SCALE = 1.15;
/** A phone button is never narrower than this. */
export const PHONE_BUTTON_MIN_WIDTH = 72;

/**
 * A phone action button's share of the bar: as wide as its label on one
 * line, then an equal part of what is left. At a normal font size a
 * permission button never shrinks under its label, so no label breaks
 * inside a word ("Sto/p", "Allo/w"); only the stop pill gives width back
 * when the labels do not fit side by side (an armed "Confirm stop" beside
 * Allow and Deny on a narrow phone), shrinking its font to fit its one
 * line, never under 75%. With an enlarged system font any label may take a
 * second line, broken between words.
 */
export function phoneButtonSizing(fontScale: number, yields = false): {
  wraps: boolean;
  box: ViewStyle;
  label: TextStyle;
  lines: number;
  fit: { adjustsFontSizeToFit?: boolean; minimumFontScale?: number };
} {
  const wraps = fontScale >= LARGE_FONT_SCALE;
  const shrinks = wraps || yields;
  return {
    wraps,
    box: { flexGrow: 1, flexShrink: shrinks ? 1 : 0, flexBasis: "auto", minWidth: PHONE_BUTTON_MIN_WIDTH },
    label: { flexShrink: shrinks ? 1 : 0 },
    lines: wraps ? 2 : 1,
    fit: !wraps && yields ? { adjustsFontSizeToFit: true, minimumFontScale: 0.75 } : {},
  };
}

/** A permission answer or "go answer": 28 high, radius 6; 32 and evenly split on a phone. */
export function ActionButton(props: {
  button: PermissionButton;
  tokens: TaskTokens;
  compact: boolean;
  onPress(): void;
}) {
  const { button } = props;
  const answer = button.kind === "open";
  const primary = button.variant === "primary" && !answer;
  // Deny pairs with Allow: Allow's accent outline, Deny the Stop button's danger one.
  const danger = !answer && !primary && (button.variant === "danger" || button.action.behavior === "deny");
  let look: CardButtonLook = "plain";
  if (answer) look = "answer";
  else if (primary) look = "primary";
  else if (danger) look = "danger";
  return (
    <CardButton
      label={answer ? button.label.replace(/\s*\u2197\s*$/, "") : button.label}
      accessibilityLabel={button.label}
      look={look}
      icon={answer ? null : button.action.behavior === "allow" ? "Check" : "X"}
      tokens={props.tokens}
      compact={props.compact}
      onPress={props.onPress}
    />
  );
}

export type CardButtonLook = "primary" | "plain" | "danger" | "answer" | "archive";

/**
 * The card's button, always an outline: plain grey, Allow's accent, Archive's
 * yellow, the Stop button's danger, or "Answer" in the needs-input amber with its arrow. A busy
 * one keeps its look and label, dimmed, and swaps its icon for the hollow
 * spinner ring (`SpinnerRing`).
 */
export function CardButton(props: {
  label: string;
  /** The label read out, when it differs from the one drawn. */
  accessibilityLabel?: string;
  look: CardButtonLook;
  icon?: string | null;
  tokens: TaskTokens;
  compact: boolean;
  /** Working: dimmed, a spinner in place of the icon, and no second press. */
  busy?: boolean;
  /** A phone's icon-only button, as wide as it is high; the label is read out. */
  square?: boolean;
  /** On a phone, as wide as its label: "Open tab" beside it takes the rest. */
  hug?: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { tokens, compact, look: kind } = props;
  const square = compact && props.square === true;
  const scale = useTasksFontScale();
  const look = tokens.card;
  const { hovered: hover, hoverProps } = useHover();
  const hovered = hover && !props.busy;
  const answer = kind === "answer";
  // Every look is an outline: a 0.5 px border, label and icon in its hue and
  // no fill at rest; hovered, that hue tinted over the card. "Answer" opens the
  // tab for a question in the needs-input icon's amber (the statusDot band).
  const hue = {
    plain: { color: tokens.foreground, border: look.buttonBorder, hover: look.controlHover },
    primary: { color: look.primaryText, border: look.primaryBorder, hover: look.primaryHover },
    danger: { color: tokens.danger, border: tokens.danger, hover: look.dangerHover },
    answer: { color: look.answerText, border: look.answerBorder, hover: look.answerHover },
    archive: { color: look.archiveText, border: look.archiveBorder, hover: look.archiveHover },
  }[kind];
  const color = hue.color;
  const fill = hovered ? hue.hover : "transparent";
  const border = hue.border;
  const size = compact ? 14 : 13;
  const sizing = phoneButtonSizing((useWindowDimensions().fontScale ?? 1) * scale);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={props.busy ? { disabled: true, busy: true } : undefined}
      disabled={props.busy}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={{
        // A phone's button grows with a large system font.
        ...(compact ? { minHeight: PHONE.buttonHeight, paddingVertical: 4, ...sizing.box } : { height: taskControlHeight(DESKTOP.buttonHeight, scale) }),
        ...(compact && props.hug ? { flexGrow: 0 } : null),
        ...(square ? { width: taskControlHeight(PHONE.buttonHeight, scale), minWidth: 0, flexGrow: 0, flexShrink: 0 } : null),
        paddingHorizontal: square ? 0 : compact ? 12 : 10,
        borderRadius: compact ? 7 : 6,
        ...buttonOutline(border),
        backgroundColor: fill,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        opacity: props.busy ? 0.6 : 1,
        ...webTransition,
      }}
    >
      {props.busy ? (
        // The running ring without its dot, in the icon's box so the button keeps its width.
        <SpinnerRing size={size} color={color} testID={props.testID ? `${props.testID}-spinner` : undefined} />
      ) : props.icon ? (
        <Icon name={props.icon} size={size} color={color} />
      ) : null}
      {square ? null : (
        <Text numberOfLines={compact ? sizing.lines : 1} {...(compact ? sizing.fit : null)} style={{ ...(compact ? sizing.label : null), textAlign: "center", fontSize: F.sm, fontWeight: "500", color }}>
          {props.label}
        </Text>
      )}
      {/* The one arrow: a label that still ends in its own is trimmed by the caller. */}
      {answer ? <Icon name="ArrowUpRight" size={size} color={color} /> : null}
    </Pressable>
  );
}

/**
 * Mark read: a card button's size, as Stop and "Answer" are, led by
 * Lucide's CheckCheck (a read receipt). On an unread card it wears the unread
 * dot's green as an outline: a 0.5 px border of that hue and no fill at rest,
 * the green tinted on hover, the label pulled to 4.5:1. A failed card keeps the plain
 * outline, so no green sits on its danger tint. While the request is out a
 * spinner takes the icon's place, the label stays, dimmed, and the button
 * takes no second press.
 */
function ReadControl(props: {
  tokens: TaskTokens;
  strings: ReturnType<typeof cardStrings>;
  pending: boolean;
  /** An unread card's green; a failed card's button stays plain. */
  unread: boolean;
  compact: boolean;
  /** On a phone, as wide as its label: "Open tab" beside it takes the rest. */
  hug?: boolean;
  /** The line it sits on, so it centres without growing the row. */
  line: number;
  onPress(): void;
}) {
  const { tokens, strings, pending, compact } = props;
  const scale = useTasksFontScale();
  const look = tokens.card;
  const { hovered, hoverProps } = useHover();
  const sizing = phoneButtonSizing((useWindowDimensions().fontScale ?? 1) * scale, true);
  const height = taskControlHeight(compact ? PHONE.buttonHeight : DESKTOP.buttonHeight, scale);
  const label = strings.markRead;
  const iconSize = compact ? 14 : 13;
  const hover = hovered && !pending;
  const color = props.unread ? look.readText : tokens.foreground;
  const fill = hover ? (props.unread ? look.readHover : look.controlHover) : "transparent";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={pending ? { disabled: true, busy: true } : undefined}
      disabled={pending}
      onPress={props.onPress}
      {...hoverProps}
      testID="task-card-read"
      style={{
        ...(compact ? { ...sizing.box, ...(props.hug ? { flexGrow: 0 } : null), minHeight: height, paddingVertical: 4 } : { flexShrink: 0, height }),
        marginVertical: compact ? 0 : (Math.round(props.line * scale) - height) / 2,
        paddingHorizontal: compact ? 12 : 10,
        borderRadius: compact ? 7 : 6,
        ...buttonOutline(props.unread ? look.readBorder : look.buttonBorder),
        backgroundColor: fill,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        opacity: pending ? 0.6 : 1,
        ...webTransition,
      }}
    >
      {pending ? (
        // The running ring without its dot, in the icon's box so the button keeps its width.
        <SpinnerRing size={iconSize} color={color} testID="task-card-read-spinner" />
      ) : (
        <Icon name="CheckCheck" size={iconSize} color={color} />
      )}
      <Text numberOfLines={compact ? sizing.lines : 1} {...(compact ? sizing.fit : null)} style={{ ...(compact ? sizing.label : null), textAlign: "center", fontSize: F.sm, fontWeight: "500", color }}>
        {label}
      </Text>
    </Pressable>
  );
}

interface StopControlProps {
  tokens: TaskTokens;
  strings: ReturnType<typeof cardStrings>;
  phase: StopPhase;
  /** The armed stop includes the children. */
  all: boolean;
  parent: boolean;
  count: number;
  menuOpen: boolean;
  compact: boolean;
  /** On a phone, as wide as its label: "Open tab" beside it takes the rest. */
  hug?: boolean;
  /** The line it sits on, so it centres without growing the row. */
  line: number;
  /** "Open tab" sits to its right with room past it: the menu opens rightwards over it, staying on the card. */
  menuLeft?: boolean;
  onPress(): void;
  onToggleMenu(): void;
  onPick(withChildren: boolean): void;
  onCloseMenu(): void;
  theme: PluginTheme;
}

/**
 * Stop, its confirm state, and a parent's "only this / with subtasks" menu:
 * the details sidebar's stop button at a card button's size ("Answer"'s 28,
 * radius 6), a rounded rectangle led by Lucide's Power. At rest a danger outline and text with no fill, tinted on hover; armed,
 * a solid danger fill with white text; the parent's chevron is its end. Stopping
 * it goes back to the rest look and label, dimmed, a spinner in the icon's place.
 */
function StopControl(props: StopControlProps) {
  const { tokens, strings, phase, compact } = props;
  const scale = useTasksFontScale();
  const look = tokens.card;
  const confirming = phase === "confirming";
  const stopping = phase === "stopping";
  const solid = confirming;
  const stopHover = useHover();
  const chevronHover = useHover();
  const stopSections: MenuSection[] = [
    {
      key: "stop",
      items: [
        {
          key: "only",
          label: strings.stopOnlyThis,
          icon: "Power",
          onSelect: () => props.onPick(false),
        },
        {
          key: "all",
          label: strings.stopWithChildren,
          leading: <StopTreeGlyph tokens={tokens} />,
          hint: String(props.count),
          onSelect: () => props.onPick(true),
        },
      ],
    },
  ];
  const sizing = phoneButtonSizing((useWindowDimensions().fontScale ?? 1) * scale, true);
  const color = solid ? look.onStrong : tokens.danger;
  const fill = (hovered: boolean) =>
    solid ? (hovered ? look.dangerStrongHover : tokens.danger) : hovered ? look.dangerHover : "transparent";
  const height = taskControlHeight(compact ? PHONE.buttonHeight : DESKTOP.buttonHeight, scale);
  // A card button's: 7 at a phone's 32, 6 at the desktop's 28, as "Answer" is.
  const round = compact ? 7 : 6;
  const iconSize = compact ? 14 : 13;
  const label = confirming ? (props.all ? strings.confirmStopAll : strings.confirmStop) : strings.stop;
  const segment: ViewStyle = {
    ...(compact ? { minHeight: height, paddingVertical: 4 } : { height }),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    ...webTransition,
  };
  return (
    <View
      style={{
        flexDirection: "row",
        // On a phone the pill shares the action bar like the buttons, as wide
        // as its label: "Confirm stop" takes more than "Stop". Explicit grow
        // and basis, never the `flex` shorthand beside `flexShrink`.
        ...(compact ? { ...sizing.box, ...(props.hug ? { flexGrow: 0 } : null) } : { flexShrink: 0 }),
        marginVertical: compact ? 0 : (Math.round(props.line * scale) - height) / 2,
        zIndex: 40,
      }}
      testID="task-card-stop"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={stopping ? { disabled: true, busy: true } : undefined}
        disabled={stopping}
        onPress={props.onPress}
        {...stopHover.hoverProps}
        style={[
          segment,
          // Its right edge is the chevron's left on the web, where the lines
          // are shadows and cannot overlap.
          buttonOutline(tokens.danger, props.parent && Platform.OS === "web" ? { right: null } : {}),
          {
            ...(compact ? { flexGrow: 1, flexShrink: 1, flexBasis: "auto" } : null),
            gap: 5,
            // Armed on a phone the solid pill says what it does in words; its
            // square goes and its padding narrows, so "Confirm stop" fits
            // beside Allow and Deny at full size on a 360 pt phone.
            paddingHorizontal: compact ? (solid ? 10 : 12) : 10,
            backgroundColor: fill(stopHover.hovered && !stopping),
            borderTopLeftRadius: round,
            borderBottomLeftRadius: round,
            borderTopRightRadius: props.parent ? 0 : round,
            borderBottomRightRadius: props.parent ? 0 : round,
            opacity: stopping ? 0.6 : 1,
          },
        ]}
      >
        {stopping ? (
          // The running ring without its dot, in the icon's box so the button keeps its width.
          <SpinnerRing size={iconSize} color={color} testID="task-card-stop-spinner" />
        ) : compact && solid ? null : (
          <Icon name="Power" size={iconSize} color={color} />
        )}
        <Text numberOfLines={compact ? sizing.lines : 1} {...(compact ? sizing.fit : null)} style={{ ...(compact ? sizing.label : null), textAlign: "center", fontSize: F.sm, fontWeight: "500", color }}>
          {label}
        </Text>
      </Pressable>
      {props.parent ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.stopOptions}
          disabled={stopping}
          onPress={props.onToggleMenu}
          {...chevronHover.hoverProps}
          {...hintProps(props.menuOpen ? undefined : "stop-options")}
          style={[
            segment,
            {
              width: compact ? 36 : 26,
              ...buttonOutline(tokens.danger, { left: solid ? withAlpha(look.onStrong, 0.4) : withAlpha(tokens.danger, 0.4) }),
              marginLeft: Platform.OS === "web" ? 0 : -0.5,
              backgroundColor: fill((chevronHover.hovered && !stopping) || props.menuOpen),
              borderTopRightRadius: round,
              borderBottomRightRadius: round,
              opacity: stopping ? 0.6 : 1,
            },
          ]}
        >
          <Icon name={compact ? "ChevronUp" : "ChevronDown"} size={compact ? 14 : 13} color={color} />
        </Pressable>
      ) : null}
      {props.parent && props.menuOpen ? (
        // The board's Linear menu (radius 12, hairline, soft shadow, 32 pt
        // rows): below the pill on desktop, above the action bar on a phone.
        <CascadeMenu
          sections={stopSections}
          theme={props.theme}
          width={STOP_MENU_WIDTH}
          top={compact ? -(layoutMenu(stopSections, scale).height + 2 * StyleSheet.hairlineWidth + 6) : height + 4}
          align={props.menuLeft ? "left" : "right"}
          onClose={props.onCloseMenu}
          testID="task-card-stop-menu"
        />
      ) : null}
    </View>
  );
}

const STOP_MENU_WIDTH = 220;

/** A drawn mark in the menu's 16 pt icon slot. */
function MenuGlyph(props: { children: ReactNode }) {
  return <View style={{ width: MENU.icon, height: MENU.icon, alignItems: "center", justifyContent: "center" }}>{props.children}</View>;
}

/** "Stop with subtasks": the subtask tree with a small stop square at its corner. */
function StopTreeGlyph(props: { tokens: TaskTokens; color?: string }) {
  const muted = props.color ?? props.tokens.foregroundMuted;
  return (
    <MenuGlyph>
      <Icon name="ListTree" size={14} color={muted} />
      <View
        style={{
          position: "absolute",
          right: -1,
          bottom: -1,
          width: 7,
          height: 7,
          borderRadius: 2,
          backgroundColor: muted,
          borderWidth: 1.5,
          borderColor: props.tokens.surface0,
        }}
        testID="stop-square"
      />
    </MenuGlyph>
  );
}

/**
 * One expanded child: its agent's mark, the title, then its start and timer
 * at the end. Press reveals it on the board; the jump button opens its tab.
 * A provider subagent has neither, so press opens the parent's tab, where
 * Paseo's subagent track lists it; the tab icon at its end, always drawn,
 * tells it from a child with a card of its own.
 */
function SubtaskRow(props: TimeSource & {
  child: TaskChild;
  parentId: string;
  theme: PluginTheme;
  tokens: TaskTokens;
  compact: boolean;
  openLabel: string;
  parentTabLabel: string;
  /** Hover hint keys (`CardHints`) for the status mark, the jump button and a provider row's tab icon. */
  statusHint: string;
  openHint: string;
  parentTabHint: string;
  /** The card's fill, under the mark's status corner while the row is not hovered. */
  backdrop: string;
  animated?: boolean;
  language: TasksLanguage;
  onReveal(agentId: string): void;
  onOpen?(agentId: string): void;
}) {
  const { child, tokens, compact } = props;
  const scale = useTasksFontScale();
  const m = compact ? PHONE : DESKTOP;
  // DOM hover on web, as the card: the row's own Pressable hover would end
  // when the pointer reaches its jump button, and hide it.
  const rowRef = useRef<View>(null);
  const { hovered, hoverProps } = useHover(rowRef);
  const provider = child.kind === "provider";
  const showJump = !provider && !!props.onOpen && (compact || TOUCH || hovered);
  const fill = hovered && !compact ? tokens.card.controlHover : props.backdrop;
  const size = compact ? 32 : 22;
  return (
    <Pressable
      {...CONTAINER_ROLE}
      accessibilityLabel={provider && props.onOpen ? `${child.title}, ${props.parentTabLabel}` : child.title}
      onPress={() => (provider ? props.onOpen?.(props.parentId) : props.onReveal(child.id))}
      ref={rowRef}
      {...(WEB ? null : hoverProps)}
      style={{
        minHeight: compact ? 36 : 28,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: GAP,
        paddingVertical: (compact ? 36 - m.blockLine : 28 - m.blockLine) / 2,
        paddingLeft: 6,
        paddingRight: 2,
        marginHorizontal: -6,
        borderRadius: 6,
        backgroundColor: fill,
        ...webTransition,
      }}
    >
      {/* The agent's mark with its status on the corner, centred on the title's first line. */}
      <View style={{ width: m.iconSlot, height: Math.round(m.blockLine * scale), alignItems: "center", justifyContent: "center" }} testID={`subtask-status-${child.id}`} {...hintProps(props.statusHint)}>
        <ChildMark child={child} tokens={tokens} theme={props.theme} backdrop={fill} animated={props.animated} />
      </View>
      <Text numberOfLines={2} style={{ flex: 1, fontSize: m.blockSize, lineHeight: m.blockLine, color: tokens.foreground }}>
        {child.title}
      </Text>
      {child.lane && child.timing ? (
        <SubtaskTime
          timed={{ lane: child.lane, timing: child.timing, waitingOnSubtasks: child.waitingOnSubtasks }}
          language={props.language}
          now={props.now}
          clock={props.clock}
          style={[{ fontSize: m.blockSize, lineHeight: m.blockLine, color: tokens.foregroundMuted, flexShrink: 0 }, tabular]}
          testID={`subtask-time-${child.id}`}
        />
      ) : null}
      {props.onOpen && !provider ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.openLabel}
          disabled={!showJump}
          onPress={() => props.onOpen?.(child.id)}
          {...hintProps(showJump ? props.openHint : undefined)}
          style={{
            width: size,
            height: size,
            marginVertical: (Math.round(m.blockLine * scale) - size) / 2,
            marginRight: compact ? -8 : 0,
            borderRadius: 5,
            alignItems: "center",
            justifyContent: "center",
            opacity: showJump ? 1 : 0,
          }}
        >
          <Icon name="ArrowUpRight" size={compact ? 16 : 14} color={tokens.foregroundMuted} />
        </Pressable>
      ) : null}
      {props.onOpen && provider ? (
        // Not a button: the row is the press. Only the mark and its hint.
        <View
          testID={`subtask-parent-tab-${child.id}`}
          {...hintProps(props.parentTabHint)}
          style={{
            width: size,
            height: size,
            marginVertical: (Math.round(m.blockLine * scale) - size) / 2,
            marginRight: compact ? -8 : 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="AppWindow" size={compact ? 16 : 14} color={tokens.foregroundMuted} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The footer's timer text: the one part of a card that follows the clock. It
 * re-renders when its text changes (a running timer every second, "5 min
 * ago" once a minute); the card around it does not.
 */
function TimerText(props: TimeSource & { card: TaskCard; language: TasksLanguage; style: StyleProp<TextStyle> }) {
  const { card, language } = props;
  const value = useTime(props, (now) => cardTimer(card, now, language)?.text ?? "");
  return <Text style={props.style}>{value}</Text>;
}

/** A subtask's "14:41 · 14m 14s" while it runs, else its timer as a card footer reads it. */
function SubtaskTime(props: TimeSource & { timed: Timed; language: TasksLanguage; style: StyleProp<TextStyle>; testID?: string }) {
  const { timed, language } = props;
  // The short stamp: a full one ("2026-10-22 16:57:33") leaves the title a few characters a line.
  const value = useTime(props, (now) => [cardStart(timed, now), cardTimer(timed, now, language, true)?.text].filter(Boolean).join(" · "));
  return value ? (
    <Text numberOfLines={1} style={props.style} testID={props.testID}>
      {value}
    </Text>
  ) : null;
}

/** The running turn's start; it follows the clock only to add the date after midnight. */
function StartText(props: TimeSource & { card: TaskCard; style: StyleProp<TextStyle> }) {
  const { card } = props;
  const value = useTime(props, (now) => cardStart(card, now) ?? "");
  return <Text style={props.style}>{value}</Text>;
}

/**
 * With a fixed `now`, the card re-renders for a new instant only when its
 * timer text changes; with the board's `clock` a tick never reaches it (the
 * timer text reads the clock itself). Every other prop compares by identity,
 * so the board passes stable callbacks and keeps a card object until it changes.
 */
export function sameCardProps(prev: TaskCardViewProps, next: TaskCardViewProps): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof TaskCardViewProps>;
  for (const key of keys) {
    if (key === "now") continue;
    if (prev[key] !== next[key]) return false;
  }
  if (prev.now === next.now) return true;
  if (prev.now === undefined || next.now === undefined) return false;
  if (!cardLayout(next.card, next.fields, next.compact).timer) return true;
  // The en and zh texts change at the same instants.
  return cardTimer(prev.card, prev.now, "en")?.text === cardTimer(next.card, next.now, "en")?.text;
}

export const TaskCardView = memo(TaskCardViewImpl, sameCardProps);
