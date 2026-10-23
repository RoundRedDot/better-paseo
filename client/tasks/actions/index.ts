import type { PaseoApi } from "@getpaseo/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { tasksCapabilitiesRpc, tasksReadRpc, tasksStopRpc, tasksStoppedRpc, tasksUnarchiveRpc } from "../../../shared/tasks-rpc";
import type { TaskCard, TaskPermission, TaskPermissionAction } from "../model";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import { confirmDialog } from "../../components/confirm-dialog";

/** One permission button the card draws. `open` jumps to the tab instead of answering. */
export interface PermissionButton {
  key: string;
  label: string;
  variant: "primary" | "secondary" | "danger";
  kind: "respond" | "open";
  /** The action to send for `respond`; the deny placeholder is ignored for `open`. */
  action: TaskPermissionAction | { behavior: "allow" | "deny"; id: null };
}

/** Paseo sends a plan's buttons in English; these are the labels it uses. */
const ACTION_ZH: Record<string, string> = { Reject: "拒绝", Dismiss: "拒绝", Implement: "实施" };

/** Buttons for the first pending request. Questions and other requests open the agent tab. */
export function permissionButtons(permission: TaskPermission, language: TasksLanguage = "en"): PermissionButton[] {
  if (permission.kind === "question" || permission.kind === "other") {
    return [{
      key: "open",
      label: language === "zh" ? "去回答" : "Answer",
      variant: "primary",
      kind: "open",
      action: { behavior: "deny", id: null },
    }];
  }

  if (permission.actions.length > 0) {
    return permission.actions.map((action) => ({
      key: action.id,
      label: language === "zh" ? ACTION_ZH[action.label] ?? action.label : action.label,
      variant: action.variant ?? (action.behavior === "allow" ? "primary" : "secondary"),
      kind: "respond",
      action,
    }));
  }

  return [
    {
      key: "allow",
      label: language === "zh" ? "允许" : "Allow",
      variant: "primary",
      kind: "respond",
      action: { behavior: "allow", id: null },
    },
    {
      key: "deny",
      label: language === "zh" ? "拒绝" : "Deny",
      variant: "secondary",
      kind: "respond",
      action: { behavior: "deny", id: null },
    },
  ];
}

/** Answer the card's first request. Resolves when the daemon accepted it. */
export async function respondToPermission(
  paseo: PaseoApi,
  agentId: string,
  button: PermissionButton,
  requestId: string,
): Promise<void> {
  if (button.kind !== "respond") {
    throw new Error("This permission request must be answered in the agent tab.");
  }

  const { action } = button;
  const selectedActionId = action.id === null ? undefined : action.id;
  const response = action.behavior === "allow"
    ? selectedActionId === undefined
      ? { behavior: "allow" as const }
      : { behavior: "allow" as const, selectedActionId }
    : selectedActionId === undefined
      ? { behavior: "deny" as const, message: "Denied by user" }
      : { behavior: "deny" as const, selectedActionId, message: "Denied by user" };

  await paseo.agents.ref(agentId).respondToPermission({ requestId, response });
}

/**
 * Stop's two-step state for one card: idle → confirming (3 s) → stopping → idle.
 * On iOS and Android the confirmation is a system dialog instead, and the
 * card goes from idle straight to stopping.
 */
export type StopPhase = "idle" | "confirming" | "stopping";

