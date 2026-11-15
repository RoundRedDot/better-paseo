/** The board's data layer mounted on a real daemon's `PaseoApi`, as a board screen mounts it. */
import React from "react";
import TestRenderer from "react-test-renderer";
import type { PaseoApi } from "@getpaseo/client";
import { setTasksArchivedLane, useTasks, type TasksHandle } from "../../../client/tasks/data";
import type { DoneWindow } from "../../../shared/tasks-settings";

// Daemon messages land on their own schedule, not inside act(): React renders them as Paseo does.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

export interface MountedBoard {
  readonly current: TasksHandle;
  /** Record every lane this card shows from now on, render by render ("-" while it has none). */
  track(id: string): void;
  /** The lanes a tracked card went through, repeats folded: ["running", "review"]. */
  history(id: string): string[];
  /** Wait, letting daemon messages land, until `check` holds; throws its last failure after `timeoutMs`. */
  until(check: (board: TasksHandle) => void, timeoutMs?: number): Promise<void>;
  /** Page the done (and archived) lane in until nothing is left inside the window. */
  loadAllDone(timeoutMs?: number): Promise<void>;
  unmount(): Promise<void>;
}

export async function mountBoard(api: PaseoApi, options: { doneWindow?: DoneWindow; archived?: boolean } = {}): Promise<MountedBoard> {
  const doneWindow = options.doneWindow ?? "24h";
  const archived = options.archived ?? true;
  let current!: TasksHandle;
  const tracked = new Map<string, string[]>();
  function Probe() {
    current = useTasks(api, { doneWindow, includeDone: true, includeArchived: archived });
    for (const [id, lanes] of tracked) {
      const lane = current.byId.get(id)?.lane ?? "-";
      if (lanes.at(-1) !== lane) lanes.push(lane);
    }
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  if (archived) setTasksArchivedLane(api, true);
  renderer = TestRenderer.create(React.createElement(Probe));
  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await settle(0);
  const board: MountedBoard = {
    get current() {
      return current;
    },
    track(id) {
      if (!tracked.has(id)) tracked.set(id, [current.byId.get(id)?.lane ?? "-"]);
    },
    history(id) {
      return [...(tracked.get(id) ?? [])];
    },
    async until(check, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      let last: unknown;
      for (;;) {
        try {
          check(current);
          return;
        } catch (caught) {
          last = caught;
        }
        if (Date.now() > deadline) throw last;
        await settle(50);
      }
    },
    async loadAllDone(timeoutMs = 120_000) {
      const deadline = Date.now() + timeoutMs;
      await board.until((value) => {
        if (!value.ready || value.lanes.done.initialLoading) throw new Error("board not ready");
      }, timeoutMs);
      while (current.lanes.done.hasMore || current.lanes.done.loading) {
        if (Date.now() > deadline) throw new Error("done lane did not finish paging");
        if (!current.lanes.done.loading) current.loadMoreDone();
        await settle(50);
      }
    },
    async unmount() {
      renderer.unmount();
      await settle(0);
    },
  };
  return board;
}
