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
  callbacks: BoardCardCallbacks;
  buttonsFor(card: TaskCard): PermissionButton[];
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

/** The card callbacks, plus the desktop card's hover-out (`onDetailsEnd`, added by the cards slice). */
export type BoardCardCallbacks = CardCallbacks & { onDetailsEnd?(agentId: string): void };

const NO_BUTTONS: PermissionButton[] = [];
// One array per request, so a memoized card sees the same buttons on every tick.
const buttonCache = new WeakMap<TaskPermission, PermissionButton[]>();

function buttonsFor(card: TaskCard): PermissionButton[] {
  const permission = card.permission;
  if (!permission) return NO_BUTTONS;
  let buttons = buttonCache.get(permission);
  if (!buttons) {
    buttons = permissionButtons(permission);
    buttonCache.set(permission, buttons);
  }
  return buttons;
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
  const lanes = useMemo(() => filterLanes(tasks.lanes, filters), [tasks.lanes, filters]);
  const total = LANE_ORDER.reduce((sum, id) => sum + lanes[id].cards.length, 0);
  const fields = useMemo(() => effectiveCard(settings, props.layout.compact), [settings, props.layout.compact]);

  const visible = useBoardVisible(rootRef);
  const now = useBoardClock(visible);
  const stop = useStopControl({ confirmStop: settings.board.confirmStop });

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
  const hasNavigation = props.navigation !== undefined;
  const stopAvailable = stop.available;
  const callbacks = useMemo<BoardCardCallbacks>(
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
          latest.current.toast.error(errorText(error)),
        );
      },
      onDetails: (card) => handlers.current?.details(card),
      onDetailsEnd: (agentId) => handlers.current?.detailsEnd?.(agentId),
    }),
    [hasNavigation, stopAvailable, open, handlers],
  );

  return {
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
