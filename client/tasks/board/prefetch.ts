import { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform, type ViewProps } from "react-native";
import type { PaseoApi } from "@getpaseo/client";
import { hasTasksHold, holdTasks, releaseTasksHolds } from "../data";
import { tasksEnabled } from "./enabled";

/**
 * Warming the board ahead of a click. With the board closed the store opens
 * only the counts' status subscription; a board adds the attention list, the
 * done lane, workspaces, projects, labels and model names, and waits for the
 * attention list and the workspaces before it draws cards. So the sidebar
 * entry opens the board's subscriptions as soon as the user shows intent
 * (pointer over it or focus on web, a touch on iOS and Android), and the
 * board that mounts finds them open and ready: it sends nothing.
 *
 * Nothing runs at connect or while the user leaves the entry alone, and
 * nothing while the board is off. Without a board the warm subscriptions go
 * `INTENT_GRACE_MS` after the pointer leaves (focus goes, the touch ends);
 * after the last board closes they stay `BOARD_LINGER_MS`, so closing and
 * reopening is instant.
 */
export const INTENT_GRACE_MS = 10_000;
export const BOARD_LINGER_MS = 30_000;

/** Intent began: open the board's subscriptions, or keep them open with no deadline. */
export function warmBoard(paseo: PaseoApi): void {
  if (tasksEnabled() !== true) return;
  holdTasks(paseo, "intent", null);
}

/** Intent ended without a board, or with one: let the warm subscriptions go after the grace period. */
export function coolBoard(paseo: PaseoApi): void {
  if (hasTasksHold(paseo, "intent")) holdTasks(paseo, "intent", INTENT_GRACE_MS);
}

/** A board lets go of its subscriptions: keep them a while for a quick reopen. */
export function lingerBoard(paseo: PaseoApi): void {
  if (tasksEnabled() !== true) return;
  holdTasks(paseo, "linger", BOARD_LINGER_MS);
}

/**
 * The Command Center item opens the board from outside React, where there
 * is no `PaseoApi`; the sidebar entry lends it the one it reads (this bundle
 * runs per host). Selecting the item then sends the board's requests before
 * the screen mounts.
 */
let entryApi: PaseoApi | null = null;

export function prefetchBoardFromCommand(): void {
  if (!entryApi || tasksEnabled() !== true) return;
  holdTasks(entryApi, "intent", INTENT_GRACE_MS);
}

/** The board was turned off: drop every warm hold now. */
export function releaseBoardPrefetch(): void {
  releaseTasksHolds();
}

type IntentProps = Pick<ViewProps, "onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur" | "onTouchStart" | "onTouchEnd" | "onTouchCancel">;

/**
 * Handlers for a board entry's wrapper: on web pointer enter / leave and
 * focus / blur (React's focus events bubble from the row's pressable); on
 * iOS and Android touch start / end, the press-in before the press. One
 * hold per store whatever fires, so repeated hovers open nothing twice.
 */
export function useBoardIntent(paseo: PaseoApi): IntentProps {
  const active = useRef(false);
  const latest = useRef(paseo);
  latest.current = paseo;
  const start = useCallback(() => {
    active.current = true;
    warmBoard(latest.current);
  }, []);
  const end = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    coolBoard(latest.current);
  }, []);
  useEffect(() => {
    entryApi = paseo;
    return () => {
      if (entryApi === paseo) entryApi = null;
    };
  }, [paseo]);
  // An entry that goes while the pointer is on it lets the hold run out.
  useEffect(() => end, [end]);
  return useMemo(
    () => (Platform.OS === "web"
      ? { onPointerEnter: start, onPointerLeave: end, onFocus: start, onBlur: end }
      : { onTouchStart: start, onTouchEnd: end, onTouchCancel: end }),
    [start, end],
  );
}

/** Tests only. */
export function resetBoardPrefetch(): void {
  releaseTasksHolds();
  entryApi = null;
}
