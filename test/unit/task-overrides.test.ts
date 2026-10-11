import { describe, expect, it } from "vitest";
import type { TaskItemData } from "../../shared/contracts";
import {
  NO_OVERRIDES,
  applyTaskOverrides,
  setTaskOverride,
} from "../../client/state/task-overrides";

const task = (id: string, status: TaskItemData["status"], title = id): TaskItemData => ({
  id,
  title,
  phase: "Execution",
  status,
});

describe("task overrides (D7: tasks follow later host updates)", () => {
  it("draws the host's latest list, not the first one it saw", () => {
    const first = [task("a", "pending")];
    const later = [task("a", "completed"), task("b", "in_progress")];
    expect(applyTaskOverrides(first, NO_OVERRIDES)).toEqual(first);
    // The bug: state was seeded from the first props and never re-read.
    expect(applyTaskOverrides(later, NO_OVERRIDES)).toEqual(later);
  });

  it("returns the host array itself when nothing is overridden", () => {
    const tasks = [task("a", "pending")];
    expect(applyTaskOverrides(tasks, NO_OVERRIDES)).toBe(tasks);
  });

  it("applies a tap while the host still reports the status it was made over", () => {
    const tasks = [task("a", "pending"), task("b", "pending")];
    const overrides = setTaskOverride(NO_OVERRIDES, tasks[0]!, "in_progress");
    const drawn = applyTaskOverrides(tasks, overrides);
    expect(drawn.map((t) => t.status)).toEqual(["in_progress", "pending"]);
    // A host update that leaves task a alone keeps the tap.
    const renamed = [task("a", "pending", "Renamed"), task("b", "completed")];
    expect(applyTaskOverrides(renamed, overrides).map((t) => [t.title, t.status])).toEqual([
      ["Renamed", "in_progress"],
      ["b", "completed"],
    ]);
  });

  it("lets a host status change win over a stale tap", () => {
    const tasks = [task("a", "pending")];
    const overrides = setTaskOverride(NO_OVERRIDES, tasks[0]!, "in_progress");
    const hostDone = [task("a", "completed")];
    expect(applyTaskOverrides(hostDone, overrides)[0]!.status).toBe("completed");
  });

  it("drops the override when the tap cycles back to the host status", () => {
    const host = task("a", "pending");
    const once = setTaskOverride(NO_OVERRIDES, host, "in_progress");
    const back = setTaskOverride(once, host, "pending");
    expect(back).toEqual({});
  });
});
