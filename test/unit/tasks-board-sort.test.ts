import { describe, expect, it } from "vitest";
import {
  SORT_CHOICES,
  SORT_KEYS,
  decodeSort,
  encodeSort,
  nameCompare,
  sortCards,
  sortLaneCards,
  sortsLoadedOnly,
  type BoardSort,
} from "../../client/tasks/board/sort";
import { BOARD_STRINGS, sortLabel } from "../../client/tasks/board/strings";
import { EMPTY_PARAMS, decodeBoardParams, encodeBoardParams } from "../../client/tasks/board/params";
import { clearedParams } from "../../client/tasks/board/filter-options";
import { sampleCards } from "../../client/tasks/sample-cards";
import { LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../../client/tasks/model";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const minute = 60_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const base = sampleCards(NOW)[0]!;

/** A card with only what a test sets; location fields default to missing. */
function card(id: string, over: { lane?: LaneId; title?: string; location?: Record<string, unknown>; timing?: Partial<TaskCard["timing"]>; context?: TaskCard["context"] } = {}): TaskCard {
  return {
    ...base,
    id,
    title: over.title ?? id,
    lane: over.lane ?? "running",
    location: {
      ...base.location,
      projectName: null,
      workspaceName: null,
      branch: null,
      folder: null,
      ...over.location,
    } as TaskCard["location"],
    timing: { ...base.timing, turnStartedAt: null, attentionAt: null, lastTurnMs: null, ...over.timing },
    context: over.context === undefined ? null : over.context,
  };
}

const ids = (cards: readonly TaskCard[]) => cards.map((each) => each.id);
const by = (key: BoardSort["key"], direction: BoardSort["direction"]): BoardSort => ({ key, direction });
const compare = nameCompare("en");

describe("sortCards", () => {
  it("sorts each name key both ways, case-insensitively and numerically, missing last", () => {
    const fields: Record<string, string> = { workspace: "workspaceTitle", project: "projectName", branch: "branch", folder: "folderName" };
    for (const [key, field] of Object.entries(fields)) {
      const cards = [
        card("none"),
        card("b10", { location: { [field]: "item 10" } }),
        card("B2", { location: { [field]: "Item 2" } }),
        card("a", { location: { [field]: "alpha" } }),
      ];
      expect(ids(sortCards(cards, by(key as BoardSort["key"], "asc"), NOW, compare)), key).toEqual(["a", "B2", "b10", "none"]);
      expect(ids(sortCards(cards, by(key as BoardSort["key"], "desc"), NOW, compare)), key).toEqual(["b10", "B2", "a", "none"]);
    }
  });

  it("falls back to the deduped workspace and folder until the raw fields arrive", () => {
    const cards = [card("z", { location: { workspaceName: "zeta", folder: "zeta" } }), card("a", { location: { workspaceName: "alpha", folder: "alpha" } })];
    expect(ids(sortCards(cards, by("workspace", "asc"), NOW, compare))).toEqual(["a", "z"]);
    expect(ids(sortCards(cards, by("folder", "asc"), NOW, compare))).toEqual(["a", "z"]);
  });

  it("sorts titles", () => {
    const cards = [card("1", { title: "Port the ring" }), card("2", { title: "add tests" }), card("3", { title: "Bump SDK" })];
    expect(ids(sortCards(cards, by("title", "asc"), NOW, compare))).toEqual(["2", "3", "1"]);
    expect(ids(sortCards(cards, by("title", "desc"), NOW, compare))).toEqual(["1", "3", "2"]);
  });

  it("sorts created and updated newest first (desc) or oldest first (asc)", () => {
    for (const key of ["created", "updated"] as const) {
      const field = key === "created" ? "createdAt" : "updatedAt";
      const cards = [card("mid", { timing: { [field]: iso(10 * minute) } }), card("old", { timing: { [field]: iso(60 * minute) } }), card("new", { timing: { [field]: iso(minute) } })];
      expect(ids(sortCards(cards, by(key, "desc"), NOW, compare))).toEqual(["new", "mid", "old"]);
      expect(ids(sortCards(cards, by(key, "asc"), NOW, compare))).toEqual(["old", "mid", "new"]);
    }
  });

  it("sorts context use by the used share, cards without context last", () => {
    const cards = [
      card("none"),
      card("half", { context: { usedTokens: 100, maxTokens: 200 } }),
      card("full", { context: { usedTokens: 190, maxTokens: 200 } }),
      card("zero-max", { context: { usedTokens: 10, maxTokens: 0 } }),
      card("small", { context: { usedTokens: 10, maxTokens: 1000 } }),
    ];
    expect(ids(sortCards(cards, by("context", "desc"), NOW, compare))).toEqual(["full", "half", "small", "none", "zero-max"]);
    expect(ids(sortCards(cards, by("context", "asc"), NOW, compare))).toEqual(["small", "half", "full", "none", "zero-max"]);
  });

  it("measures duration per lane: turn, wait, or the last turn", () => {
    const running = [card("r-short", { timing: { turnStartedAt: iso(minute) } }), card("r-none"), card("r-long", { timing: { turnStartedAt: iso(30 * minute) } })];
    expect(ids(sortCards(running, by("duration", "desc"), NOW, compare))).toEqual(["r-long", "r-short", "r-none"]);
    expect(ids(sortCards(running, by("duration", "asc"), NOW, compare))).toEqual(["r-short", "r-long", "r-none"]);
    const waiting = [card("w-short", { lane: "needs_input", timing: { attentionAt: iso(minute) } }), card("w-long", { lane: "needs_input", timing: { attentionAt: iso(9 * minute) } })];
    expect(ids(sortCards(waiting, by("duration", "desc"), NOW, compare))).toEqual(["w-long", "w-short"]);
    const done = [card("d-short", { lane: "done", timing: { lastTurnMs: minute } }), card("d-long", { lane: "done", timing: { lastTurnMs: 8 * minute } })];
    expect(ids(sortCards(done, by("duration", "desc"), NOW, compare))).toEqual(["d-long", "d-short"]);
  });

  it("keeps the default order for ties in both directions", () => {
    const cards = ["first", "second", "third"].map((id) => card(id, { location: { branch: "main" } }));
    expect(ids(sortCards(cards, by("branch", "asc"), NOW, compare))).toEqual(["first", "second", "third"]);
    expect(ids(sortCards(cards, by("branch", "desc"), NOW, compare))).toEqual(["first", "second", "third"]);
    const missing = ["x", "y"].map((id) => card(id));
    expect(ids(sortCards(missing, by("project", "desc"), NOW, compare))).toEqual(["x", "y"]);
  });

  it("keeps the order a moment gave it: the same input sorts the same way at that moment", () => {
    const cards = [card("a", { timing: { turnStartedAt: iso(minute) } }), card("b", { timing: { turnStartedAt: iso(2 * minute) } })];
    // Durations grow together, so a later moment gives the same order; the board takes it once per change anyway.
    expect(ids(sortCards(cards, by("duration", "desc"), NOW, compare))).toEqual(ids(sortCards(cards, by("duration", "desc"), NOW + 60 * minute, compare)));
  });
});

describe("sortLaneCards", () => {
  function lanes(): Record<LaneId, LaneModel> {
    const out = {} as Record<LaneId, LaneModel>;
    for (const id of LANE_ORDER) {
      out[id] = { id, cards: [card(`${id}-b`, { lane: id, title: "b" }), card(`${id}-a`, { lane: id, title: "a" })], hasMore: id === "done", loading: false };
    }
    return out;
  }

  it("returns the lanes untouched without a sort", () => {
    const input = lanes();
    expect(sortLaneCards(input, null, NOW)).toBe(input);
  });

  it("sorts every lane with one sort and keeps each lane's paging state", () => {
    const sorted = sortLaneCards(lanes(), by("title", "asc"), NOW);
    for (const id of LANE_ORDER) expect(ids(sorted[id].cards)).toEqual([`${id}-a`, `${id}-b`]);
    expect(sorted.done.hasMore).toBe(true);
  });
});

describe("name collation", () => {
  it("uses Intl.Collator with numeric, case-insensitive order", () => {
    const compareEn = nameCompare("en");
    expect(["item 10", "Item 2", "item 1"].sort(compareEn)).toEqual(["item 1", "Item 2", "item 10"]);
    expect(compareEn("ABC", "abc")).toBe(0);
  });

  it("orders Chinese by pinyin where the runtime has it", () => {
    const compareZh = nameCompare("zh");
    // 北 (bei) < 上 (shang) < 中 (zhong) in pinyin; code points would give 上 < 中 < 北.
    expect(["中", "上", "北"].sort(compareZh)).toEqual(["北", "上", "中"]);
  });

  it("falls back to localeCompare, then code points, without Intl.Collator", () => {
    const noCollator = nameCompare("en", {});
    expect(["b", "A", "c"].sort(noCollator)).toEqual(["A", "b", "c"]);
    const throwing = nameCompare("zh", {
      Collator: function Broken() {
        throw new RangeError("unsupported");
      } as never,
    });
    expect(["b", "A"].sort(throwing)).toEqual(["A", "b"]);
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = () => {
      throw new Error("no locale support");
    };
    try {
      expect(["b", "C", "a"].sort(nameCompare("en", undefined))).toEqual(["a", "b", "C"]);
    } finally {
      String.prototype.localeCompare = original;
    }
  });
});

describe("sort params and labels", () => {
  it("round-trips every choice through the screen params and survives Clear all", () => {
    for (const sort of SORT_CHOICES) {
      const params = { ...EMPTY_PARAMS, query: "x", sort };
      expect(decodeBoardParams(encodeBoardParams(params))).toEqual(params);
      expect(clearedParams(params).sort).toEqual(sort);
    }
    expect(encodeBoardParams({ ...EMPTY_PARAMS, sort: by("duration", "asc") })).toEqual({ sort: "duration-asc" });
    expect(decodeSort("height-asc")).toBeNull();
    expect(decodeSort("branch-up")).toBeNull();
    expect(encodeSort(null)).toBeNull();
  });

  it("offers the default plus both directions of every key", () => {
    expect(SORT_CHOICES).toHaveLength(1 + 2 * SORT_KEYS.length);
    expect(SORT_CHOICES[0]).toBeNull();
  });

  it("labels the choices in both languages", () => {
    expect(sortLabel(null, BOARD_STRINGS.zh)).toBe("默认顺序");
    expect(sortLabel(by("branch", "asc"), BOARD_STRINGS.zh)).toBe("分支 A→Z");
    expect(sortLabel(by("branch", "asc"), BOARD_STRINGS.en)).toBe("Branch A→Z");
    expect(sortLabel(by("updated", "desc"), BOARD_STRINGS.en)).toBe("Updated newest first");
    expect(sortLabel(by("context", "desc"), BOARD_STRINGS.zh)).toBe("上下文占用 高→低");
    expect(sortLabel(by("duration", "asc"), BOARD_STRINGS.en)).toBe("Duration short→long");
  });

  it("notes the done lane when the sort reaches only its loaded pages", () => {
    expect(sortsLoadedOnly(null)).toBe(false);
    expect(sortsLoadedOnly(by("updated", "asc"))).toBe(false);
    expect(sortsLoadedOnly(by("branch", "asc"))).toBe(true);
    expect(BOARD_STRINGS.zh.sortedAmong(50)).toBe("仅对已加载的 50 条排序");
    expect(BOARD_STRINGS.en.sortedAmong(50)).toBe("Sorted among the 50 loaded");
  });
});
