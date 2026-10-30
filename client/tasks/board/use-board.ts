import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { useTitleUpdateControl } from "../actions/title-update";
import { TITLE_GENERATION_SETTINGS } from "../../../shared/title-generation";
import { useToast } from "@getpaseo/plugin/client/react-native";
import type { PaseoApi } from "@getpaseo/client";
import { DEFAULT_TASKS_SETTINGS, TASKS_SETTINGS, effectiveCard, type CardSettings, type LaneWidth, type TasksSettings } from "../../../shared/tasks-settings";
import { permissionButtons, respondToPermission, useArchiveControl, useReadControl, useStopControl, useUnarchiveControl, type ArchiveControl, type PermissionButton, type ReadControl, type StopControl, type UnarchiveControl } from "../actions";
import type { CardCallbacks, TaskClock } from "../cards";
import { filterLanes, setTasksArchivedLane, useTasks, withSubagentCards, type TasksHandle } from "../data";
import { useSearchFirstPrompts, retrySearchPrompt, type SearchCoverageControl } from "../data/search-first-prompts";
import { useSearchConversations } from "../data/search-conversations";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import { LANE_ORDER, boardLaneOrder, opensInPaseo, turnRunning, type BoardFilters, type LaneId, type LaneModel, type TaskCard, type TaskPermission } from "../model";
import { useDeviceTasksPreferences } from "../device-preferences";
import { DEFAULT_CARD_TITLE_LINES, type CardTitleLineCount } from "../device-store";
import { MOTION } from "./board-style";
import { carriedSettings, useCarriedTasks } from "./carry";
import { lingerBoard } from "./prefetch";
import { cardFilterState, filterToCard } from "./filter-options";
import { encodeSort, nameCompare, sortLaneCards } from "./sort";
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
import { useTaskAvailability } from "../availability";
import { taskIssueText } from "../cards/availability-tag";
import type { TaskOperation } from "../../../shared/task-availability";

/** What both layouts share: settings, data after the filters, the clock, and the card callbacks. */
export interface BoardController {
  /** The host the board shows; the cards key project icon colours by it, as Paseo's sidebar does. */
  hostId: string;
  language: TasksLanguage;
  strings: BoardStrings;
  settings: TasksSettings;
  /** The lanes' width: this device's preference. */
  laneWidth: LaneWidth;
  /** Saves the lane width on this device only; its settings page follows it. */
  setLaneWidth(width: LaneWidth): void;
  /** The archived lane is shown: this device's preference. */
  showArchived: boolean;
  /** Saves the archived-lane preference on this device only. */
  setShowArchived(on: boolean): void;
  /** The filters and the sidebar's groups list those with no card on the board too: this device's preference. */
  showEmptyGroups: boolean;
  /** Saves the empty-groups preference on this device only. */
  setShowEmptyGroups(on: boolean): void;
  params: BoardParams;
  /**
   * What the user set that rearranges the lanes at once: the search, the
   * sort, and the archived lane's switch until its cards land. Lanes that
   * change with it take their new cards without lane motion, and the counts
   * (`RollingCount`) show their new number. The filters, the done window and
   * the subtasks switch are outside it: their cards slide, fade out and fade
   * in, and the counts roll.
   */
  scope: unknown;
  setParams(update: (params: BoardParams) => BoardParams): void;
  defaults: BoardDefaults;
  filters: BoardFilters;
  tasks: TasksHandle;
  /** The host's client, for what the details read on demand (a task's first prompt). */
  paseo: PaseoApi;
  /** The lanes after the filter bar and search. */
  lanes: Record<LaneId, LaneModel>;
  /** First messages still loading or not covered by this search. Other metadata is searched for every card. */
  searchStatus: SearchCoverageControl;
  fullConversationSearch: boolean;
  setFullConversationSearch(on: boolean): void;
  /** A card by id, a provider subagent's included (`tasks.byId` has only the agents'), filtered out or not. */
  cardById(id: string): TaskCard | undefined;
  /** Per lane, the cards the filters leave out, so the lane can say why its count is below the sidebar's. */
  hidden: Record<LaneId, number>;
  /** While subtasks are hidden: the waiting, running and review cards that leaves out, for the subtasks switch's badge. */
  hiddenSubtasks: number;
  /** The lanes the board draws, left to right: the four, and archived after done when `board.showArchived` is on. */
  laneOrder: readonly LaneId[];
  total: number;
  fields: CardSettings;
  titleLines: CardTitleLineCount;
  /** Shared by virtualised cards and their lane-motion copies. */
  expandedSubtasks: ReadonlySet<string>;
  setSubtasksExpanded(agentId: string, expanded: boolean): void;
  /** The 1 s clock for what shows the time; its identity holds across ticks. */
  clock: TaskClock;
  visible: boolean;
  stop: StopControl;
  read: ReadControl;
  /** Unarchive for an archived parent in the details. */
  unarchive: UnarchiveControl;
  /** Archive for a done task: its card, its menu and the details. */
  archive: ArchiveControl;
  callbacks: CardCallbacks;
  buttonsFor(card: TaskCard): PermissionButton[];
  /** Fetch a rendered card's project icon; undefined when the field is off. */
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
  const sharedSettings = settingsState.status === "ready" ? settingsState.values : (carriedSettings(hostId) ?? DEFAULT_TASKS_SETTINGS);
  const device = useDeviceTasksPreferences(settingsState.status === "ready" ? settingsState.values : null);
  const settings = device.settings ?? sharedSettings;
  const { laneWidth, showArchived, showEmptyGroups } = settings.board;
  const updateDevice = device.update;

