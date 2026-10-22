import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import type { PaseoApi } from "@getpaseo/client";
import { DEFAULT_TASKS_SETTINGS, TASKS_SETTINGS, effectiveCard, type CardSettings, type LaneWidth, type TasksSettings } from "../../../shared/tasks-settings";
import { permissionButtons, respondToPermission, useReadControl, useStopControl, useUnarchiveControl, type PermissionButton, type ReadControl, type StopControl, type UnarchiveControl } from "../actions";
import type { CardCallbacks, TaskClock } from "../cards";
import { filterLanes, useTasks, type TasksHandle } from "../data";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import { LANE_ORDER, type BoardFilters, type LaneId, type LaneModel, type TaskCard, type TaskPermission } from "../model";
import { MOTION } from "./board-style";
import { carriedSettings, useCarriedTasks } from "./carry";
import { lingerBoard } from "./prefetch";
import { nameCompare, sortLaneCards } from "./sort";
import {
  decodeBoardParams,
  encodeBoardParams,
  isEmptyParams,
  lastBoardParams,
  rememberBoardParams,
  resolveBoardParams,
  type BoardDefaults,
  type BoardParams,
} from "./params";
import { BOARD_STRINGS, type BoardStrings } from "./strings";
import { useBoardClock, useBoardVisible } from "./visibility";

/** What both layouts share: settings, data after the filters, the clock, and the card callbacks. */
export interface BoardController {
  /** The host the board shows; the cards key project icon colours by it, as Paseo's sidebar does. */
  hostId: string;
  language: TasksLanguage;
  strings: BoardStrings;
  settings: TasksSettings;
  /** The lanes' width: the setting, or the one just picked on the board while it saves. */
  laneWidth: LaneWidth;
  /** Saves a lane width to the Tasks settings, so the settings page and every other client follow it. */
  setLaneWidth(width: LaneWidth): void;
  params: BoardParams;
  setParams(update: (params: BoardParams) => BoardParams): void;
  defaults: BoardDefaults;
  filters: BoardFilters;
  tasks: TasksHandle;
  /** The host's client, for what the details read on demand (a task's first prompt). */
  paseo: PaseoApi;
  /** The lanes after the filter bar and search. */
  lanes: Record<LaneId, LaneModel>;
  total: number;
  fields: CardSettings;
  /** The 1 s clock for what shows the time; its identity holds across ticks. */
  clock: TaskClock;
  visible: boolean;
  stop: StopControl;
  read: ReadControl;
  /** Unarchive for an archived parent in the details. */
  unarchive: UnarchiveControl;
  callbacks: CardCallbacks;
  buttonsFor(card: TaskCard): PermissionButton[];
  /** Fetch a rendered card's project icon; undefined when cards draw no project image (phone, or the field is off). */
  requestIcon: ((projectId: string) => void) | undefined;
  highlighted: string | null;
  highlight(agentId: string): void;
  toastMessage(message: string): void;
  /**
   * On a phone the board's own messages (a stop that failed, an answer that
   * did not send, a card hidden by the filters) show at the board's bottom,
   * not in the host's toast, which covers the header and its task count.
   */
  notice: BoardNotice | null;
  dismissNotice(): void;
}

export interface BoardNotice {
  id: number;
  message: string;
  tone: "info" | "error";
}

/** How long a phone notice stays. */
export const NOTICE_MS = 4000;

/** The layout's own answers to a parent link and a details request. */
export interface BoardLayoutHandlers {
  reveal(agentId: string): void;
  details(card: TaskCard): void;
}

const NO_BUTTONS: PermissionButton[] = [];
// One array per request and language, so a memoized card sees the same buttons on every tick.
const buttonCache = new WeakMap<TaskPermission, { language: TasksLanguage; buttons: PermissionButton[] }>();

