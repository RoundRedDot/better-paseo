import { describe, expect, it, vi } from "vitest";
import { createLastMessageStore, lastMessageVersion, lastReplyText } from "../../client/tasks/data/last-message";

type Page = { error: string | null; entries: { item: { type: string; text?: string } }[] };

function fakeApi(pages: (Page | Error | Promise<Page>)[]) {
  const refetch = vi.fn(async () => {
    const next = pages.shift();
    if (!next) throw new Error("no page");
    if (next instanceof Error) throw next;
    return next;
  });
  return { refetch, api: { agents: { ref: () => ({ timeline: { refetch } }) } } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const page = (text: string): Page => ({ error: null, entries: [{ item: { type: "assistant_message", text } }] });

describe("last message", () => {
  it("takes the last assistant message from the timeline's tail", () => {
    expect(lastReplyText([
      { item: { type: "user_message", text: "Fix it" } },
      { item: { type: "assistant_message", text: "  Done:\nall green  " } },
      { item: { type: "assistant_message", text: " " } },
      { item: { type: "tool_call" } },
    ])).toBe("Done:\nall green");
    expect(lastReplyText([{ item: { type: "user_message", text: "Fix it" } }])).toBeNull();
  });

  it("reads the tail once per version and keeps the older reply while a newer one loads", async () => {
    const { api, refetch } = fakeApi([page("First"), new Error("offline"), page("Second")]);
    const store = createLastMessageStore(api as never);
    expect(store.read("a")).toEqual({ state: "idle" });

    store.request("a", "v1");
    store.request("a", "v1");
    expect(store.read("a")).toEqual({ state: "loading" });
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenLastCalledWith({ direction: "tail", projection: "projected", limit: 40 });
    expect(store.read("a")).toEqual({ state: "ready", text: "First" });
    store.request("a", "v1");
    expect(refetch).toHaveBeenCalledTimes(1);

    store.request("a", "v2");
    expect(store.read("a")).toEqual({ state: "ready", text: "First" });
    await flush();
    expect(store.read("a")).toEqual({ state: "error" });
    // A failure is asked again on the same version.
    store.request("a", "v2");
    await flush();
    expect(store.read("a")).toEqual({ state: "ready", text: "Second" });
  });

  it("drops a stale read that lands after a newer one", async () => {
    let answerOld: (value: Page) => void = () => {};
    const old = new Promise<Page>((resolve) => (answerOld = resolve));
    const { api } = fakeApi([old, page("New")]);
    const store = createLastMessageStore(api as never);
    store.request("a", "v1");
    store.request("a", "v2");
    await flush();
    expect(store.read("a")).toEqual({ state: "ready", text: "New" });
    answerOld(page("Old"));
    await flush();
    expect(store.read("a")).toEqual({ state: "ready", text: "New" });
  });

  it("moves its version on a running card's turn and on any other card's update", () => {
    const timing = { updatedAt: "2026-10-22T10:00:00Z", turnStartedAt: "2026-10-22T09:59:00Z" };
    expect(lastMessageVersion({ lane: "running", timing })).toBe(lastMessageVersion({ lane: "running", timing: { ...timing, updatedAt: "2026-10-22T10:00:05Z" } }));
    expect(lastMessageVersion({ lane: "running", timing })).not.toBe(lastMessageVersion({ lane: "running", timing: { ...timing, turnStartedAt: "2026-10-22T10:01:00Z" } }));
    expect(lastMessageVersion({ lane: "done", timing })).not.toBe(lastMessageVersion({ lane: "done", timing: { ...timing, updatedAt: "2026-10-22T10:05:00Z" } }));
  });
});
