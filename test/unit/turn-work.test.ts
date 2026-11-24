import { describe, expect, it, vi } from "vitest";
import type { PaseoAgentTimelineEvent, PaseoAgentTimelineHandle } from "@getpaseo/client";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { createTurnFooterStore, type WorkAnchor } from "../../client/state/turn-footers";
import { measureLineCount } from "../../client/components/turn-work-card";
import { timelineEntry as entry, timelinePage as page, type TimelineEntry } from "./helpers/turn-timeline";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useAgent: () => undefined, useWorkspace: () => undefined, useRpc: () => () => Promise.resolve(null), usePaseo: () => null }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: () => null, useToast: () => ({ show() {}, error() {} }) }));

const prompt = (seq: number, turnId?: string) => entry({ type: "user_message", text: "prompt", messageId: `m${seq}` }, seq, seq * 1000, turnId);
const reply = (seq: number, text: string, turnId?: string) => entry({ type: "assistant_message", text }, seq, seq * 1000, turnId);
const tool = (callId: string, detail: ToolCallTimelineItem["detail"], status: ToolCallTimelineItem["status"] = "completed", name = "Edit") =>
  ({ type: "tool_call", name, callId, status, error: status === "failed" ? "boom" : null, detail }) as ToolCallTimelineItem;
const edit = (callId: string, path: string, status: ToolCallTimelineItem["status"] = "completed") =>
  tool(callId, { type: "edit", filePath: path, unifiedDiff: "@@\n-a\n+b\n+c" }, status);
const shell = (callId: string, status: ToolCallTimelineItem["status"], output = "", exitCode?: number) =>
  tool(callId, { type: "shell", command: "npm test", output, ...(exitCode === undefined ? {} : { exitCode }) }, status, "Bash");
const at = (item: TimelineEntry["item"], seq: number, turnId?: string) => entry(item, seq, seq * 1000, turnId);

const ownsAll = () => true;
const replyAnchor = (seq: number, text: string): WorkAnchor => ({ kind: "reply", at: seq * 1000, text });
const liveAnchor: WorkAnchor = { kind: "live" };

function setup(entries: TimelineEntry[]) {
  let handler: Parameters<PaseoAgentTimelineHandle["subscribe"]>[0] | null = null;
  const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
  const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>().mockImplementation(async () => page(entries));
  const subscribe = vi.fn<PaseoAgentTimelineHandle["subscribe"]>().mockImplementation((next) => { handler = next; return release; });
  const store = createTurnFooterStore(() => ({ refetch, subscribe }));
  const emit = (event: PaseoAgentTimelineEvent["event"]) => handler?.({ agentId: "a", event } as PaseoAgentTimelineEvent);
  const live = (item: ToolCallTimelineItem) => emit({ type: "timeline", provider: "codex", item, turnId: "run" } as PaseoAgentTimelineEvent["event"]);
  return { store, refetch, subscribe, emit, live };
}

const flush = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); };