function buttonsIn(card: TaskCard, language: TasksLanguage): PermissionButton[] {
  const permission = card.permission;
  if (!permission) return NO_BUTTONS;
  let entry = buttonCache.get(permission);
  if (entry?.language !== language) {
    entry = { language, buttons: permissionButtons(permission, language) };
    buttonCache.set(permission, entry);
  }
  return entry.buttons;
}

// One overlaid card per card and reason, so its identity holds across renders.
const stoppedCache = new WeakMap<TaskCard, TaskCard>();

/**
 * A card stopped from the board says so until it runs again: in the review
 * or done lane (the daemon idles a stopped agent without asking for
 * attention, so it usually lands in done), without an error of its own,
 * its reason reads "Stopped manually".
 */
export function withStopReasons(lanes: Record<LaneId, LaneModel>, stopped: ReadonlySet<string>, reason: string): Record<LaneId, LaneModel> {
  if (stopped.size === 0) return lanes;
  let out = lanes;
  for (const id of ["review", "done"] as const) {
    const lane = lanes[id];
    if (!lane.cards.some((card) => stopped.has(card.id) && !card.error)) continue;
    const cards = lane.cards.map((card) => {
      if (!stopped.has(card.id) || card.error) return card;
      let shown = stoppedCache.get(card);
      if (shown?.error !== reason) {
        shown = { ...card, error: reason, stoppedManually: true };
        stoppedCache.set(card, shown);
      }
      return shown;
    });
    out = { ...out, [id]: { ...lane, cards } };
  }
  return out;
}

/**
 * This board's own stops plus the server's earlier ones that still hold: the
 * card is known and has had no prompt since the stop (a new prompt means it
 * ran again). Returns `own` itself while nothing is added.
 */
