import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";
import { cardShape, carriedBoard, carriedSettings, carryBoard, carrySettings, forgetCarried } from "../../client/tasks/board/carry";
import type { TasksSnapshot } from "../../client/tasks/data";
import { sampleCards } from "../../client/tasks/sample-cards";

// What the board keeps on the JS global across a reconnect (`carry.ts`).

afterEach(() => forgetCarried());

const options = { doneWindow: "24h", includeDone: true } as const;

function snapshot(): TasksSnapshot {
  const cards = sampleCards(0);
  const lane = (id: "needs_input" | "running" | "review" | "done" | "archived") => ({ id, cards: cards.filter((card) => card.lane === id), hasMore: false, loading: false });
  return {
    lanes: { needs_input: lane("needs_input"), running: lane("running"), review: lane("review"), done: lane("done"), archived: lane("archived") },
    counts: { needsInput: 0, running: 0, review: 0, done: 0, archived: 0 },
    byId: new Map(cards.map((card) => [card.id, card])),
    workspaces: [],
    providers: [],
    labels: [],
    ready: true,
    error: null,
  };
}

describe("carried settings", () => {
  it("come back through the schema, the same object on every read", () => {
    carrySettings("h1", { ...DEFAULT_TASKS_SETTINGS, enabled: true });
    const first = carriedSettings("h1");
    expect(first?.enabled).toBe(true);
    expect(carriedSettings("h1")).toBe(first);
    expect(carriedSettings("h2")).toBeNull();
  });

  it("take the schema's fallbacks for fields an earlier version wrote otherwise", () => {
    carrySettings("h1", { enabled: "yes" } as never);
    expect(carriedSettings("h1")?.enabled).toBe(true);
    carrySettings("h1", "on" as never);
    expect(carriedSettings("h1")).toBeNull();
  });
});

describe("carried board", () => {
  it("keeps the data only, for the options it was drawn with", () => {
    const tasks = { ...snapshot(), loadMoreDone: vi.fn() };
    carryBoard("h1", options, tasks);
    const kept = carriedBoard("h1", options);
    expect(kept?.lanes).toBe(tasks.lanes);
    expect(kept).not.toHaveProperty("loadMoreDone");
    expect(kept).not.toHaveProperty("ready");
    expect(carriedBoard("h1", { ...options, doneWindow: "7d" })).toBeNull();
    expect(carriedBoard("h2", options)).toBeNull();
  });

  it("is dropped when another bundle's cards were shaped otherwise", () => {
    carryBoard("h1", options, snapshot());
    const carry = (globalThis as Record<string, unknown>).__betterPaseoTasksCarry as Map<string, { board: { shape: string } }>;
    carry.get("h1")!.board.shape = cardShape().replace("timing.", "timing2.");
    expect(carriedBoard("h1", options)).toBeNull();
  });

  it("names every field the sample cards fill, nested ones included", () => {
    const shape = cardShape().split(",");
    expect(shape).toContain("timing.turnStartedAt");
    expect(shape).toContain("labels[].name");
    expect(shape).toContain("location.git.ahead");
  });
});
