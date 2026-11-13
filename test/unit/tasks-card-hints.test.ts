import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => import("./helpers/rn-mock"));

import { placeHint, placeTip } from "../../client/tasks/cards/card-hints";
import { cardWaitLength, startHint, timerHint, waitedHint, waitedLabel } from "../../client/tasks/cards/card-time";
import { formatFooterStamp, formatFullStamp } from "../../client/ui/time";
import type { Timed } from "../../client/tasks/cards/card-time";

const CARD = { width: 338, height: 200 };

describe("placeHint", () => {
  it("opens above a mark with room over it, from its left edge in the card's left half", () => {
    expect(placeHint({ left: 12, top: 120, width: 90, height: 20 }, CARD)).toEqual({ bottom: 84, left: 12, maxWidth: 320 });
  });

  it("opens below a mark at the card's top, ending at its right edge in the right half", () => {
    expect(placeHint({ left: 300, top: 12, width: 14, height: 14 }, CARD)).toEqual({ top: 30, right: 24, maxWidth: 308 });
  });

  it("keeps the card's edge margin for a mark flush with it", () => {
    expect(placeHint({ left: 0, top: 120, width: 40, height: 20 }, CARD)).toMatchObject({ left: 6, maxWidth: 326 });
    expect(placeHint({ left: 300, top: 120, width: 38, height: 20 }, CARD)).toMatchObject({ right: 6, maxWidth: 326 });
  });
});

describe("placeTip", () => {
  const BOARD = { width: 1600, height: 900 };

  it("opens below a toolbar control whatever room is over it, lined up with its nearer edge", () => {
    expect(placeTip({ left: 16, top: 60, width: 80, height: 28 }, BOARD)).toEqual({ top: 92, left: 16, maxWidth: 1578 });
    expect(placeTip({ left: 1540, top: 10, width: 28, height: 28 }, BOARD)).toEqual({ top: 42, right: 32, maxWidth: 1562 });
  });

  it("opens above a sidebar action near the board's bottom, outside the scroller", () => {
    expect(placeTip({ left: 1540, top: 860, width: 24, height: 24 }, BOARD)).toEqual({ bottom: 44, right: 36, maxWidth: 1558 });
  });
});

describe("footer time hints", () => {
  const NOW = Date.parse("2026-10-23T08:00:00.000Z");
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const timing = { attentionAt: null, turnStartedAt: null, lastTurnMs: null, updatedAt: null } as unknown as Timed["timing"];
  const stamp = (msAgo: number) => formatFullStamp(new Date(NOW - msAgo));

  it("names a finished card's last turn and its last update, with a full stamp", () => {
    const card = { lane: "done", timing: { ...timing, lastTurnMs: 120_000, updatedAt: iso(38 * 60_000) } } as Timed;
    expect(timerHint(card, NOW, "zh")).toBe(`上一轮耗时：2m\n最后更新：${stamp(38 * 60_000)}`);
    expect(timerHint(card, NOW, "en")).toBe(`Last turn took: ~2m\nLast updated: ${stamp(38 * 60_000)}`);
  });

  it("names when a waiting card began to wait", () => {
    const card = { lane: "needs_input", timing: { ...timing, attentionAt: iso(5 * 60_000) } } as Timed;
    expect(timerHint(card, NOW, "zh")).toBe(`开始等待输入：${stamp(5 * 60_000)}`);
  });

  it("gives a question divider the wait's length alone, and the hover how long it has waited", () => {
    const card = { lane: "needs_input", timing: { ...timing, attentionAt: iso(21 * 60_000 + 30_000) } } as Timed;
    expect(cardWaitLength(card, NOW)).toBe("21m");
    // The start in the cards' stamp: no date today.
    const today = formatFooterStamp(new Date(NOW - (21 * 60_000 + 30_000)), new Date(NOW));
    expect(today).toMatch(/^\d\d:\d\d$/);
    expect(waitedHint(card, NOW, "zh")).toBe(`开始等待：${today}\n已等待 21m`);
    expect(waitedHint(card, NOW, "en")).toBe(`Waiting since: ${today}\nWaiting for 21m`);
    expect(waitedLabel(card, NOW, "zh")).toBe("已等待 21m");
    // Another day this year: the date without the year; another year: with it.
    const days = { lane: "needs_input", timing: { ...timing, attentionAt: iso(3 * 86_400_000) } } as Timed;
    expect(waitedHint(days, NOW, "zh")!.split("\n")[0]).toMatch(/^开始等待：\d\d-\d\d \d\d:\d\d$/);
    const lastYear = { lane: "needs_input", timing: { ...timing, attentionAt: "2025-12-30T10:00:00.000Z" } } as Timed;
    expect(waitedHint(lastYear, NOW, "zh")!.split("\n")[0]).toMatch(/^开始等待：2025-12-\d\d \d\d:\d\d$/);
    // Without the attention time the turn's start counts.
    const turnOnly = { lane: "needs_input", timing: { ...timing, turnStartedAt: iso(5 * 60_000) } } as Timed;
    expect(waitedHint(turnOnly, NOW, "zh")!.split("\n")[1]).toBe("已等待 5m");
    const running = { lane: "running", timing: { ...timing, turnStartedAt: iso(90_000) } } as Timed;
    expect(cardWaitLength(running, NOW)).toBe("");
    expect(waitedHint(running, NOW, "zh")).toBeNull();
    expect(waitedLabel(running, NOW, "zh")).toBeNull();
  });

  it("names a running turn's length and start", () => {
    const card = { lane: "running", timing: { ...timing, turnStartedAt: iso(90_000) } } as Timed;
    expect(timerHint(card, NOW, "zh")).toBe("本轮已运行：1m 30s");
    expect(startHint(card, "zh")).toBe(`本轮开始：${stamp(90_000)}`);
    expect(startHint({ lane: "done", timing } as Timed, "zh")).toBeNull();
  });

  it("names how long a card's subtasks have worked, and when they started", () => {
    const children = [{ status: "running", timing: { ...timing, turnStartedAt: iso(90_000) } }] as Timed["children"];
    const card = { lane: "running", waitingOnSubtasks: true, timing: { ...timing, lastTurnMs: 120_000 }, children } as Timed;
    expect(timerHint(card, NOW, "zh")).toBe("子任务已运行：1m 30s");
    expect(startHint(card, "zh")).toBe(`子任务开始：${stamp(90_000)}`);
    expect(startHint(card, "en")).toBe(`Subtasks started: ${stamp(90_000)}`);
  });
});
