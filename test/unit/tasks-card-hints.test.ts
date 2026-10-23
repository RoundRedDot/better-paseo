import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => import("./helpers/rn-mock"));

import { placeHint } from "../../client/tasks/cards/card-hints";
import { startHint, timerHint } from "../../client/tasks/cards/card-time";
import { formatFullStamp } from "../../client/ui/time";
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

describe("footer time hints", () => {
  const NOW = Date.parse("2026-10-23T08:00:00.000Z");
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const timing = { attentionAt: null, turnStartedAt: null, lastTurnMs: null, updatedAt: null } as unknown as Timed["timing"];
  const stamp = (msAgo: number) => formatFullStamp(new Date(NOW - msAgo));

  it("names a finished card's last turn and its last update, with a full stamp", () => {
    const card = { lane: "done", timing: { ...timing, lastTurnMs: 120_000, updatedAt: iso(38 * 60_000) } } as Timed;
    expect(timerHint(card, NOW, "zh")).toBe(`上一轮耗时：约 2m\n最后更新：${stamp(38 * 60_000)}`);
    expect(timerHint(card, NOW, "en")).toBe(`Last turn took: ~2m\nLast updated: ${stamp(38 * 60_000)}`);
  });

  it("names when a waiting card began to wait", () => {
    const card = { lane: "needs_input", timing: { ...timing, attentionAt: iso(5 * 60_000) } } as Timed;
    expect(timerHint(card, NOW, "zh")).toBe(`开始等待输入：${stamp(5 * 60_000)}`);
  });

  it("names a running turn's length and start", () => {
    const card = { lane: "running", timing: { ...timing, turnStartedAt: iso(90_000) } } as Timed;
    expect(timerHint(card, NOW, "zh")).toBe("本轮已运行：1m 30s");
    expect(startHint(card, "zh")).toBe(`本轮开始：${stamp(90_000)}`);
    expect(startHint({ lane: "done", timing } as Timed, "zh")).toBeNull();
  });
});
