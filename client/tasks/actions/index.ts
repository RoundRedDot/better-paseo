import type { PaseoApi } from "@getpaseo/client";
import type { TaskCard, TaskPermission, TaskPermissionAction } from "../model";

/**
 * The card actions' public contract (slice E owns this directory).
 *
 * PLACEHOLDER: until slice E lands these do nothing useful. The board wires
 * them into the cards; the cards only draw what they are given.
 */

/** One permission button the card draws. `open` jumps to the tab instead of answering. */
export interface PermissionButton {
  key: string;
  label: string;
  variant: "primary" | "secondary" | "danger";
  kind: "respond" | "open";
  /** The action to send for `respond`; null draws plain Allow/Deny. */
  action: TaskPermissionAction | { behavior: "allow" | "deny"; id: null };
}

/** The buttons for a card's first pending request (tool/plan/mode answer here; question/other open the tab). */
export function permissionButtons(permission: TaskPermission): PermissionButton[] {
  void permission;
  return [];
}

/** Answer the card's first request. Resolves when the daemon accepted it. */
export async function respondToPermission(paseo: PaseoApi, agentId: string, button: PermissionButton, requestId: string): Promise<void> {
  void paseo;
  void agentId;
  void button;
  void requestId;
}

/** Stop's two-step state for one card: idle → confirming (3 s) → stopping → idle. */
export type StopPhase = "idle" | "confirming" | "stopping";

export interface StopControl {
  /** False when the host has no CLI (`tasks.capabilities`): hide Stop entirely. */
  available: boolean;
  phase(agentId: string): StopPhase;
  /** First press arms confirmation (unless `board.confirmStop` is off); the second press within 3 s stops. */
  press(card: TaskCard, options?: { withChildren?: boolean }): void;
  /** Esc, pointer leave or timeout. */
  cancel(agentId: string): void;
  /** Ids stopped from the board, so their card can say "Stopped manually" until the next run. */
  stoppedManually: ReadonlySet<string>;
}

/** One stop controller for the whole board. */
export function useStopControl(options: { confirmStop: boolean }): StopControl {
  void options;
  return {
    available: false,
    phase: () => "idle",
    press() {},
    cancel() {},
    stoppedManually: new Set(),
  };
}