export interface StopControl {
  /** False until `tasks.capabilities` reports that this host has the Paseo CLI. */
  available: boolean;
  phase(agentId: string): StopPhase;
  /**
   * First press arms confirmation (unless `board.confirmStop` is off); the second press within 3 s stops.
   * On iOS and Android the first press asks in a system dialog instead: a quick double tap would
   * land both presses inside the 3 s, and Stop is always drawn on a touch card.
   * `dialog`: ask in a dialog on web too (a context menu's Stop, which has no button to arm).
   */
  press(card: TaskCard, options?: { withChildren?: boolean; dialog?: boolean }): void;
  /** Esc, pointer leave or timeout. */
  cancel(agentId: string): void;
  /** Esc anywhere on the board: disarms every armed stop. True when one was armed. */
  cancelAll(): boolean;
  /**
   * The board's cards changed: a stop whose agents all left running and
   * needs-input is done. Called by the board with every agent update.
   */
  reconcile(): void;
  /** Clear the manual-stop marker when a later run starts. */
  noteRunning(agentId: string): void;
  /** Ids stopped from the board, so their card can say "Stopped manually" until the next run. */
  stoppedManually: ReadonlySet<string>;
  /**
   * Stops made earlier through this host's plugin server (another client,
   * before an app restart): agent id -> ISO time. The board decides which
   * still apply (`restoredStops`).
   */
  restored: ReadonlyMap<string, string>;
}

const CONFIRMATION_MS = 3_000;
/** A stop the daemon accepted must show in the agent's state within this long, or it did not take. */
export const STOP_VERIFY_MS = 10_000;
/** A stop RPC with no answer by then has failed. */
export const STOP_RPC_TIMEOUT_MS = 30_000;
/** The server waits up to 60 s for the reload; past this the unarchive has failed. */
const UNARCHIVE_RPC_TIMEOUT_MS = 75_000;

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 180) || "Unknown error.";
}