  // Opened with params (a deep link, the sidebar, the Command Center): those;
  // else what this board showed last in this session.
  const [storedParams, setParamsState] = useState<BoardParams>(() =>
    isEmptyParams(props.params) ? lastBoardParams(hostId) : decodeBoardParams(props.params),
  );
  const routeKey = JSON.stringify(encodeBoardParams(decodeBoardParams(props.params)));
  useEffect(() => {
    if (routeKey === "{}") return;
    const next = decodeBoardParams(JSON.parse(routeKey) as Record<string, string>);
    // An explicit legacy deep link is a local choice, never a daemon settings write.
    if (next.hideSubtasks !== null && device.ready) void updateDevice({ hideSubtasks: next.hideSubtasks }).catch((error: unknown) => latest.current.toast.error(errorText(error)));
    setParamsState((current) => (JSON.stringify(encodeBoardParams(current)) === routeKey ? current : next));
  }, [routeKey, device.ready, updateDevice]);
  useEffect(() => rememberBoardParams(hostId, { ...storedParams, hideSubtasks: null }), [hostId, storedParams]);
  const params = useMemo(() => ({ ...storedParams, hideSubtasks: settings.board.hideSubtasks }), [storedParams, settings.board.hideSubtasks]);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const setParams = useCallback((update: (params: BoardParams) => BoardParams) => {
    const next = update(paramsRef.current);
    if (next.hideSubtasks !== null && next.hideSubtasks !== paramsRef.current.hideSubtasks) {
      void updateDevice({ hideSubtasks: next.hideSubtasks }).catch((error: unknown) => latest.current.toast.error(errorText(error)));
    }
    paramsRef.current = { ...next, hideSubtasks: next.hideSubtasks ?? paramsRef.current.hideSubtasks };
    setParamsState({ ...next, hideSubtasks: null });
  }, [updateDevice]);

  const defaults = useMemo<BoardDefaults>(
    () => ({ hideSubtasks: settings.board.hideSubtasks, doneWindow: settings.board.doneWindow }),
    [settings.board.hideSubtasks, settings.board.doneWindow],
  );
  const { filters, doneWindow } = useMemo(() => resolveBoardParams(params, defaults), [params, defaults]);
  const options = useMemo(() => ({ doneWindow, includeDone: true, includeArchived: showArchived }), [doneWindow, showArchived]);
  const laneOrder = boardLaneOrder(showArchived);
  // Closed, the board's data stays warm a while, so a quick reopen sends nothing.
  // After a reconnect the last cards stand in until the store is ready.
  const visible = useBoardVisible(rootRef, compact);
  const availability = useTaskAvailability(useCarriedTasks(hostId, options, useTasks(paseo, options, lingerBoard)), visible, hostId);
  const tasks = availability.tasks;
  useEffect(() => {
    if (tasks.error) toast.error(tasks.error);
  }, [tasks.error]);
  // A save reads the whole record back as new objects: the fields keep their identity while they hold, so a switch on the board re-renders no card.
  const cardFields = effectiveCard(settings, compact);
  const titleLines = device.values?.titleLines ?? DEFAULT_CARD_TITLE_LINES;
  const fieldsRef = useRef(cardFields);
  if (!sameFields(fieldsRef.current, cardFields)) fieldsRef.current = cardFields;
  const fields = fieldsRef.current;

