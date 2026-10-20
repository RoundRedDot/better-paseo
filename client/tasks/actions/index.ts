import type { PaseoApi } from "@getpaseo/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { tasksCapabilitiesRpc, tasksStopRpc } from "../../../shared/tasks-rpc";
import type { TaskCard, TaskPermission, TaskPermissionAction } from "../model";
import { useTasksLanguage, type TasksLanguage } from "../i18n";

/** One permission button the card draws. `open` jumps to the tab instead of answering. */
export interface PermissionButton {
  key: string;
  label: string;
  variant: "primary" | "secondary" | "danger";
  kind: "respond" | "open";
  /** The action to send for `respond`; the deny placeholder is ignored for `open`. */
  action: TaskPermissionAction | { behavior: "allow" | "deny"; id: null };
}

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
      label: action.label,
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

/** Stop's two-step state for one card: idle → confirming (3 s) → stopping → idle. */
export type StopPhase = "idle" | "confirming" | "stopping";

export interface StopControl {
  /** False until `tasks.capabilities` reports that this host has the Paseo CLI. */
  available: boolean;
  phase(agentId: string): StopPhase;
  /** First press arms confirmation (unless `board.confirmStop` is off); the second press within 3 s stops. */
  press(card: TaskCard, options?: { withChildren?: boolean }): void;
  /** Esc, pointer leave or timeout. */
  cancel(agentId: string): void;
  /** Clear the manual-stop marker when a later run starts. */
  noteRunning(agentId: string): void;
  /** Ids stopped from the board, so their card can say "Stopped manually" until the next run. */
  stoppedManually: ReadonlySet<string>;
}

const CONFIRMATION_MS = 3_000;

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 180) || "Unknown error.";
}

function stopIds(card: TaskCard, withChildren: boolean): string[] {
  const ids = [card.id];
  if (withChildren) {
    for (const child of card.children) {
      if (child.status === "running" || child.status === "needs_input") ids.push(child.id);
    }
  }
  return [...new Set(ids)];
}

/** One stop controller for the whole board. */
export function useStopControl(options: { confirmStop: boolean }): StopControl {
  const capabilitiesRpc = useRpc(tasksCapabilitiesRpc);
  const stopRpc = useRpc(tasksStopRpc);
  const toast = useToast();
  const language = useTasksLanguage();

  const [available, setAvailable] = useState(false);
  const [phases, setPhases] = useState<Record<string, StopPhase>>({});
  const [stoppedManually, setStoppedManually] = useState<ReadonlySet<string>>(() => new Set());
  const phasesRef = useRef<Record<string, StopPhase>>({});
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const stoppedRef = useRef(new Set<string>());
  const mountedRef = useRef(false);
  const capabilitiesRef = useRef(capabilitiesRpc);
  const capabilitiesPromiseRef = useRef<Promise<{ stop: boolean }> | null>(null);
  const stopRpcRef = useRef(stopRpc);
  const toastRef = useRef(toast);
  const languageRef = useRef(language);
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

  const noteRunning = useCallback((agentId: string) => {
    cancel(agentId);
    if (!stoppedRef.current.has(agentId)) return;
    const next = new Set(stoppedRef.current);
    next.delete(agentId);
    stoppedRef.current = next;
    setStoppedManually(next);
  }, [cancel]);

  const press = useCallback((card: TaskCard, stopOptions?: { withChildren?: boolean }) => {
    if (!available || !card.stoppable) return;
    const agentId = card.id;
    const currentPhase = phasesRef.current[agentId] ?? "idle";
    if (currentPhase === "stopping") return;

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

    clearTimer(agentId);
    updatePhase(agentId, "stopping");
    const agentIds = stopIds(card, stopOptions?.withChildren === true);

    void Promise.resolve().then(() => stopRpcRef.current({ agentIds })).then((result) => {
      if (!mountedRef.current) return;
      addStoppedIds(result.results.filter((item) => item.ok).map((item) => item.agentId));
      const failures = result.results.filter((item) => !item.ok);
      if (failures.length > 0) {
        const detail = failures[0]?.error ?? (languageRef.current === "zh" ? "未知错误。" : "Unknown error.");
        const message = languageRef.current === "zh"
          ? failures.length === 1 ? `停止任务失败：${detail}` : `${failures.length} 个任务停止失败：${detail}`
          : failures.length === 1 ? `Could not stop task: ${detail}` : `Could not stop ${failures.length} tasks: ${detail}`;
        toastRef.current.error(message);
      }
    }).catch((error: unknown) => {
      if (!mountedRef.current) return;
      const detail = shortError(error);
      toastRef.current.error(languageRef.current === "zh" ? `停止任务失败：${detail}` : `Could not stop task: ${detail}`);
    }).finally(() => {
      if (mountedRef.current) updatePhase(agentId, "idle");
    });
  }, [addStoppedIds, available, clearTimer, options.confirmStop, updatePhase]);

  return { available, phase, press, cancel, noteRunning, stoppedManually };
}
