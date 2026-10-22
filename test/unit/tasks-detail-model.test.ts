import { describe, expect, it } from "vitest";
import { previewSampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard, TaskChild } from "../../client/tasks/model";
import {
  contextView,
  detailHero,
  detailSections,
  formatShare,
  formatSpan,
  formatTurnClock,
  timeline,
  timelineFractions,
  tokenMix,
  usageSummary,
} from "../../client/tasks/cards/detail-model";
import { sortSubtasks, subtaskHeading, subtaskMeta, subtaskModels, subtaskTime, titlePrefix } from "../../client/tasks/cards/details-format";
import { formatClockTime } from "../../client/tasks/cards/format";

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
    // The first prompt leads every state's sections when the details can read it.
    expect(detailSections(sample("sample-running"), true).order).toEqual(["prompt", "subtasks", "properties", "usage", "activity"]);
    expect(detailSections(sample("sample-failed"), true).order).toEqual(["prompt", "properties", "activity", "usage"]);
    // The latest reply follows it.
    expect(detailSections(sample("sample-failed"), true, true).order).toEqual(["prompt", "message", "properties", "activity", "usage"]);
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

  it("sorts the subtasks by what needs a person, the longest run first, the rest in their order", () => {
    const timing = sample("sample-done").timing;
    const child = (id: string, status: TaskChild["status"], startedMinutesAgo?: number): TaskChild => ({
      id,
      title: id,
      status,
      lane: status === "running" ? "running" : "done",
      timing: { ...timing, turnStartedAt: startedMinutesAgo === undefined ? null : ago(startedMinutesAgo * MINUTE) },
    });
    const children = [
      child("done-a", "done"),
      child("run-short", "running", 3),
      child("unread", "unread"),
      child("failed", "failed"),
      child("run-unstarted", "running"),
      child("done-b", "done"),
      child("run-long", "running", 14),
      child("input", "needs_input"),
    ];
    expect(sortSubtasks(children).map((item) => item.id)).toEqual(["input", "failed", "run-long", "run-short", "run-unstarted", "unread", "done-a", "done-b"]);
    // The given list is left as it was.
    expect(children[0]!.id).toBe("done-a");
  });

  it("sums the subtasks up in the heading: counts while mixed, a check when all are done, one child's word", () => {
    const of = (...statuses: TaskChild["status"][]) => statuses.map((status, index): TaskChild => ({ id: `c${index}`, title: "t", status }));
    const flat = (heading: ReturnType<typeof subtaskHeading>) => heading.parts.map((part) => (part.count !== null ? `${part.count} ${part.text}` : part.text)).join(" \u00b7 ");
    const mixed = of("needs_input", "failed", "running", "running", "unread", "done", "done", "done");
    expect(flat(subtaskHeading(mixed, "zh"))).toBe("1 待输入 · 1 失败 · 2 运行中 · 4/8 完成");
    expect(subtaskHeading(mixed, "zh").parts.map((part) => part.tone)).toEqual(["needs_input", "failed", "running", null]);
    expect(subtaskHeading(mixed, "zh").check).toBe(false);
    // Narrow: the rows' timers carry the running count.
    expect(flat(subtaskHeading(mixed, "zh", true))).toBe("1 待输入 · 1 失败 · 4/8 完成");
    expect(flat(subtaskHeading(of("running", "running", "running"), "zh"))).toBe("3 运行中");
    expect(flat(subtaskHeading(of("running", "running", "running"), "zh", true))).toBe("3 运行中");
    // Unread counts as done, as the board does.
    expect(subtaskHeading(of("done", "unread", "done", "done"), "zh")).toEqual({ parts: [{ count: null, text: "4 个全部完成", tone: null }], check: true });
    expect(flat(subtaskHeading(of("done", "done"), "en"))).toBe("All 2 done");
    expect(subtaskHeading(of("running"), "zh")).toEqual({ parts: [{ count: null, text: "运行中", tone: "running" }], check: false });
    expect(subtaskHeading(of("done"), "zh").check).toBe(true);
    expect(flat(subtaskHeading(of("needs_input", "running", "done"), "en"))).toBe("1 needs input · 1 running · 1/3 done");
  });

  it("splits a leading tag or Linear id off a subtask title", () => {
    expect(titlePrefix("[Handoff] 非 agent 项目 Node 安全修复")).toEqual({ prefix: "Handoff", rest: "非 agent 项目 Node 安全修复" });
    expect(titlePrefix("RRD-11366 cypht PHP 8.4.27")).toEqual({ prefix: "RRD-11366", rest: "cypht PHP 8.4.27" });
    expect(titlePrefix("RRD-11366: cypht")).toEqual({ prefix: "RRD-11366", rest: "cypht" });
    expect(titlePrefix("Measure the sidebar ring")).toEqual({ prefix: null, rest: "Measure the sidebar ring" });
    // A tag or id alone is the title, and a lower-case word is not an id.
    expect(titlePrefix("[Handoff]")).toEqual({ prefix: null, rest: "[Handoff]" });
    expect(titlePrefix("RRD-1")).toEqual({ prefix: null, rest: "RRD-1" });
    expect(titlePrefix("utf-8 fix")).toEqual({ prefix: null, rest: "utf-8 fix" });
  });

  it("leaves the shared model unsaid and names it once when it is not the parent's", () => {
    const parent = sample("sample-running");
    const opus = { provider: "claude", modelLabel: "Opus 5.5", thinkingLabel: "High", modeLabel: "Bypass" };
    const gpt = { provider: "codex", modelLabel: "GPT-5.5 Codex", thinkingLabel: "Medium", modeLabel: "Auto" };
    const kids = (...models: (typeof opus)[]) => models.map((model, index): TaskChild => ({ id: `c${index}`, title: "t", status: "done", ...model }));
    // The parent runs GPT-5.5 Codex · Medium · Bypass: all on Opus says so once.
    const allOpus = subtaskModels({ ...parent, children: kids(opus, opus, opus) }, "zh");
    expect(allOpus.baseline).toMatchObject({ model: "Opus 5.5", thinking: "High", mode: "Bypass" });
    expect(allOpus.footnote).toEqual({ text: "均为 Opus 5.5 · High · Bypass", provider: "claude" });
    const mostly = subtaskModels({ ...parent, children: kids(opus, gpt, opus) }, "en");
    expect(mostly.footnote).toEqual({ text: "Others on Opus 5.5 · High · Bypass", provider: "claude" });
    // The parent's own model is never repeated.
    expect(subtaskModels({ ...parent, ...opus, children: kids(opus, opus) }, "zh").footnote).toBeNull();
    // One child compares with its parent, without a footnote.
    const single = subtaskModels({ ...parent, children: kids(opus) }, "zh");
    expect(single).toEqual({ baseline: { provider: "codex", model: "GPT-5.5 Codex", thinking: "Medium", mode: "Bypass" }, footnote: null });
    // A tie goes to the first seen; children without a model leave no baseline.
    expect(subtaskModels({ ...parent, children: kids(gpt, opus) }, "zh").baseline?.model).toBe("GPT-5.5 Codex");
    expect(subtaskModels({ ...parent, children: [{ id: "x", title: "t", status: "done" }, { id: "y", title: "t", status: "done" }] }, "zh")).toEqual({ baseline: null, footnote: null });
  });

  it("writes a subtask's meta line: its model when it differs, its status, the last turn, the context", () => {
    const timing = { ...sample("sample-done").timing, lastTurnMs: 182_000 };
    const baseline = { provider: "claude", model: "Opus 5.5", thinking: "High", mode: "Bypass" };
    const base: TaskChild = { id: "c", title: "t", status: "done", provider: "claude", modelLabel: "Opus 5.5", thinkingLabel: "High", modeLabel: "Bypass", lane: "done", timing, context: { usedTokens: 290_000, maxTokens: 1_000_000 } };
    const text = (child: TaskChild, narrow = false, language: "zh" | "en" = "zh") => subtaskMeta(child, baseline, NOW, language, narrow).map((part) => part.text);
    expect(text(base)).toEqual(["上一轮 3m 2s", "上下文 29%"]);
    expect(text(base, false, "en")).toEqual(["Last turn 3m 2s", "Context 29%"]);
    expect(subtaskMeta({ ...base, status: "needs_input", lane: "needs_input" }, baseline, NOW, "zh")).toEqual([
      { text: "等待输入", tone: "warning" },
      { text: "上一轮 3m 2s", tone: null },
      { text: "上下文 29%", tone: null },
    ]);
    expect(subtaskMeta({ ...base, status: "failed", context: null }, baseline, NOW, "zh")).toEqual([
      { text: "失败", tone: "danger" },
      { text: "上一轮 3m 2s", tone: null },
    ]);
    expect(text({ ...base, status: "unread" })).toEqual(["待查看", "上一轮 3m 2s", "上下文 29%"]);
    // Running: its start, no last turn; the context goes amber from 75% and red from 90%.
    const running: TaskChild = { ...base, status: "running", lane: "running", timing: { ...timing, turnStartedAt: ago(14 * MINUTE) }, context: { usedTokens: 940_000, maxTokens: 1_000_000 } };
    expect(subtaskMeta(running, baseline, NOW, "zh")).toEqual([
      { text: `${formatClockTime(NOW - 14 * MINUTE, NOW)} 开始`, tone: null },
      { text: "上下文 94%", tone: "danger" },
    ]);
    expect(subtaskMeta({ ...base, context: { usedTokens: 780_000, maxTokens: 1_000_000 } }, baseline, NOW, "zh")[1]).toEqual({ text: "上下文 78%", tone: "warning" });
    // A different model leads; narrow, the name alone. The row's own mark names the agent, so no part carries one.
    const codex: TaskChild = { ...base, provider: "codex", modelLabel: "GPT-5.5 Codex", thinkingLabel: "Medium" };
    expect(subtaskMeta(codex, baseline, NOW, "zh")[0]).toEqual({ text: "GPT-5.5 Codex · Medium", tone: null });
    expect(subtaskMeta(codex, baseline, NOW, "zh", true)[0]).toEqual({ text: "GPT-5.5 Codex", tone: null });
    // Narrow: no start, and the context only from 75%.
    expect(text(running, true)).toEqual(["上下文 94%"]);
    expect(text(base, true)).toEqual(["上一轮 3m 2s"]);
    // Done with nothing known says nothing.
    expect(text({ id: "x", title: "t", status: "done" })).toEqual([]);
    // A provider subagent leads with the provider's own line; narrow, it goes.
    const provider: TaskChild = { id: "p", title: "t", status: "failed", kind: "provider", subtitle: "general-purpose \u00b7 Opus 5.5 \u00b7 189.7k tokens", provider: "claude", lane: "review", timing };
    expect(text(provider, false, "en")).toEqual(["general-purpose \u00b7 Opus 5.5 \u00b7 189.7k tokens", "Failed", "Last turn 3m 2s"]);
    expect(text(provider, true, "en")).toEqual(["Failed", "Last turn 3m 2s"]);
  });

  it("times a subtask row: a running timer, else when it ended", () => {
    const timing = sample("sample-done").timing;
    const running: TaskChild = { id: "r", title: "t", status: "running", lane: "running", timing: { ...timing, turnStartedAt: ago(14 * MINUTE + 14_000) } };
    expect(subtaskTime(running, NOW, "zh")).toEqual({ text: "14m 14s", live: true });
    expect(subtaskTime({ id: "d", title: "t", status: "done", lane: "done", timing: { ...timing, lastTurnEndedAt: ago(12 * MINUTE) } }, NOW, "zh")).toEqual({ text: "12 分钟前", live: false });
    // Asking for input: since the request.
    expect(subtaskTime({ id: "i", title: "t", status: "needs_input", lane: "needs_input", timing: { ...timing, attentionAt: ago(2 * MINUTE), lastTurnEndedAt: ago(9 * MINUTE) } }, NOW, "en")).toEqual({ text: "2m ago", live: false });
    // Without a recorded end, the last update, as the board card reads it.
    expect(subtaskTime({ id: "u", title: "t", status: "unread", lane: "review", timing: { ...timing, lastTurnEndedAt: null, updatedAt: ago(5 * MINUTE) } }, NOW, "zh")).toEqual({ text: "5 分钟前", live: false });
    expect(subtaskTime({ id: "x", title: "t", status: "done" }, NOW, "zh")).toBeNull();
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