export function restoredStops(
  own: ReadonlySet<string>,
  restored: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, TaskCard>,
): ReadonlySet<string> {
  let out: Set<string> | null = null;
  for (const [agentId, stoppedAt] of restored) {
    if (own.has(agentId)) continue;
    const card = byId.get(agentId);
    if (!card) continue;
    const prompted = card.timing.lastUserMessageAt ? Date.parse(card.timing.lastUserMessageAt) : Number.NaN;
    if (Number.isFinite(prompted) && prompted > Date.parse(stoppedAt)) continue;
    (out ??= new Set(own)).add(agentId);
  }
  return out ?? own;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `compact`: the board draws the phone layout, as the host's compact layout or a board too narrow for two lanes does. */
export function useBoard(
  props: PluginScreenProps,
  rootRef: RefObject<unknown>,
  handlers: RefObject<BoardLayoutHandlers | null>,
  compact: boolean,
): BoardController {
  const hostId = props.host.id;
  const language = useTasksLanguage();
  const strings = BOARD_STRINGS[language];
  const paseo = usePaseo();
  const hostToast = useToast();
  const [notice, setNotice] = useState<BoardNotice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissNotice = useCallback(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(null);
  }, []);
  useEffect(() => dismissNotice, [dismissNotice]);
  const toast = useMemo(() => {
    if (!compact) return hostToast;
    const post = (message: string, tone: BoardNotice["tone"]) => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      setNotice((was) => ({ id: (was?.id ?? 0) + 1, message, tone }));
      noticeTimer.current = setTimeout(() => {
        noticeTimer.current = null;
        setNotice(null);
      }, NOTICE_MS);
    };
    return { show: (message: string) => post(message, "info"), error: (message: string) => post(message, "error") };
  }, [compact, hostToast]);
  const settingsState = useSettings(TASKS_SETTINGS);
  // Until the read lands, the settings this host carried across a reconnect.
  const settings = settingsState.status === "ready" ? settingsState.values : (carriedSettings(hostId) ?? DEFAULT_TASKS_SETTINGS);

  // A width picked on the board draws at once; the record catches up when the save lands.
  const [pickedWidth, setPickedWidth] = useState<LaneWidth | null>(null);
  const savedWidth = settings.board.laneWidth;
  useEffect(() => setPickedWidth(null), [savedWidth]);
  const laneWidth = pickedWidth ?? savedWidth;
  const settingsRef = useRef(settingsState);
  settingsRef.current = settingsState;

  // Opened with params (a deep link, the sidebar, the Command Center): those;
  // else what this board showed last in this session.
  const [params, setParamsState] = useState<BoardParams>(() =>
    isEmptyParams(props.params) ? lastBoardParams(hostId) : decodeBoardParams(props.params),
  );
  const routeKey = JSON.stringify(encodeBoardParams(decodeBoardParams(props.params)));
  useEffect(() => {
    if (routeKey === "{}") return;
    const next = decodeBoardParams(JSON.parse(routeKey) as Record<string, string>);
    setParamsState((current) => (JSON.stringify(encodeBoardParams(current)) === routeKey ? current : next));
  }, [routeKey]);
  useEffect(() => rememberBoardParams(hostId, params), [hostId, params]);
  const setParams = useCallback((update: (params: BoardParams) => BoardParams) => setParamsState(update), []);

  const defaults = useMemo<BoardDefaults>(
    () => ({ hideSubtasks: settings.board.hideSubtasks, doneWindow: settings.board.doneWindow }),
    [settings.board.hideSubtasks, settings.board.doneWindow],
  );
  const { filters, doneWindow } = useMemo(() => resolveBoardParams(params, defaults), [params, defaults]);
  const options = useMemo(() => ({ doneWindow, includeDone: true }), [doneWindow]);
  // Closed, the board's data stays warm a while, so a quick reopen sends nothing.
  // After a reconnect the last cards stand in until the store is ready.
  const tasks = useCarriedTasks(hostId, options, useTasks(paseo, options, lingerBoard));
  const fields = useMemo(() => effectiveCard(settings, compact), [settings, compact]);

  const visible = useBoardVisible(rootRef, compact);
  const clock = useBoardClock(visible);
  // Whether an agent still runs or waits, for the stop's check that it took.
  const byIdRef = useRef(tasks.byId);
  byIdRef.current = tasks.byId;
  const isActive = useCallback((agentId: string) => {
    const card = byIdRef.current.get(agentId);
    return card !== undefined && (card.lane === "running" || card.lane === "needs_input");
  }, []);
  const stop = useStopControl({ confirmStop: settings.board.confirmStop, isActive, toast });
  const isReadable = useCallback((agentId: string) => byIdRef.current.get(agentId)?.readable === true, []);
  const afterRead = useCallback(() => latest.current.tasks.refreshReads(), []);
  const read = useReadControl({ isReadable, onRead: afterRead, toast });
  const reconcileRead = read.reconcile;
  // Unarchive runs through the same CLI as Stop.
  const verifyUnarchive = useCallback((agentId: string) => latest.current.tasks.refreshParent(agentId), []);
  const unarchive = useUnarchiveControl({ available: stop.available, verify: verifyUnarchive, toast });
  const { stoppedManually, noteRunning, reconcile, restored } = stop;
  const stoppedIds = useMemo(() => restoredStops(stoppedManually, restored, tasks.byId), [stoppedManually, restored, tasks.byId]);
  const filtered = useMemo(
    () => filterLanes(withStopReasons(tasks.lanes, stoppedIds, strings.stoppedManually), filters),
    [tasks.lanes, stoppedIds, strings.stoppedManually, filters],
  );
  // The order is taken when the sort or the cards change, never on a clock
  // tick, so a duration sort does not reshuffle every second.
  const sort = params.sort;
  const compareNames = useMemo(() => nameCompare(language), [language]);
  const lanes = useMemo(() => sortLaneCards(filtered, sort, Date.now(), compareNames), [filtered, sort, compareNames]);
  const total = LANE_ORDER.reduce((sum, id) => sum + lanes[id].cards.length, 0);
  // A stop whose agents have left running is done; a card stopped from the
  // board that runs again drops its "Stopped manually".
  useEffect(() => {
    reconcile();
    for (const id of stoppedManually) {
      const card = tasks.byId.get(id);
      if (card && (card.lane === "running" || card.lane === "needs_input")) noteRunning(id);
    }
  }, [tasks.byId, stoppedManually, noteRunning, reconcile]);
  // A read is done once its card has left review.
  useEffect(() => reconcileRead(), [tasks.byId, reconcileRead]);

  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlight = useCallback((agentId: string) => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlighted(agentId);
    highlightTimer.current = setTimeout(() => setHighlighted(null), MOTION.highlightMs);
  }, []);
  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  // Callbacks read the latest values through a ref, so the memoized cards see stable functions.
  const latest = useRef({ props, paseo, toast, stop, read, strings, tasks });
  latest.current = { props, paseo, toast, stop, read, strings, tasks };
  const setLaneWidth = useCallback((width: LaneWidth) => {
    const state = settingsRef.current;
    if (state.status !== "ready") return;
    setPickedWidth(width);
    const next = { ...state.values, board: { ...state.values.board, laneWidth: width } };
    void state.save(next, state.revision).then(async (saved) => {
      if (saved) return;
      // Most often a stale revision: show what the host has, and say this one did not take.
      setPickedWidth(null);
      await state.reload();
      latest.current.toast.error(latest.current.strings.laneWidth.saveFailed);
    });
  }, []);
  const toastMessage = useCallback((message: string) => latest.current.toast.show(message), []);
  const open = useCallback((agentId: string) => latest.current.props.navigation?.openAgent({ agentId }), []);
  const requestProjectIcon = useCallback((projectId: string) => latest.current.tasks.requestProjectIcon(projectId), []);
  const buttonsFor = useCallback((card: TaskCard) => buttonsIn(card, language), [language]);
  const hasNavigation = props.navigation !== undefined;
  const stopAvailable = stop.available;
  const readAvailable = read.available;
  const callbacks = useMemo<CardCallbacks>(
    () => ({
      onOpen: hasNavigation ? open : undefined,
      onReveal: (agentId) => handlers.current?.reveal(agentId),
      // No CLI on the daemon's machine (`tasks.capabilities`): no Stop on any card.
      onStop: stopAvailable ? (card, stopOptions) => latest.current.stop.press(card, stopOptions) : undefined,
      onCancelStop: (agentId) => latest.current.stop.cancel(agentId),
      // The server cannot reach the daemon itself: no Mark read either.
      onRead: readAvailable ? (card) => latest.current.read.press(card) : undefined,
      onPermission: (card, button) => {
        if (button.kind === "open") {
          open(card.id);
          return;
        }
        const requestId = card.permission?.requestId;
        if (!requestId) return;
        respondToPermission(latest.current.paseo, card.id, button, requestId).catch((error: unknown) =>
          latest.current.toast.error(latest.current.strings.answerFailed(errorText(error))),
        );
      },
      onDetails: (card) => handlers.current?.details(card),
    }),
    [hasNavigation, stopAvailable, readAvailable, open, handlers],
  );

  return {
    hostId,
    language,
    strings,
    settings,
    laneWidth,
    setLaneWidth,
    params,
    setParams,
    defaults,
    filters,
    tasks,
    paseo,
    lanes,
    total,
    fields,
    clock,
    visible,
    stop,
    read,
    unarchive,
    callbacks,
    buttonsFor,
    requestIcon: fields.projectIcon && !compact ? requestProjectIcon : undefined,
    highlighted,
    highlight,
    toastMessage,
    notice,
    dismissNotice,
  };
}

/** Where a card sits in the filtered lanes, or null when the filters hide it. */
export function findCard(lanes: Record<LaneId, LaneModel>, agentId: string): { lane: LaneId; index: number } | null {
  for (const id of LANE_ORDER) {
    const index = lanes[id].cards.findIndex((card) => card.id === agentId);
    if (index >= 0) return { lane: id, index };
  }
  return null;
}
