import { describe, expect, it, vi } from "vitest";
import { createFirstPromptStore, firstPromptMessage } from "../../client/tasks/data/first-prompt";

type Page = { error: string | null; entries: { timestamp?: string; item: { type: string; text?: string } }[] };

function fakeApi(pages: (Page | Error)[]) {
  const refetch = vi.fn(async () => {
    const next = pages.shift();
    if (!next) throw new Error("no page");
    if (next instanceof Error) throw next;
    return next;
  });
  return { refetch, api: { agents: { ref: () => ({ timeline: { refetch } }) } } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("first prompt", () => {
  it("takes the first user message from the timeline's head", () => {
    expect(firstPromptMessage([
      { item: { type: "assistant_message", text: "hi" } },
      { timestamp: "2026-10-25T08:13:00Z", item: { type: "user_message", text: "  Fix the board\nand the sidebar  " } },
      { timestamp: "2026-10-25T09:00:00Z", item: { type: "user_message", text: "later" } },
    ])).toEqual({ state: "ready", text: "Fix the board\nand the sidebar", timestamp: "2026-10-25T08:13:00Z" });
    expect(firstPromptMessage([{ item: { type: "tool_call" } }])).toBeNull();
    expect(firstPromptMessage([{ item: { type: "user_message", text: "  " } }])).toBeNull();
    expect(firstPromptMessage([{ item: { type: "user_message", text: "No timestamp" } }])).toEqual({ state: "ready", text: "No timestamp" });
  });

  it("reads the head once, keeps a found prompt, and asks again after a miss or a failure", async () => {
    const { api, refetch } = fakeApi([
      new Error("offline"),
      { error: null, entries: [] },
      { error: null, entries: [{ timestamp: "2026-10-25T08:13:00Z", item: { type: "user_message", text: "Ship it" } }] },
    ]);
    const store = createFirstPromptStore(api as never);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.read("a")).toEqual({ state: "idle" });

    store.request("a");
    store.request("a");
    expect(store.read("a")).toEqual({ state: "loading" });
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenLastCalledWith({ direction: "after", projection: "projected", limit: 8 });
    expect(store.read("a")).toEqual({ state: "error" });

    store.request("a");
    await flush();
    expect(store.read("a")).toEqual({ state: "none" });

    store.request("a");
    await flush();
    expect(store.read("a")).toEqual({ state: "ready", text: "Ship it", timestamp: "2026-10-25T08:13:00Z" });
    store.request("a");
    expect(refetch).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalled();
  });
});
