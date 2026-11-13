import { describe, expect, it, vi } from "vitest";
import { createQuestionContextStore, detailsShowNote, questionContextText } from "../../client/tasks/data/question-context";

type Row = { timestamp?: string; item: { type: string; text?: string; callId?: string; name?: string } };
const user = (text: string, timestamp?: string): Row => ({ timestamp, item: { type: "user_message", text } });
const say = (text: string, timestamp?: string): Row => ({ timestamp, item: { type: "assistant_message", text } });
const tool = (name: string, callId: string, timestamp?: string): Row => ({ timestamp, item: { type: "tool_call", name, callId } });

// The 2026-11-13 report's timeline, in the daemon's projected order: Codex
// wrote its plan, asked an async question about "the plan above", and the
// turn went on to a summary. Answering repeats the question's row.
const codexAsync: Row[] = [
  user("优化下审查发现的问题", "2026-11-13T08:50:40Z"),
  say("我按刚才发现的 Clash DNS 和 NetBird 映射问题来处理。", "2026-11-13T08:51:09Z"),
  tool("shell", "exec-1"),
  tool("shell", "exec-2"),
  say("\n\n---\n\n需要处理两项：公共 DNS 的引导路径，以及缺少的 NetBird 映射。\n\n建议按以下方案修改：\n- `clash.yaml`", "2026-11-13T08:51:57Z"),
  tool("request_user_input_async", "call_a1", "2026-11-13T08:51:59Z"),
  say("\n\n---\n\n建议修改 Clash 的公共 DNS 引导；等待方案确认。", "2026-11-13T08:52:09Z"),
  tool("request_user_input_async", "call_a1", "2026-11-13T08:59:08Z"),
];
const codex = { callId: "call_a1", name: "request_user_input_async" };

describe("question context", () => {
  it("reads the plan before a Codex async question, not the summary after it", () => {
    expect(questionContextText(codexAsync, codex)).toEqual({ state: "ready",
      text: "需要处理两项：公共 DNS 的引导路径，以及缺少的 NetBird 映射。\n\n建议按以下方案修改：\n- `clash.yaml`",
      timestamp: "2026-11-13T08:51:57Z" });
  });

  it("finds an async question by name without its call id, and gives up without its row", () => {
    // While it waits, the answered copy of its row is not there yet.
    expect(questionContextText(codexAsync.slice(0, 7), { name: "request_user_input_async" })?.text).toMatch(/^需要处理两项/);
    expect(questionContextText(codexAsync.slice(0, 5), { name: "request_user_input_async" })).toBeNull();
    // Its row fell out of the tail: the summary after it is no stand-in.
    expect(questionContextText(codexAsync.slice(6, 7), codex)).toBeNull();
  });

  it("joins the run of messages before a blocking question and stops at the work before them", () => {
    const rows = [
      user("Fix the dialog"),
      say("Looked at the reader."),
      tool("Read", "toolu_0"),
      say("Two ways to fold it:", "t1"),
      { item: { type: "reasoning", text: "weighing" } },
      say("---\n1. Six lines\n2. Four lines\n***", "t2"),
      say("."),
      tool("AskUserQuestion", "toolu_9"),
    ];
    expect(questionContextText(rows, { callId: "toolu_9", name: "AskUserQuestion" })).toEqual({ state: "ready", text: "Two ways to fold it:\n\n1. Six lines\n2. Four lines", timestamp: "t2" });
    // No row for it yet: a blocking question is the last thing its turn did.
    expect(questionContextText(rows.slice(0, -1), { callId: "toolu_9", name: "AskUserQuestion" })?.text).toMatch(/^Two ways/);
  });

  it("reads text before tools in the same turn, but not across a person's message", () => {
    expect(questionContextText([say("Plan: rename it"), tool("Bash", "a"), tool("AskUserQuestion", "q")], { callId: "q" })?.text).toBe("Plan: rename it");
    expect(questionContextText([say("Old turn"), user("Ask me"), tool("AskUserQuestion", "q")], { callId: "q" })).toBeNull();
    expect(questionContextText([say("   "), say("\n---\n"), tool("AskUserQuestion", "q")], { callId: "q" })).toBeNull();
  });

  it("reads each question once, keeps the result, and reads again on retry", async () => {
    const pages: unknown[] = [new Error("offline"), { error: null, entries: codexAsync }];
    const refetch = vi.fn(async () => {
      const next = pages.shift();
      if (next instanceof Error) throw next;
      return next;
    });
    const store = createQuestionContextStore({ agents: { ref: () => ({ timeline: { refetch } }) } } as never);
    const permission = { requestId: "permission-call_a1", ...codex };
    expect(store.read("asking", permission.requestId)).toEqual({ state: "idle" });
    store.request("asking", permission);
    expect(store.read("asking", permission.requestId)).toEqual({ state: "loading" });
    await vi.waitFor(() => expect(store.read("asking", permission.requestId)).toEqual({ state: "error" }));
    store.request("asking", permission);
    expect(refetch).toHaveBeenCalledTimes(1);
    store.request("asking", permission, true);
    await vi.waitFor(() => expect(store.read("asking", permission.requestId)).toMatchObject({ state: "ready", timestamp: "2026-11-13T08:51:57Z" }));
    expect(refetch).toHaveBeenLastCalledWith({ direction: "tail", projection: "projected", limit: 60 });
    store.request("asking", permission);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("lets the details show the note only when their latest reply is another message", () => {
    const note = { state: "ready" as const, text: "Plan", timestamp: "t1" };
    expect(detailsShowNote(note, { state: "ready", timestamp: "t1" })).toBe(false);
    expect(detailsShowNote(note, { state: "ready", timestamp: "t2" })).toBe(true);
    expect(detailsShowNote(note, { state: "none" })).toBe(true);
    expect(detailsShowNote(note, { state: "loading" })).toBe(false);
    expect(detailsShowNote({ state: "loading" }, { state: "ready", timestamp: "t2" })).toBe(false);
  });
});