describe("turn work store", () => {
  it("draws a completed turn's folded work on its final reply", async () => {
    const { store } = setup([prompt(1, "one"), at(tool("r1", { type: "read", filePath: "a.ts" }, "completed", "Read"), 2, "one"),
      at(edit("e1", "a.ts"), 3, "one"), at(shell("c1", "completed", "ok", 0), 4, "one"), at(edit("e2", "a.ts", "failed"), 5, "one"),
      at(tool("w1", { type: "write", filePath: "b.ts", content: "x\ny\n" }, "completed", "Write"), 6, "one"), reply(7, "done", "one")]);
    const stop = store.retain(7000, "done");
    await flush();
    const work = store.work(replyAnchor(7, "done"), ownsAll)!;
    expect(work.steps.map((step) => `${step.verb}:${step.callId}`)).toEqual(["read:r1", "edit:e1", "command:c1", "write:w1"]);
    // The failed edit keeps its own row and never enters the card.
    expect(work.files).toEqual([{ path: "a.ts", callIds: ["e1"] }, { path: "b.ts", callIds: ["w1"] }]);
    // The card counts every tool call of the turn, the failed edit's row included.
    expect(work.toolCalls).toBe(5);
    expect(work.durationMs).toBe(6000);
    expect(work.complete).toBe(true);
    expect(store.work(liveAnchor, ownsAll)).toBeNull();
    // Stable while nothing changed. A different `owns` is a different card.
    expect(store.work(replyAnchor(7, "done"), ownsAll)).toBe(work);
    expect(store.work(replyAnchor(7, "done"), () => false)).toBeNull();
    stop();
  });

  it("does not draw a finished turn that has no assistant reply", async () => {
    const { store } = setup([prompt(1, "one"), at(edit("e1", "a.ts"), 2, "one"), prompt(3, "two"), reply(4, "fine", "two")]);
    const stop = store.retain(4000, "fine");
    await flush();
    expect(store.work(liveAnchor, ownsAll)).toBeNull();
    expect(store.work(replyAnchor(4, "fine"), ownsAll)?.files ?? []).toEqual([]);
    stop();
  });

  it("updates a running turn from the subscription without refetching, and only on status changes", async () => {
    const { store, refetch, subscribe, live } = setup([prompt(1, "run"), at(edit("e1", "a.ts"), 2, "run")]);
    store.setRunning(true);
    const stop = store.retainLive();
    await flush();
    const reads = refetch.mock.calls.length;
    expect(store.work(liveAnchor, ownsAll)).toMatchObject({ running: true, files: [{ path: "a.ts", callIds: ["e1"] }] });
    const prompted = vi.fn();
    const older = vi.fn();
    const unsubscribe = store.subscribeWork(liveAnchor, prompted);
    const unsubscribeOlder = store.subscribeWork(replyAnchor(9, "older"), older);

    live(edit("e2", "b.ts", "running"));
    expect(prompted).toHaveBeenCalledTimes(1);
    // A running edit is not in the card yet.
    expect(store.work(liveAnchor, ownsAll)?.files.map((file) => file.path)).toEqual(["a.ts"]);
    live(edit("e2", "b.ts"));
    expect(prompted).toHaveBeenCalledTimes(2);
    expect(store.work(liveAnchor, ownsAll)?.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    live(edit("e2", "b.ts"));
    expect(prompted).toHaveBeenCalledTimes(2);

    live(shell("c1", "running", "1"));
    expect(prompted).toHaveBeenCalledTimes(3);
    expect(store.work(liveAnchor, ownsAll)?.current).toEqual({ callId: "c1", verb: "command", target: "npm test" });
    // Streamed output alone notifies nobody.
    live(shell("c1", "running", "1\n2\n3"));
    expect(prompted).toHaveBeenCalledTimes(3);
    live(shell("c1", "completed", "done", 0));
    expect(prompted).toHaveBeenCalledTimes(4);
    const work = store.work(liveAnchor, ownsAll)!;
    expect(work.current).toBeNull();
    expect(work.steps.map((step) => step.callId)).toEqual(["e1", "e2", "c1"]);

    live(edit("e3", "c.ts", "failed"));
    expect(store.work(liveAnchor, ownsAll)?.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);

    expect(older).not.toHaveBeenCalled();
    expect(refetch.mock.calls.length).toBe(reads);
    expect(subscribe).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribeOlder();
    stop();
  });

  it("gives the running card's status line what runs, what the agent thinks, and the newest finished step", async () => {
    const { store, live, emit } = setup([prompt(1, "run"), at(edit("e1", "a.ts"), 2, "run")]);
    store.setRunning(true);
    const stop = store.retainLive();
    await flush();
    const notified = vi.fn();
    const unsubscribe = store.subscribeWork(liveAnchor, notified);
    expect(store.work(liveAnchor, ownsAll)).toMatchObject({ current: null, thinking: false, latest: { callId: "e1", verb: "edit" } });

    // A thought streams: one notice for the change, none per chunk.
    const thought = (text: string) => emit({ type: "timeline", provider: "codex", item: { type: "reasoning", text }, turnId: "run" } as PaseoAgentTimelineEvent["event"]);
    thought("Looking");
    thought(" at the tests");
    expect(notified).toHaveBeenCalledTimes(1);
    expect(store.work(liveAnchor, ownsAll)?.thinking).toBe(true);

    // A read, an edit and a write still running each name what they will fold as.
    live(tool("r1", { type: "read", filePath: "b.ts" }, "running", "Read"));
    expect(store.work(liveAnchor, ownsAll)).toMatchObject({ thinking: false, current: { callId: "r1", verb: "read", target: "b.ts" } });
    live(tool("r1", { type: "read", filePath: "b.ts", content: "x" }, "completed", "Read"));
    live(edit("e2", "c.ts", "running"));
    expect(store.work(liveAnchor, ownsAll)?.current).toEqual({ callId: "e2", verb: "edit", target: "c.ts" });
    live(edit("e2", "c.ts"));
    expect(store.work(liveAnchor, ownsAll)).toMatchObject({ current: null, latest: { callId: "e2", verb: "edit", filePath: "c.ts" } });

    // A patch keeps its row, so the line does not name it.
    live(tool("p1", { type: "edit", filePath: "d.ts", unifiedDiff: "@@" }, "running", "apply_patch"));
    expect(store.work(liveAnchor, ownsAll)?.current).toBeNull();

    // The reply that follows a thought ends it; so does the turn's end.
    thought("Again");
    expect(store.work(liveAnchor, ownsAll)?.thinking).toBe(true);
    emit({ type: "timeline", provider: "codex", item: { type: "assistant_message", text: "Done" }, turnId: "run" } as PaseoAgentTimelineEvent["event"]);
    expect(store.work(liveAnchor, ownsAll)?.thinking).toBe(false);
    thought("More");
    emit({ type: "turn_completed", provider: "codex", turnId: "run" } as PaseoAgentTimelineEvent["event"]);
    expect(store.work(liveAnchor, ownsAll)?.thinking ?? false).toBe(false);
    unsubscribe();
    stop();
  });

  it("marks a turn whose prompt the read has not reached", async () => {
    const entries = [at(edit("e1", "a.ts"), 5, "one"), reply(6, "first", "one"), prompt(7, "two"), at(edit("e2", "b.ts"), 8, "two"), reply(9, "second", "two")];
    let handler: unknown = null;
    const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
    const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>().mockImplementation(async () => page(entries, { hasOlder: true }));
    const store = createTurnFooterStore(() => ({ refetch, subscribe: (next) => { handler = next; return release; } }));
    const stop = store.retain(9000, "second");
    await flush();
    expect(handler).not.toBeNull();
    expect(store.work(replyAnchor(9, "second"), ownsAll)).toMatchObject({ complete: true, durationMs: 2000 });
    expect(store.work(replyAnchor(6, "first"), ownsAll)).toMatchObject({ complete: false, durationMs: null });
    stop();
  });

  it("measures each call's line count once, by call ID", () => {
    const { store } = setup([]);
    const measure = vi.fn(measureLineCount);
    const item = edit("e1", "a.ts");
    expect(store.lineCount("e1", item, measure)).toEqual({ added: 2, removed: 1, viewable: true });
    expect(store.lineCount("e1", { ...item }, measure)).toEqual({ added: 2, removed: 1, viewable: true });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measureLineCount(tool("w", { type: "write", filePath: "b.ts", content: "x\ny\n" }, "completed", "Write")))
      .toEqual({ added: 2, removed: 0, viewable: true });
    expect(measureLineCount(tool("e", { type: "edit", filePath: "b.ts" }))).toBeNull();
  });
});
