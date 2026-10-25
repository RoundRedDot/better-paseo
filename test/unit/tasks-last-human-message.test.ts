import { describe, expect, it, vi } from "vitest";
import { createLastHumanMessageStore, lastHumanMessage, lastHumanMessageVersion } from "../../client/tasks/data/last-human-message";

type Row = { timestamp?: string; item: { type: string; text?: string } };
type Page = { error: string | null; entries: Row[]; hasOlder: boolean; startCursor: { epoch: string; seq: number } | null; reset?: boolean };

function fakeApi(pages: Page[]) {
  const refetch = vi.fn(async () => {
    const next = pages.shift();
    if (!next) throw new Error("no page");
    return next;
  });
  return { refetch, api: { agents: { ref: () => ({ timeline: { refetch } }) } } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const user = (text: string, timestamp?: string): Row => ({ timestamp, item: { type: "user_message", text } });
const reply = (text: string): Row => ({ item: { type: "assistant_message", text } });
const tool: Row = { item: { type: "tool_call" } };
const page = (entries: Row[], seq: number | null): Page => ({ error: null, entries, hasOlder: seq !== null, startCursor: seq === null ? null : { epoch: "e", seq } });

describe("last human message", () => {
  it("takes the last user message a person sent, skipping harness envelopes and blanks", () => {
    expect(lastHumanMessage([
      user("Fix it", "2026-10-25T08:00:00Z"),
      reply("Done"),
      user("  Now the tests  ", "2026-10-25T08:10:00Z"),
      user("<system-reminder>\nBe brief\n</system-reminder>"),
      user(" "),
      tool,
    ])).toEqual({ message: { state: "ready", text: "Now the tests", timestamp: "2026-10-25T08:10:00Z" }, earliest: false });
    expect(lastHumanMessage([tool, user("Fix it")])?.earliest).toBe(true);
    expect(lastHumanMessage([reply("Done"), tool])).toBeNull();
  });

  it("pages back from the tail until it finds one", async () => {
    const at = "2026-10-25T09:00:00Z";
    const { api, refetch } = fakeApi([page([tool, tool, reply("Working")], 80), page([user("Fix it"), reply("Done"), user("Retry", at), tool], 40)]);
    const store = createLastHumanMessageStore(api as never);
    store.request("a", "v1");
    expect(store.read("a")).toEqual({ state: "loading" });
    await flush();
    expect(refetch).toHaveBeenNthCalledWith(1, { direction: "tail", projection: "projected", limit: 40 });
    expect(refetch).toHaveBeenNthCalledWith(2, { direction: "before", projection: "projected", limit: 40, cursor: { epoch: "e", seq: 80 } });
    expect(store.read("a")).toEqual({ state: "ready", text: "Retry", timestamp: at });
  });

  it("calls the timeline's first message the first prompt, and settles on it for the version", async () => {
    const { api, refetch } = fakeApi([page([tool, reply("Working")], 40), page([user("Fix it"), reply("Done")], null)]);
    const store = createLastHumanMessageStore(api as never);
    store.request("a", "v1");
    await flush();
    expect(store.read("a")).toEqual({ state: "first" });
    store.request("a", "v1");
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("finds none in a timeline without a person's message, and fails on a cursor that does not move back", async () => {
    const none = fakeApi([page([reply("Hi")], null)]);
    const store = createLastHumanMessageStore(none.api as never);
    store.request("a", "v1");
    await flush();
    expect(store.read("a")).toEqual({ state: "none" });

    const stuck = fakeApi([page([tool], 40), page([tool], 40)]);
    const other = createLastHumanMessageStore(stuck.api as never);
    other.request("a", "v1");
    await flush();
    expect(other.read("a")).toEqual({ state: "error" });
  });

  it("moves its version when someone sends, else with the reply's", () => {
    const timing = { updatedAt: "2026-10-22T10:00:00Z", turnStartedAt: null, lastUserMessageAt: "2026-10-22T09:59:00Z" };
    expect(lastHumanMessageVersion({ lane: "done", timing })).toBe(lastHumanMessageVersion({ lane: "done", timing: { ...timing, updatedAt: "2026-10-22T10:05:00Z" } }));
    expect(lastHumanMessageVersion({ lane: "done", timing })).not.toBe(lastHumanMessageVersion({ lane: "done", timing: { ...timing, lastUserMessageAt: "2026-10-22T10:01:00Z" } }));
    expect(lastHumanMessageVersion({ lane: "done", timing: { ...timing, lastUserMessageAt: null } })).toBe("done|2026-10-22T10:00:00Z");
  });
});
