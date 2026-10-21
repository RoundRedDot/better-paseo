import { describe, expect, it } from "vitest";
import { previewSampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard } from "../../client/tasks/model";
import {
  contextView,
  detailHero,
  detailSections,
  formatShare,
  formatSpan,
  formatTurnClock,
  subtaskSegments,
  timeline,
  timelineFractions,
  tokenMix,
  usageSummary,
} from "../../client/tasks/cards/detail-model";

const NOW = Date.parse("2026-10-20T09:00:00.000Z");
const MINUTE = 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const sample = (id: string): TaskCard => previewSampleCards(NOW).find((card) => card.id === id)!;

describe("details card model", () => {
  it("leads with what each state needs first, and orders the sections after it", () => {
    expect(detailHero(sample("sample-running"))).toBe("turn");
    expect(detailHero(sample("sample-input"))).toBe("permission");
    expect(detailHero(sample("sample-failed"))).toBe("error");
    expect(detailHero(sample("sample-stopped"))).toBe("error");
    expect(detailHero(sample("sample-done"))).toBe("summary");
    expect(detailHero(sample("sample-unread"))).toBe("summary");

    expect(detailSections(sample("sample-running"))).toEqual({ order: ["subtasks", "properties", "usage", "activity"], closed: [] });
    // No children: no subtasks section.
    expect(detailSections(sample("sample-input"))).toEqual({ order: ["properties", "usage", "activity"], closed: ["usage"] });
    expect(detailSections(sample("sample-failed"))).toEqual({ order: ["properties", "activity", "usage"], closed: ["usage"] });
    expect(detailSections(sample("sample-done"))).toEqual({ order: ["properties", "usage", "activity"], closed: [] });
  });

  it("splits Codex's cached input out of its input, and leaves Claude's as reported", () => {
    // Codex: 182k input includes the 120k cached.
    expect(tokenMix(sample("sample-running"))).toEqual({
      total: 196_200,
      segments: [
        { part: "cached", tokens: 120_000, share: 120_000 / 196_200 },
        { part: "input", tokens: 62_000, share: 62_000 / 196_200 },
        { part: "output", tokens: 14_200, share: 14_200 / 196_200 },
      ],
    });
    // Claude reports cache reads apart from its input.
    expect(tokenMix(sample("sample-done"))!.total).toBe(316_200);
    const bare = { ...sample("sample-done"), usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, totalCostUsd: 2 } };
    expect(tokenMix(bare)).toBeNull();
    expect(tokenMix({ ...bare, usage: null })).toBeNull();
    expect(formatShare(0.99234)).toBe("99.2%");
    expect(formatShare(0.0004)).toBe("<0.1%");
  });

  it("grades the context at 75% and 90%", () => {
    const at = (used: number) => contextView({ ...sample("sample-done"), context: { usedTokens: used, maxTokens: 1_000_000 } })!;
    expect(at(225_312)).toMatchObject({ level: "normal", percent: "23%", text: "225k / 1.00M", exact: "225,312 / 1,000,000" });
    expect(at(750_000).level).toBe("warning");
    expect(at(900_000).level).toBe("danger");
    expect(contextView(sample("sample-done"))).toBeNull();
    expect(usageSummary(sample("sample-running"), "zh")).toBe("$1.84 · 86%");
    expect(usageSummary({ ...sample("sample-done"), usage: null }, "en")).toBe("Not reported");
  });

  it("counts the subtasks by status in the bar's order", () => {
    expect(subtaskSegments(sample("sample-running"))).toEqual([
      { status: "done", count: 1 },
      { status: "running", count: 2 },
    ]);
  });

  it("formats the turn's clock and the timeline's spans", () => {
    expect(formatTurnClock(252_000)).toBe("4:12");
    expect(formatTurnClock(3_727_000)).toBe("1:02:07");
    expect(formatSpan(30_000)).toBe("<1m");
    expect(formatSpan(24 * MINUTE)).toBe("24m");
    expect(formatSpan(125 * MINUTE)).toBe("2h 5m");
    expect(formatSpan(12 * 60 * MINUTE)).toBe("12h");
    expect(formatSpan(3 * 24 * 60 * MINUTE)).toBe("3d");
  });

  it("puts created, the last message, the turn's start and now on the running card's timeline", () => {
    const line = timeline(sample("sample-running"), NOW, "zh")!;
    expect(line.live).toBe(true);
    expect(line.points.map((point) => [point.key, point.name, point.time])).toEqual([
      ["created", "创建", "1 小时前"],
      ["message", "最后消息", "20 分钟前"],
      ["turn", "本轮开始", "12 分钟前"],
      ["now", "现在", "进行中"],
    ]);
  });

  it("drops a moment within a minute of the one before it, keeping the later", () => {
    const base = sample("sample-running");
    const card = { ...base, timing: { ...base.timing, lastUserMessageAt: ago(12 * MINUTE + 40_000), turnStartedAt: ago(12 * MINUTE + 10_000) } };
    expect(timeline(card, NOW, "en")!.points.map((point) => point.key)).toEqual(["created", "turn", "now"]);
    // A finished card ends at its update; a failed one says so in the status colour.
    expect(timeline(sample("sample-done"), NOW, "en")!.points.map((point) => point.name)).toEqual(["Created", "Last message", "Updated"]);
    expect(timeline(sample("sample-done"), NOW, "en")!.live).toBe(false);
    const failed = timeline(sample("sample-failed"), NOW, "en")!;
    expect(failed.points[failed.points.length - 1]!.name).toBe("Failed");
    expect(failed.live).toBe(true);
    // Waiting: the wait's start, then now.
    expect(timeline(sample("sample-input"), NOW, "zh")!.points.map((point) => point.name)).toEqual(["创建", "最后消息", "等待输入", "现在"]);
  });

  it("gives each span its time's share, but room enough for the labels around it", () => {
    // 30 minutes: 24, 2 and 4. The 2 and 4 minute spans are lifted to their minimum.
    const fractions = timelineFractions([24, 2, 4].map((minutes) => minutes * MINUTE), 340);
    expect(fractions.reduce((sum, fraction) => sum + fraction, 0)).toBeCloseTo(1);
    expect(fractions[1]! * 340).toBeCloseTo(68);
    expect(fractions[2]! * 340).toBeCloseTo(84);
    expect(fractions[0]!).toBeGreaterThan(fractions[2]!);
    // Too narrow for every minimum: equal spans.
    expect(timelineFractions([1, 1, 1, 1], 200)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(timelineFractions([5], 300)).toEqual([1]);
    expect(timelineFractions([], 300)).toEqual([]);
  });
});
