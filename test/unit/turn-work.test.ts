import { describe, expect, it } from "vitest";
import { completedTurnFooters } from "../../client/state/turn-duration";
import { completedTurnWork, turnWorkCursorKey, turnWorkItemKey } from "../../client/state/turn-work";
import { timelineEntry as entry, type TimelineEntry } from "./helpers/turn-timeline";

const prompt = (seq: number, turnId = "one") => entry({ type: "user_message", text: "prompt" }, seq, seq * 1000, turnId);
const thought = (seq: number, turnId = "one", text = `thinking ${seq}`) => entry({ type: "reasoning", text }, seq, seq * 1000, turnId);
const tool = (seq: number, turnId = "one", status = "completed", name = "shell") => entry({ type: "tool_call", callId: `c${seq}`, name,
  status, detail: { type: "plain_text", text: "output" }, error: status === "failed" ? "failed" : null } as TimelineEntry["item"], seq, seq * 1000, turnId);
const reply = (seq: number, turnId = "one") => entry({ type: "assistant_message", text: `answer ${seq}` }, seq, seq * 1000, turnId);
const key = (row: TimelineEntry) => turnWorkCursorKey(turnWorkItemKey(row.item, 0)!, row.seqEnd);
const index = (rows: TimelineEntry[], running = false, active: string | null = null, fromStart = true) =>
  completedTurnWork(rows, completedTurnFooters(rows, running, active, { fromStart }), "e", { fromStart });

describe("completed work groups", () => {
  it("folds thoughts and tools together while leaving messages and checklists alone", () => {
    const rows = [prompt(1), thought(2), reply(3), tool(4), entry({ type: "todo", items: [] }, 5, 5000, "one"), reply(6)];
    const groups = index(rows);
    expect([...groups.keys()]).toEqual([key(rows[1]!), key(rows[3]!)]);
    expect(groups.get(key(rows[1]!))).toEqual({ epoch: "e", key: "e:1", anchor: key(rows[1]!), members: [key(rows[1]!), key(rows[3]!)], failed: 0 });
    expect(groups.get(key(rows[1]!))).toBe(groups.get(key(rows[3]!)));
  });

  it("waits for the active turn to finish, even after its first reply and tools settle", () => {
    const rows = [prompt(1), thought(2), tool(3), reply(4), prompt(5, "two"), thought(6, "two"), tool(7, "two"), reply(8, "two")];
    expect([...index(rows, true, "two").keys()]).toEqual([key(rows[1]!), key(rows[2]!)]);
    expect(index(rows, false).size).toBe(4);
    expect(index(rows.slice(0, 4), true, "one").size).toBe(0);
  });

  it("folds finished failures too and keeps running, rejected and interactive calls visible", () => {
    const rejected = tool(10);
    if (rejected.item.type === "tool_call") rejected.item.metadata = { approved: false };
    const rows = [prompt(1), thought(2), tool(3), tool(4, "one", "failed"), tool(5, "one", "canceled"),
      tool(6, "one", "running"), tool(7, "one", "completed", "request_user_input_async"),
      tool(8, "one", "completed", "AskUserQuestion"), tool(9, "one", "completed", "agent_message"), rejected, reply(11)];
    expect([...index(rows).keys()]).toEqual([key(rows[1]!), key(rows[2]!), key(rows[3]!), key(rows[4]!)]);
    expect(index(rows).get(key(rows[1]!))?.failed).toBe(1);
  });

  it("does not fold a turn without a final reply or one with an error notice", () => {
    const rows = [prompt(1), thought(2), tool(3)];
    expect(index(rows).size).toBe(0);
    expect(index([...rows, reply(4), entry({ type: "error", message: "disconnected" }, 5, 5000, "one")]).size).toBe(0);
    expect(index([...rows, reply(4), entry({ type: "notification", level: "error", message: "failed" }, 5, 5000, "one")]).size).toBe(0);
  });

  it("waits for the first turn's older page and uses canonical sequence for equal timestamps", () => {
    const rows = [thought(2), tool(3), reply(4)];
    expect(index(rows, false, null, false).size).toBe(0);
    expect(index(rows).size).toBe(2);
    const sameTime = [prompt(1), thought(2), tool(3), reply(4)].map((row) => ({ ...row, timestamp: new Date(1000).toISOString() }));
    expect(index(sameTime).get("3:tool:c3")?.anchor).toBe("2:thought:thinking 2");
  });

  it("distinguishes repeated text even at equal timestamps by its canonical sequence", () => {
    const rows = [prompt(1), thought(2), thought(3), tool(4), reply(5)];
    rows[2]!.timestamp = rows[1]!.timestamp;
    if (rows[2]!.item.type === "reasoning") rows[2]!.item.text = "thinking 2";
    expect([...index(rows).keys()]).toEqual(["2:thought:thinking 2", "3:thought:thinking 2", "4:tool:c4"]);
  });

  it("never hides duplicate canonical records or claims calls another renderer owns", () => {
    const rows = [prompt(1), thought(2), thought(3), tool(4), reply(5)];
    rows[2]!.seqEnd = rows[1]!.seqEnd;
    if (rows[2]!.item.type === "reasoning") rows[2]!.item.text = "thinking 2";
    expect(index(rows).size).toBe(0);
    const unclaimed = tool(6, "one", "completed", "terminal");
    if (unclaimed.item.type === "tool_call") unclaimed.item.detail = { type: "plain_text", text: "", label: "" };
    expect(index([prompt(1), thought(2), unclaimed, reply(7)]).size).toBe(0);
  });

  it("uses seqEnd for coalesced records and does not claim intervening sequences", () => {
    const rows = [prompt(1), thought(2), tool(3), reply(10)];
    rows[1]!.seqEnd = 7;
    rows[2]!.seqEnd = 9;
    const groups = index(rows);
    expect([...groups.keys()]).toEqual(["7:thought:thinking 2", "9:tool:c3"]);
    expect(groups.has("2:thought:thinking 2")).toBe(false);
    expect(groups.has("8:tool:c3")).toBe(false);
  });

  it("keeps autonomous turns separated by the recorded turn boundaries", () => {
    const rows = [prompt(1), thought(2), tool(3), reply(4), thought(10), tool(11), reply(12)];
    for (const row of rows) delete row.turnId;
    const marks = { starts: [1000, 9500], ends: [4100, 12100] };
    const completed = completedTurnFooters(rows, false, null, { marks, fromStart: true });
    const groups = completedTurnWork(rows, completed, "e", { marks, fromStart: true });
    expect(groups.get(key(rows[1]!))?.members).toHaveLength(2);
    expect(groups.get(key(rows[4]!))?.key).toBe("e:10");
  });
});