  const [expandedSubtasks, setExpandedSubtasks] = useState<ReadonlySet<string>>(() => new Set());
  const setSubtasksExpanded = useCallback((agentId: string, expanded: boolean) => {
    setExpandedSubtasks((current) => {
      if (current.has(agentId) === expanded) return current;
      const next = new Set(current);
      if (expanded) next.add(agentId);
      else next.delete(agentId);
      return next;
    });
  }, []);

  const clock = useBoardClock(visible);
  // Whether an agent still runs or waits, for the stop's check that it took.
  const byIdRef = useRef(tasks.byId);
  byIdRef.current = tasks.byId;
  const isActive = useCallback((agentId: string) => {
    const card = byIdRef.current.get(agentId);
    return card !== undefined && (turnRunning(card) || card.lane === "needs_input");
  }, []);
  const stop = useStopControl({ confirmStop: settings.board.confirmStop, cardById: (id) => byIdRef.current.get(id), isActive, toast });
  const isReadable = useCallback((agentId: string) => byIdRef.current.get(agentId)?.readable === true, []);
  const afterRead = useCallback(() => latest.current.tasks.refreshReads(), []);
  const read = useReadControl({ isReadable, onRead: afterRead, toast });
  const reconcileRead = read.reconcile;
  // Unarchive runs through the same CLI as Stop.
  const verifyUnarchive = useCallback((agentId: string) => latest.current.tasks.refreshParent(agentId), []);
  const unarchive = useUnarchiveControl({ available: stop.available, verify: verifyUnarchive, toast });
  const archive = useArchiveControl({ paseo, toast });
  const titleUpdates = useTitleUpdateControl(paseo);
  // A turn that ends may start the daemon's title after the first reply: its card follows the job as after a click.
  const titleSettings = useSettings(TITLE_GENERATION_SETTINGS);
  const titleAfterFirstReply = titleSettings.status === "ready" && titleSettings.values.afterFirstReply;
  const turnsRunning = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const running = new Set<string>();
    for (const [id, card] of tasks.byId) if (turnRunning(card)) running.add(id);
    for (const id of turnsRunning.current) {
      if (running.has(id)) continue;
      // A turn's end leaves the running list a moment before it joins the next one: still running until it lands.
      if (!tasks.byId.has(id)) running.add(id);
      else if (titleAfterFirstReply) titleUpdates.attach(id);
    }
    turnsRunning.current = running;
  }, [tasks.byId, titleAfterFirstReply, titleUpdates]);
  const revealingTitles = useSyncExternalStore(titleUpdates.subscribe, titleUpdates.revealing, titleUpdates.revealing);
  const previousTitleLanes = useRef(tasks.lanes);
  const titleLanes = useMemo(() => holdRevealingTitles(previousTitleLanes.current, tasks.lanes, revealingTitles), [tasks.lanes, revealingTitles]);
  previousTitleLanes.current = titleLanes;
  const { stoppedManually, noteRunning, reconcile, restored } = stop;
  const stoppedIds = useMemo(() => restoredStops(stoppedManually, restored, tasks.byId), [stoppedManually, restored, tasks.byId]);
  // Every card the board can draw: the store's, with a card for each provider subagent.
  const unfiltered = useMemo(() => withSubagentCards(withStopReasons(titleLanes, stoppedIds, strings.stoppedManually)), [titleLanes, stoppedIds, strings.stoppedManually]);
  const [fullConversationSearch, setFullConversationSearchState] = useState(false);
  const firstPrompts = useSearchFirstPrompts(paseo, unfiltered, fullConversationSearch ? "" : filters.query);
  const conversations = useSearchConversations(paseo, unfiltered, fullConversationSearch ? filters.query : "");
  const search = fullConversationSearch ? conversations : firstPrompts;
  const filtered = useMemo(() => filterLanes(unfiltered, filters, search.messages), [unfiltered, filters, search.messages]);
  // The order is taken when the sort or the cards change, never on a clock
  // tick, so a duration sort does not reshuffle every second.
  const sort = params.sort;
  const compareNames = useMemo(() => nameCompare(language), [language]);
  const sorted = useMemo(() => sortLaneCards(filtered, sort, Date.now(), compareNames), [filtered, sort, compareNames]);
  // A lane whose cards and paging held keeps its identity, so it skips its render when another lane changes.
  const lanesRef = useRef(sorted);
  const lanes = useMemo(() => keepSameLanes(lanesRef.current, sorted), [sorted]);
  lanesRef.current = lanes;
  // Kept while no lane's count changes, so the lanes skip their render as with `keepSameLanes`.
  const hiddenRef = useRef<Record<LaneId, number> | null>(null);
  const hidden = useMemo(() => keepSameCounts(hiddenRef.current, hiddenCounts(unfiltered, filtered)), [unfiltered, filtered]);
  hiddenRef.current = hidden;
  const hiddenSubtasks = useMemo(
    () => (filters.hideSubtasks ? hiddenSubtaskCount(unfiltered, filtered, filters, search.messages) : 0),
    [unfiltered, filtered, filters, search.messages],
  );
  const total = laneOrder.reduce((sum, id) => sum + lanes[id].cards.length, 0);
  // Switching the archived lane rearranges the lanes as a filter does, twice when it turns on: at once, and when the list with archived agents lands.
  const archivedSettling = showArchived && lanes.archived.initialLoading === true && lanes.archived.cards.length === 0;
  // A filter is one press, and its cards move: a search would be slow to read if every keystroke slid them, and a new sort reorders every lane.
  const query = params.query.trim();
  const sortKey = encodeSort(params.sort);
  const scope = useMemo(() => ({ query, sortKey, showArchived, archivedSettling, fullConversationSearch }), [query, sortKey, showArchived, archivedSettling, fullConversationSearch]);
  // A stop whose agents have left running is done; a card stopped from the
  // board that runs again drops its "Stopped manually".
  useEffect(() => {
    reconcile();
    for (const id of stoppedManually) {
      const card = tasks.byId.get(id);
      if (card && (turnRunning(card) || card.lane === "needs_input")) noteRunning(id);
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
  const latest = useRef({ props, paseo, toast, stop, read, unarchive, archive, strings, tasks, lanes, availability, language, fullConversationSearch, search });
  latest.current = { props, paseo, toast, stop, read, unarchive, archive, strings, tasks, lanes, availability, language, fullConversationSearch, search };
  const setFullConversationSearch = useCallback((on: boolean) => {
    setFullConversationSearchState(on);
    latest.current.toast.show(latest.current.strings.fullConversationToast(on));
  }, []);
  const write = useCallback((agentId: string, operation: TaskOperation, action: () => void) => {
    const current = latest.current;
    void current.availability.check(agentId, operation).then((issue) => {
      if (latest.current.paseo !== current.paseo) return;
      if (issue) {
        latest.current.toast.error(taskIssueText(issue, latest.current.language));
        return;
      }
      action();
    });
  }, []);
  const setLaneWidth = useCallback((width: LaneWidth) => {
    void updateDevice({ laneWidth: width }).catch(() => latest.current.toast.error(latest.current.strings.laneWidth.saveFailed));
  }, [updateDevice]);
  const setShowArchived = useCallback((on: boolean) => {
    // `useTasks` follows the setting afterwards and finds the lane already switched.
    setTasksArchivedLane(latest.current.paseo, on);
    void updateDevice({ showArchived: on }).catch(() => {
      // The setting kept its old value, which the switch showed: the lane goes back to it.
      setTasksArchivedLane(latest.current.paseo, !on);
      latest.current.toast.error(latest.current.strings.archivedLane.saveFailed);
    });
  }, [updateDevice]);
  const setShowEmptyGroups = useCallback((on: boolean) => {
    void updateDevice({ showEmptyGroups: on }).catch(() => latest.current.toast.error(latest.current.strings.emptyGroups.saveFailed));
  }, [updateDevice]);
  // The subagents' cards by id, filtered out or not: the store's `byId` has only the agents'.
  const subagentCards = useMemo(() => {
    const out = new Map<string, TaskCard>();
    for (const id of LANE_ORDER) for (const card of unfiltered[id].cards) if (card.subagent) out.set(card.id, card);
    return out;
  }, [unfiltered]);
  const subagentCardsRef = useRef(subagentCards);
  subagentCardsRef.current = subagentCards;
  // Stable, reading the refs, so a lane's memo does not draw it again for it.
  const cardById = useCallback((id: string) => byIdRef.current.get(id) ?? subagentCardsRef.current.get(id), []);
  const toastMessage = useCallback((message: string) => latest.current.toast.show(message), []);
  const open = useCallback((id: string) => {
    // A provider subagent has no tab: its card opens its parent's, where Paseo lists it.
    const agentId = subagentCardsRef.current.get(id)?.parent?.id ?? id;
    const card = byIdRef.current.get(agentId);
    // The cards hide Open on an archived task; this catches the keyboard and anything else.
    if (card && !opensInPaseo(card)) {
      latest.current.toast.show(latest.current.strings.archivedLane.cannotOpen);
      return;
    }
    latest.current.props.navigation?.openAgent({ agentId });
  }, []);
  const requestProjectIcon = useCallback((projectId: string) => latest.current.tasks.requestProjectIcon(projectId), []);
  const buttonsFor = useCallback((card: TaskCard) => buttonsIn(card, language), [language]);
  const hasNavigation = props.navigation !== undefined;
  const stopAvailable = stop.available;
  const readAvailable = read.available;
  const unarchiveAvailable = unarchive.available;
  const callbacks = useMemo<CardCallbacks>(
    () => ({
      titleUpdates,
      onSearchPromptRetry: (card) => {
        if (latest.current.fullConversationSearch) {
          void conversations.status.retryCard(card);
          return;
        }
        void retrySearchPrompt(latest.current.paseo, card, cardById);
      },
      onOpen: hasNavigation ? open : undefined,
      onReveal: (agentId, parentId) => {
        // A provider subagent's row, while hidden subtasks or the filters leave its card off the board: its parent's tab.
        if (parentId && !findCard(latest.current.lanes, agentId)) open(parentId);
        else handlers.current?.reveal(agentId);
      },
      // No CLI on the daemon's machine (`tasks.capabilities`): no Stop on any card.
      onStop: stopAvailable ? (card, stopOptions) => latest.current.stop.press(card, stopOptions) : undefined,
      onCancelStop: (agentId) => latest.current.stop.cancel(agentId),
      // The server cannot reach the daemon itself: no Mark read either.
      onRead: readAvailable ? (card) => write(card.id, "read", () => latest.current.read.press(card)) : undefined,
      onUnarchive: unarchiveAvailable ? (agentId) => write(agentId, "unarchive", () => latest.current.unarchive.press(agentId)) : undefined,
      onArchive: (agentId) => write(agentId, "archive", () => latest.current.archive.press(agentId)),
      onPermission: (card, button) => {
        if (button.kind === "open") {
          open(card.id);
          return;
        }
        const requestId = card.permission?.requestId;
        if (!requestId) return;
        write(card.id, "permission", () => {
          void respondToPermission(latest.current.paseo, card.id, button, requestId).catch((error: unknown) =>
            latest.current.toast.error(latest.current.strings.answerFailed(errorText(error))),
          );
        });
      },
      onDetails: (card) => handlers.current?.details(card),
      onFilter: (card, by) => setParams((current) => filterToCard(current, card, latest.current.tasks.workspaces, by)),
      filterState: (card) => cardFilterState(paramsRef.current, card, latest.current.tasks.workspaces),
    }),
    [hasNavigation, stopAvailable, readAvailable, unarchiveAvailable, open, handlers, setParams, titleUpdates, write, cardById, conversations.status],
  );

  const guardedRead = useMemo(() => ({ ...read, press: (card: TaskCard) => write(card.id, "read", () => read.press(card)) }), [read, write]);
  const guardedUnarchive = useMemo(() => ({ ...unarchive, press: (agentId: string) => write(agentId, "unarchive", () => unarchive.press(agentId)) }), [unarchive, write]);
  const guardedArchive = useMemo(() => ({ ...archive, press: (agentId: string) => write(agentId, "archive", () => archive.press(agentId)) }), [archive, write]);

  const board = {
    hostId,
    language,
    strings,
    settings,
    laneWidth,
    setLaneWidth,
    showArchived,
    setShowArchived,
    showEmptyGroups,
    setShowEmptyGroups,
    params,
    scope,
    setParams,
    defaults,
    filters,
    tasks,
    paseo,
    lanes,
    searchStatus: search.status,
    fullConversationSearch,
    setFullConversationSearch,
    cardById,
    hidden,
    hiddenSubtasks,
    laneOrder,
    total,
    fields,
    titleLines,
    expandedSubtasks,
    setSubtasksExpanded,
    clock,
    visible,
    stop,
    read: guardedRead,
    unarchive: guardedUnarchive,
    archive: guardedArchive,
    callbacks,
    buttonsFor,
    requestIcon: fields.projectIcon ? requestProjectIcon : undefined,
    highlighted,
    highlight,
    toastMessage,
    notice,
    dismissNotice,
  };
  const boardRef = useRef<BoardController>(board);
  if ((Object.keys(board) as (keyof BoardController)[]).some((key) => board[key] !== boardRef.current[key])) boardRef.current = board;
  return boardRef.current;
}

/** Per lane, how many of its cards the filters leave out. */
export function hiddenCounts(all: Record<LaneId, LaneModel>, shown: Record<LaneId, LaneModel>): Record<LaneId, number> {
  const out = {} as Record<LaneId, number>;
  for (const id of LANE_ORDER) out[id] = Math.max(0, all[id].cards.length - shown[id].cards.length);
  return out;
}

/** The lanes still waiting on someone: the sidebar's counts. */
const PENDING_LANES: readonly LaneId[] = ["needs_input", "running", "review"];

/**
 * The pending cards hiding subtasks leaves out of `shown`: the same filters
 * with subtasks shown, less what shows. The gap between the sidebar's
 * numbers and the lanes' while the switch is off.
 */
export function hiddenSubtaskCount(all: Record<LaneId, LaneModel>, shown: Record<LaneId, LaneModel>, filters: BoardFilters, firstMessages?: ReadonlyMap<string, string>): number {
  const pending = {} as Record<LaneId, LaneModel>;
  for (const id of LANE_ORDER) pending[id] = PENDING_LANES.includes(id) ? all[id] : { ...all[id], cards: [] };
  const withSubtasks = filterLanes(pending, { ...filters, hideSubtasks: false }, firstMessages);
  return PENDING_LANES.reduce((sum, id) => sum + Math.max(0, withSubtasks[id].cards.length - shown[id].cards.length), 0);
}

function keepSameCounts(last: Record<LaneId, number> | null, next: Record<LaneId, number>): Record<LaneId, number> {
  return last && LANE_ORDER.every((id) => last[id] === next[id]) ? last : next;
}

/** Where a card sits in the filtered lanes, or null when the filters hide it. */
export function findCard(lanes: Record<LaneId, LaneModel>, agentId: string): { lane: LaneId; index: number } | null {
  for (const id of LANE_ORDER) {
    const index = lanes[id].cards.findIndex((card) => card.id === agentId);
    if (index >= 0) return { lane: id, index };
  }
  return null;
}

function sameFields(left: CardSettings, right: CardSettings): boolean {
  if (left === right) return true;
  const keys = Object.keys(right) as (keyof CardSettings)[];
  return keys.length === Object.keys(left).length && keys.every((key) => left[key] === right[key]);
}

/** Defer a revealing card's title update and position, leaving other updates and lane changes live. */
export function holdRevealingTitles(last: Record<LaneId, LaneModel>, next: Record<LaneId, LaneModel>, revealing: ReadonlySet<string>): Record<LaneId, LaneModel> {
  if (revealing.size === 0) return next;
  let out = next;
  for (const lane of LANE_ORDER) {
    const current = new Map(next[lane].cards.map((card) => [card.id, card]));
    const held = last[lane].cards.filter((card) => {
      const updated = current.get(card.id);
      return revealing.has(card.id) && updated !== undefined && updated.title !== card.title;
    });
    if (held.length === 0) continue;
    const ids = new Set(held.map((card) => card.id));
    const cards = next[lane].cards.filter((card) => !ids.has(card.id));
    for (const card of held) cards.splice(Math.min(last[lane].cards.indexOf(card), cards.length), 0, card);
    out = { ...out, [lane]: { ...next[lane], cards } };
  }
  return out;
}

/** `next`, with each lane that did not change taken from `last`; `last` itself when none did. */
export function keepSameLanes(last: Record<LaneId, LaneModel>, next: Record<LaneId, LaneModel>): Record<LaneId, LaneModel> {
  if (last === next) return last;
  let changed = false;
  const out = {} as Record<LaneId, LaneModel>;
  for (const id of LANE_ORDER) {
    const was = last[id];
    const now = next[id];
    const same = was.hasMore === now.hasMore && was.loading === now.loading && was.initialLoading === now.initialLoading && was.cards.length === now.cards.length && was.cards.every((card, index) => card === now.cards[index]);
    out[id] = same ? was : now;
    if (!same) changed = true;
  }
  return changed ? out : last;
}
