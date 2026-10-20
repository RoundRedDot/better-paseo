import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { DEFAULT_TASKS_SETTINGS, TASKS_SETTINGS, effectiveCard, type CardSettings, type TasksSettings } from "../../../shared/tasks-settings";
import { permissionButtons, respondToPermission, useStopControl, type PermissionButton, type StopControl } from "../actions";
import type { CardCallbacks } from "../cards";
import { filterLanes, useTasks, type TasksHandle } from "../data";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import { LANE_ORDER, type BoardFilters, type LaneId, type LaneModel, type TaskCard, type TaskPermission } from "../model";
import { MOTION } from "./board-style";
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
  params: BoardParams;
  setParams(update: (params: BoardParams) => BoardParams): void;
  defaults: BoardDefaults;
  filters: BoardFilters;
  tasks: TasksHandle;
  /** The lanes after the filter bar and search. */
  lanes: Record<LaneId, LaneModel>;
  total: number;
  fields: CardSettings;
  now: number;
  visible: boolean;
  stop: StopControl;
  callbacks: CardCallbacks;
  buttonsFor(card: TaskCard): PermissionButton[];
  /** Fetch a rendered card's project icon; undefined when cards draw no project image (phone, or the field is off). */
  requestIcon: ((projectId: string) => void) | undefined;
  highlighted: string | null;
  highlight(agentId: string): void;
  toastMessage(message: string): void;
}

/** The layout's own answers to a parent link and a details request. */
export interface BoardLayoutHandlers {
  reveal(agentId: string): void;
  details(card: TaskCard): void;
  detailsEnd?(agentId: string): void;
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
        shown = { ...card, error: reason };
        stoppedCache.set(card, shown);
      }
      return shown;
    });
    out = { ...out, [id]: { ...lane, cards } };
  }
  return out;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useBoard(props: PluginScreenProps, rootRef: RefObject<unknown>, handlers: RefObject<BoardLayoutHandlers | null>): BoardController {
  const hostId = props.host.id;
  const language = useTasksLanguage();
  const strings = BOARD_STRINGS[language];
  const paseo = usePaseo();
  const toast = useToast();
  const settingsState = useSettings(TASKS_SETTINGS);
  const settings = settingsState.status === "ready" ? settingsState.values : DEFAULT_TASKS_SETTINGS;

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
  const tasks = useTasks(paseo, options);
  const fields = useMemo(() => effectiveCard(settings, props.layout.compact), [settings, props.layout.compact]);

  const visible = useBoardVisible(rootRef);
  const now = useBoardClock(visible);
  const stop = useStopControl({ confirmStop: settings.board.confirmStop });
  const { stoppedManually, noteRunning } = stop;
  const filtered = useMemo(
    () => filterLanes(withStopReasons(tasks.lanes, stoppedManually, strings.stoppedManually), filters),
    [tasks.lanes, stoppedManually, strings.stoppedManually, filters],
  );
  // The order is taken when the sort or the cards change, never on a clock
  // tick, so a duration sort does not reshuffle every second.
  const sort = params.sort;
  const compareNames = useMemo(() => nameCompare(language), [language]);
  const lanes = useMemo(() => sortLaneCards(filtered, sort, Date.now(), compareNames), [filtered, sort, compareNames]);
  const total = LANE_ORDER.reduce((sum, id) => sum + lanes[id].cards.length, 0);
  // A card stopped from the board that runs again drops its "Stopped manually".
  useEffect(() => {
    for (const id of stoppedManually) {
      const card = tasks.byId.get(id);
      if (card && (card.lane === "running" || card.lane === "needs_input")) noteRunning(id);
    }
  }, [tasks.byId, stoppedManually, noteRunning]);

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
  const latest = useRef({ props, paseo, toast, stop, strings, tasks });
  latest.current = { props, paseo, toast, stop, strings, tasks };
  const toastMessage = useCallback((message: string) => latest.current.toast.show(message), []);
  const open = useCallback((agentId: string) => latest.current.props.navigation?.openAgent({ agentId }), []);
  const requestProjectIcon = useCallback((projectId: string) => latest.current.tasks.requestProjectIcon(projectId), []);
  const buttonsFor = useCallback((card: TaskCard) => buttonsIn(card, language), [language]);
  const hasNavigation = props.navigation !== undefined;
  const stopAvailable = stop.available;
  const callbacks = useMemo<CardCallbacks>(
    () => ({
      onOpen: hasNavigation ? open : undefined,
      onReveal: (agentId) => handlers.current?.reveal(agentId),
      // No CLI on the daemon's machine (`tasks.capabilities`): no Stop on any card.
      onStop: stopAvailable ? (card, stopOptions) => latest.current.stop.press(card, stopOptions) : undefined,
      onCancelStop: (agentId) => latest.current.stop.cancel(agentId),
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
      onDetailsEnd: (agentId) => handlers.current?.detailsEnd?.(agentId),
    }),
    [hasNavigation, stopAvailable, open, handlers],
  );

  return {
    hostId,
    language,
    strings,
    settings,
    params,
    setParams,
    defaults,
    filters,
    tasks,
    lanes,
    total,
    fields,
    now,
    visible,
    stop,
    callbacks,
    buttonsFor,
    requestIcon: fields.projectIcon && !props.layout.compact ? requestProjectIcon : undefined,
    highlighted,
    highlight,
    toastMessage,
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