function stopIds(card: TaskCard, withChildren: boolean): string[] {
  const ids = [card.id];
  if (withChildren) {
    for (const child of card.children) {
      // A provider subagent is no Paseo agent: stopping the parent ends its turn, and the provider decides the rest.
      if (child.kind === "provider") continue;
      if (child.status === "running" || child.status === "needs_input") ids.push(child.id);
    }
  }
  return [...new Set(ids)];
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Longest task name the dialog's message carries before it is cut. */
const DIALOG_NAME_MAX = 120;

/** The system dialog's words for one stop: a fixed heading, then the task's name; `children` counts the subtasks it stops too. */
export function stopDialogText(card: TaskCard, children: number, language: TasksLanguage) {
  const trimmed = card.title.trim();
  const message = trimmed.length > DIALOG_NAME_MAX ? `${trimmed.slice(0, DIALOG_NAME_MAX - 1).trimEnd()}…` : trimmed;
  if (language === "zh") {
    return {
      title: children > 0 ? `停止任务和 ${children} 个子任务？` : "停止任务？",
      message,
      cancel: "取消",
      confirm: children > 0 ? "全部停止" : "停止",
    };
  }
  return {
    title: children > 0 ? `Stop this task and ${children} ${children === 1 ? "subtask" : "subtasks"}?` : "Stop this task?",
    message,
    cancel: "Cancel",
    confirm: children > 0 ? "Stop all" : "Stop",
  };
}

function stillRunningMessage(count: number, language: TasksLanguage): string {
  if (language === "zh") return count === 1 ? "已发送停止，但任务仍在运行" : `已发送停止，但 ${count} 个任务仍在运行`;
  return count === 1 ? "Stop was sent, but the task is still running" : `Stop was sent, but ${count} tasks are still running`;
}

/**
 * One stop controller for the whole board.
 *
 * A stop is checked twice: the RPC's answer (a failure or no answer within
 * STOP_RPC_TIMEOUT_MS is an error toast), and then the agents themselves.
 * The daemon can accept a stop for an agent that keeps running (a stale
 * "running" record with no process behind it), so the pill stays
 * "Stopping" until every stopped agent has left running and needs-input,
 * per `isActive`; one still there after STOP_VERIFY_MS gets an error toast
 * and loses its "Stopped manually" marker.
 */
export function useStopControl(options: {
  confirmStop: boolean;
  isActive?: (agentId: string) => boolean;
  /** Where the failures are said; the host's toast unless given (the phone board says them at its bottom). */
  toast?: Pick<ReturnType<typeof useToast>, "error">;
}): StopControl {
  const capabilitiesRpc = useRpc(tasksCapabilitiesRpc);
  const stopRpc = useRpc(tasksStopRpc);
  const stoppedRpc = useRpc(tasksStoppedRpc);
  const hostToast = useToast();
  const toast = options.toast ?? hostToast;
  const language = useTasksLanguage();

  const [available, setAvailable] = useState(false);
  const [phases, setPhases] = useState<Record<string, StopPhase>>({});
  const [stoppedManually, setStoppedManually] = useState<ReadonlySet<string>>(() => new Set());
  const [restored, setRestored] = useState<ReadonlyMap<string, string>>(() => new Map());
  const stoppedRpcRef = useRef(stoppedRpc);
  stoppedRpcRef.current = stoppedRpc;
  const phasesRef = useRef<Record<string, StopPhase>>({});
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const stoppedRef = useRef(new Set<string>());
  const mountedRef = useRef(false);
  const capabilitiesRef = useRef(capabilitiesRpc);
  const capabilitiesPromiseRef = useRef<Promise<{ stop: boolean }> | null>(null);
  const stopRpcRef = useRef(stopRpc);
  const toastRef = useRef(toast);
  const languageRef = useRef(language);
  const isActiveRef = useRef(options.isActive);
  isActiveRef.current = options.isActive;
  /** A system stop dialog is open: presses until it closes are ignored. */
  const askingRef = useRef(false);
  /** Stops the daemon accepted, by the pressed card, until their agents settle. */
  const verifyingRef = useRef(new Map<string, { ids: string[]; timer: ReturnType<typeof setTimeout> }>());
  capabilitiesRef.current = capabilitiesRpc;
  stopRpcRef.current = stopRpc;
  toastRef.current = toast;
  languageRef.current = language;

  const updatePhase = useCallback((agentId: string, phase: StopPhase) => {
    const next = { ...phasesRef.current };
    if (phase === "idle") delete next[agentId];
    else next[agentId] = phase;
    phasesRef.current = next;
    setPhases(next);
  }, []);

  const clearTimer = useCallback((agentId: string) => {
    const timer = timersRef.current.get(agentId);
    if (timer !== undefined) clearTimeout(timer);
    timersRef.current.delete(agentId);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      for (const entry of verifyingRef.current.values()) clearTimeout(entry.timer);
      verifyingRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!capabilitiesPromiseRef.current) {
      capabilitiesPromiseRef.current = Promise.resolve().then(() => capabilitiesRef.current({}));
    }
    void capabilitiesPromiseRef.current.then(
      (result) => {
        if (active) setAvailable(result.stop);
      },
      () => {
        if (active) setAvailable(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  // The server's record of earlier stops, once per board. A server without
  // the RPC (an older plugin) or a failed read leaves only this board's own.
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => stoppedRpcRef.current({}))
      .then((result) => {
        const stops = Array.isArray(result?.stops) ? result.stops : [];
        if (!active || stops.length === 0) return;
        setRestored(new Map(stops.filter((stop) => typeof stop?.agentId === "string" && typeof stop.stoppedAt === "string").map((stop) => [stop.agentId, stop.stoppedAt])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const addStoppedIds = useCallback((agentIds: string[]) => {
    if (agentIds.length === 0) return;
    const next = new Set(stoppedRef.current);
    for (const agentId of agentIds) next.add(agentId);
    stoppedRef.current = next;
    setStoppedManually(next);
  }, []);

  const phase = useCallback((agentId: string): StopPhase => phases[agentId] ?? "idle", [phases]);

  const cancel = useCallback((agentId: string) => {
    clearTimer(agentId);
    if (phasesRef.current[agentId] === "confirming") updatePhase(agentId, "idle");
  }, [clearTimer, updatePhase]);

  const cancelAll = useCallback((): boolean => {
    const armed = Object.keys(phasesRef.current).filter((agentId) => phasesRef.current[agentId] === "confirming");
    for (const agentId of armed) cancel(agentId);
    return armed.length > 0;
  }, [cancel]);

  const verifying = (agentId: string) => [...verifyingRef.current.values()].some((entry) => entry.ids.includes(agentId));

  const noteRunning = useCallback((agentId: string) => {
    // Still running right after the stop: that is the check's to judge.
    if (verifying(agentId)) return;
    cancel(agentId);
    if (!stoppedRef.current.has(agentId)) return;
    const next = new Set(stoppedRef.current);
    next.delete(agentId);
    stoppedRef.current = next;
    setStoppedManually(next);
  }, [cancel]);

  const activeOf = (ids: readonly string[]) => ids.filter((agentId) => isActiveRef.current?.(agentId) === true);

  /** Ends the check of one press: agents still active did not stop. */
  const settle = useCallback((pressed: string) => {
    const entry = verifyingRef.current.get(pressed);
    if (!entry) return;
    clearTimeout(entry.timer);
    verifyingRef.current.delete(pressed);
    if (!mountedRef.current) return;
    const stuck = activeOf(entry.ids);
    if (stuck.length > 0) {
      const next = new Set(stoppedRef.current);
      for (const agentId of stuck) next.delete(agentId);
      stoppedRef.current = next;
      setStoppedManually(next);
      toastRef.current.error(stillRunningMessage(stuck.length, languageRef.current));
    }
    updatePhase(pressed, "idle");
  }, [updatePhase]);

  const reconcile = useCallback(() => {
    for (const [pressed, entry] of [...verifyingRef.current]) {
      if (activeOf(entry.ids).length === 0) settle(pressed);
    }
  }, [settle]);

  /** Sends the stop and checks it took. */
  const run = useCallback((card: TaskCard, withChildren: boolean) => {
    const agentId = card.id;
    if ((phasesRef.current[agentId] ?? "idle") === "stopping") return;
    clearTimer(agentId);
    updatePhase(agentId, "stopping");
    const agentIds = stopIds(card, withChildren);

    const timeoutMessage = languageRef.current === "zh" ? "停止请求没有响应。" : "The stop request did not answer.";
    void withTimeout(Promise.resolve().then(() => stopRpcRef.current({ agentIds })), STOP_RPC_TIMEOUT_MS, timeoutMessage).then((result) => {
      if (!mountedRef.current) return;
      const accepted = result.results.filter((item) => item.ok).map((item) => item.agentId);
      addStoppedIds(accepted);
      const failures = result.results.filter((item) => !item.ok);
      if (failures.length > 0) {
        const detail = failures[0]?.error ?? (languageRef.current === "zh" ? "未知错误。" : "Unknown error.");
        const message = languageRef.current === "zh"
          ? failures.length === 1 ? `停止任务失败：${detail}` : `${failures.length} 个任务停止失败：${detail}`
          : failures.length === 1 ? `Could not stop task: ${detail}` : `Could not stop ${failures.length} tasks: ${detail}`;
        toastRef.current.error(message);
      }
      if (activeOf(accepted).length === 0) {
        updatePhase(agentId, "idle");
        return;
      }
      // Accepted, but the agents still show as running: wait for them.
      const timer = setTimeout(() => settle(agentId), STOP_VERIFY_MS);
      verifyingRef.current.set(agentId, { ids: accepted, timer });
    }).catch((error: unknown) => {
      if (!mountedRef.current) return;
      const detail = shortError(error);
      toastRef.current.error(languageRef.current === "zh" ? `停止任务失败：${detail}` : `Could not stop task: ${detail}`);
      updatePhase(agentId, "idle");
    });
  }, [addStoppedIds, clearTimer, settle, updatePhase]);

  const press = useCallback((card: TaskCard, stopOptions?: { withChildren?: boolean; dialog?: boolean }) => {
    if (!available || !card.stoppable) return;
    const agentId = card.id;
    const currentPhase = phasesRef.current[agentId] ?? "idle";
    if (currentPhase === "stopping" || askingRef.current) return;
    const withChildren = stopOptions?.withChildren === true;

    if (options.confirmStop && (Platform.OS !== "web" || stopOptions?.dialog === true)) {
      askingRef.current = true;
      const close = () => {
        askingRef.current = false;
      };
      const text = stopDialogText(card, stopIds(card, withChildren).length - 1, languageRef.current);
      if (Platform.OS === "web") {
        // Electron's native dialog, else the browser's confirm: as Paseo asks before it archives.
        void confirmDialog({ title: text.title, message: text.message, confirmLabel: text.confirm, cancelLabel: text.cancel, destructive: true })
          .catch(() => false)
          .then((yes) => {
            close();
            if (yes && mountedRef.current) run(card, withChildren);
          });
        return;
      }
      Alert.alert(text.title, text.message, [
        { text: text.cancel, style: "cancel", onPress: close },
        { text: text.confirm, style: "destructive", onPress: () => {
          close();
          if (mountedRef.current) run(card, withChildren);
        } },
      ], { cancelable: true, onDismiss: close });
      return;
    }

    if (options.confirmStop && currentPhase !== "confirming") {
      clearTimer(agentId);
      updatePhase(agentId, "confirming");
      const timer = setTimeout(() => {
        timersRef.current.delete(agentId);
        if (phasesRef.current[agentId] === "confirming") updatePhase(agentId, "idle");
      }, CONFIRMATION_MS);
      timersRef.current.set(agentId, timer);
      return;
    }

    run(card, withChildren);
  }, [available, clearTimer, options.confirmStop, run, updatePhase]);

  // One object until something in it changes: the lanes' lists take it as `extraData`.
  return useMemo(
    () => ({ available, phase, press, cancel, cancelAll, reconcile, noteRunning, stoppedManually, restored }),
    [available, phase, press, cancel, cancelAll, reconcile, noteRunning, stoppedManually, restored],
  );
}

/** Mark read for an unread or failed card, in Stop's place. */
export interface ReadControl {
  /** False until `tasks.capabilities` reports that the server reaches this host's daemon. */
  available: boolean;
  /** The request is out, or the daemon took it and the card has not left review yet. */
  pending(agentId: string): boolean;
  press(card: TaskCard): void;
  /** The board's cards changed: a mark whose card left review is done. */
  reconcile(): void;
}

/** A read the daemon accepted must take the card out of review within this long, or it did not take. */
export const READ_VERIFY_MS = 10_000;
/** The server gives the daemon 10 s; past this the request has failed. */
const READ_RPC_TIMEOUT_MS = 15_000;

/**
 * One mark-read controller for the whole board. Like a stop, a read is
 * checked twice: the RPC's answer, then the card, which must leave review
 * (per `isReadable`) within READ_VERIFY_MS. Either failure is an error toast.
 */
export function useReadControl(options: {
  isReadable?: (agentId: string) => boolean;
  /** The server took the read: the board reads its marks again, so a failed card moves too. */
  onRead?: (agentId: string) => void;
  toast?: Pick<ReturnType<typeof useToast>, "error">;
}): ReadControl {
  const capabilitiesRpc = useRpc(tasksCapabilitiesRpc);
  const readRpc = useRpc(tasksReadRpc);
  const hostToast = useToast();
  const toast = options.toast ?? hostToast;
  const language = useTasksLanguage();

  const [available, setAvailable] = useState(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef<ReadonlySet<string>>(pendingIds);
  /** Reads the daemon accepted, until their card leaves review. */
  const verifyingRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mountedRef = useRef(false);
  const latest = useRef({ capabilitiesRpc, readRpc, toast, language, isReadable: options.isReadable, onRead: options.onRead });
  latest.current = { capabilitiesRpc, readRpc, toast, language, isReadable: options.isReadable, onRead: options.onRead };

  const setPending = useCallback((agentId: string, pending: boolean) => {
    if (pendingRef.current.has(agentId) === pending) return;
    const next = new Set(pendingRef.current);
    if (pending) next.add(agentId);
    else next.delete(agentId);
    pendingRef.current = next;
    setPendingIds(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const verifying = verifyingRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of verifying.values()) clearTimeout(timer);
      verifying.clear();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => latest.current.capabilitiesRpc({}))
      .then(
        (result) => {
          if (active) setAvailable(result.read === true);
        },
        () => {
          if (active) setAvailable(false);
        },
      );
    return () => {
      active = false;
    };
  }, []);

  const failed = useCallback((detail: string) => {
    const zh = latest.current.language === "zh";
    latest.current.toast.error(zh ? `标为已读失败：${detail}` : `Could not mark as read: ${detail}`);
  }, []);

  const settle = useCallback((agentId: string) => {
    const timer = verifyingRef.current.get(agentId);
    if (timer === undefined) return;
    clearTimeout(timer);
    verifyingRef.current.delete(agentId);
    if (!mountedRef.current) return;
    if (latest.current.isReadable?.(agentId) === true) {
      failed(latest.current.language === "zh" ? "任务仍在待查看。" : "the task is still to review.");
    }
    setPending(agentId, false);
  }, [failed, setPending]);

  const reconcile = useCallback(() => {
    for (const agentId of [...verifyingRef.current.keys()]) {
      if (latest.current.isReadable?.(agentId) !== true) settle(agentId);
    }
  }, [settle]);

  const press = useCallback((card: TaskCard) => {
    if (!available || card.readable !== true || pendingRef.current.has(card.id)) return;
    const agentId = card.id;
    setPending(agentId, true);
    const timeoutMessage = latest.current.language === "zh" ? "请求没有响应。" : "The request did not answer.";
    void withTimeout(Promise.resolve().then(() => latest.current.readRpc({ agentIds: [agentId] })), READ_RPC_TIMEOUT_MS, timeoutMessage)
      .then((result) => {
        if (!mountedRef.current) return;
        if (!result.ok) {
          failed(result.error ?? (latest.current.language === "zh" ? "未知错误。" : "Unknown error."));
          setPending(agentId, false);
          return;
        }
        latest.current.onRead?.(agentId);
        if (latest.current.isReadable?.(agentId) !== true) {
          setPending(agentId, false);
          return;
        }
        // Accepted, but the card is still in review: wait for its update.
        verifyingRef.current.set(agentId, setTimeout(() => settle(agentId), READ_VERIFY_MS));
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        failed(shortError(error));
        setPending(agentId, false);
      });
  }, [available, failed, setPending, settle]);

  const pending = useCallback((agentId: string) => pendingIds.has(agentId), [pendingIds]);

  return useMemo(() => ({ available, pending, press, reconcile }), [available, pending, press, reconcile]);
}

/** Unarchive for an archived parent, shown in the details' parent row. */
export interface UnarchiveControl {
  /** False without the Paseo CLI on the daemon's machine, as for Stop. */
  available: boolean;
  /** The request is out; the row says so and takes no second press. */
  pending(agentId: string): boolean;
  press(agentId: string): void;
}

/**
 * One unarchive controller for the whole board. After the RPC answers, the
 * agent is read again (`verify`): that turns the parent row into a jump (or
 * an open, for a parent the done window leaves out) and catches a reload
 * that left it archived. Any failure is an error toast.
 */
export function useUnarchiveControl(options: {
  available: boolean;
  /** Read the agent again: whether it is still archived, or null when it is gone. */
  verify(agentId: string): Promise<boolean | null>;
  toast?: Pick<ReturnType<typeof useToast>, "error">;
}): UnarchiveControl {
  const unarchiveRpc = useRpc(tasksUnarchiveRpc);
  const hostToast = useToast();
  const language = useTasksLanguage();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const latest = useRef({ unarchiveRpc, verify: options.verify, toast: options.toast ?? hostToast, language });
  latest.current = { unarchiveRpc, verify: options.verify, toast: options.toast ?? hostToast, language };
  const pendingRef = useRef(new Set<string>());
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setPending = useCallback((agentId: string, on: boolean) => {
    const next = new Set(pendingRef.current);
    if (on) next.add(agentId);
    else next.delete(agentId);
    pendingRef.current = next;
    setPendingIds(next);
  }, []);

  const press = useCallback((agentId: string) => {
    if (!options.available || pendingRef.current.has(agentId)) return;
    setPending(agentId, true);
    const zh = latest.current.language === "zh";
    const fail = (detail: string) => latest.current.toast.error(zh ? `取消归档失败：${detail}` : `Could not unarchive: ${detail}`);
    const timeoutMessage = zh ? "取消归档请求没有响应。" : "The unarchive request did not answer.";
    void withTimeout(Promise.resolve().then(() => latest.current.unarchiveRpc({ agentId })), UNARCHIVE_RPC_TIMEOUT_MS, timeoutMessage)
      .then(async (result) => {
        if (!result.ok) {
          if (mountedRef.current) fail(result.error ?? (zh ? "未知错误。" : "Unknown error."));
          return;
        }
        const archived = await latest.current.verify(agentId);
        if (!mountedRef.current) return;
        if (archived === null) fail(zh ? "找不到这个任务。" : "The agent no longer exists.");
        else if (archived) fail(zh ? "任务仍是归档状态。" : "The agent is still archived.");
      })
      .catch((error: unknown) => {
        if (mountedRef.current) fail(shortError(error));
      })
      .finally(() => {
        if (mountedRef.current) setPending(agentId, false);
      });
  }, [options.available, setPending]);

  const pending = useCallback((agentId: string) => pendingIds.has(agentId), [pendingIds]);
  return useMemo(() => ({ available: options.available, pending, press }), [options.available, pending, press]);
}

/** Archive for a done task: on its card, in its menu and in the details. */
export interface ArchiveControl {
  /** The request is out; the button spins and takes no second press. */
  pending(agentId: string): boolean;
  press(agentId: string): void;
}

/** The daemon archives at once; past this the request has failed. */
const ARCHIVE_TIMEOUT_MS = 15_000;

/**
 * One archive controller for the whole board, through the host's own client
 * (`agents.ref(id).archive()`, Paseo's "Archive"). The card leaves the done
 * lane with the agent's update; a failure is an error toast.
 */
export function useArchiveControl(options: {
  paseo: PaseoApi;
  toast?: Pick<ReturnType<typeof useToast>, "error">;
}): ArchiveControl {
  const hostToast = useToast();
  const language = useTasksLanguage();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const latest = useRef({ paseo: options.paseo, toast: options.toast ?? hostToast, language });
  latest.current = { paseo: options.paseo, toast: options.toast ?? hostToast, language };
  const pendingRef = useRef(new Set<string>());
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setPending = useCallback((agentId: string, on: boolean) => {
    const next = new Set(pendingRef.current);
    if (on) next.add(agentId);
    else next.delete(agentId);
    pendingRef.current = next;
    setPendingIds(next);
  }, []);

  const press = useCallback((agentId: string) => {
    if (pendingRef.current.has(agentId)) return;
    setPending(agentId, true);
    const zh = latest.current.language === "zh";
    const timeoutMessage = zh ? "归档请求没有响应。" : "The archive request did not answer.";
    void withTimeout(Promise.resolve().then(() => latest.current.paseo.agents.ref(agentId).archive()), ARCHIVE_TIMEOUT_MS, timeoutMessage)
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        const detail = shortError(error);
        latest.current.toast.error(zh ? `归档失败：${detail}` : `Could not archive: ${detail}`);
      })
      .finally(() => {
        if (mountedRef.current) setPending(agentId, false);
      });
  }, [setPending]);

  const pending = useCallback((agentId: string) => pendingIds.has(agentId), [pendingIds]);
  return useMemo(() => ({ pending, press }), [pending, press]);
}
