import { describe, expect, it, vi } from "vitest";
import { createFirstPromptStore, firstPromptMessage } from "../../client/tasks/data/first-prompt";

type Page = { error: string | null; entries: { timestamp?: string; item: { type: string; text?: string } }[]; hasNewer?: boolean; endCursor?: { epoch: string; seq: number }; reset?: boolean };

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
  it.each([
    "Working directory does not exist: /repo/.worktrees/removed: ENOENT: no such file or directory",
    "Agent old-agent references unavailable provider 'cursor'",
  ])("recognizes unavailable session prerequisites from returned and thrown errors: %s", async (message) => {
    for (const failure of [new Error(message), { error: message, entries: [] }]) {
      const { api } = fakeApi([failure, { error: null, entries: [{ item: { type: "user_message", text: "Restored prompt" } }] }]);
      const store = createFirstPromptStore(api as never);
      await store.request("a");
      expect(store.read("a")).toEqual({ state: "error", unavailable: true });
      await store.request("a");
      expect(store.read("a")).toMatchObject({ state: "ready", text: "Restored prompt" });
    }
  });

  it.each(["offline", "Request timed out", "Permission denied", "Unknown provider error"])("keeps transient and unknown failures retryable: %s", async (message) => {
    const { api } = fakeApi([{ error: message, entries: [] }]);
    const store = createFirstPromptStore(api as never);
    await store.request("a");
    expect(store.read("a")).toEqual({ state: "error" });
  });

  it("pages past harness rows, preserving the first user's complete message", async () => {
    const { api, refetch } = fakeApi([
      { error: null, entries: Array.from({ length: 8 }, () => ({ item: { type: "tool_call" } })), hasNewer: true, endCursor: { epoch: "history", seq: 8 } },
      { error: null, entries: [{ item: { type: "user_message", text: "First line\nSearch the entire first message" } }, { item: { type: "user_message", text: "Later" } }] },
    ]);
    const store = createFirstPromptStore(api as never);
    await store.request("a");
    expect(store.read("a")).toMatchObject({ state: "ready", text: "First line\nSearch the entire first message" });
    expect(refetch).toHaveBeenLastCalledWith({ direction: "after", projection: "projected", limit: 8, cursor: { epoch: "history", seq: 8 } });
  });

  it("does not read another page after search ends or the agent closes", async () => {
    let allowed = true;
    const refetch = vi.fn(async () => {
      allowed = false;
      return { error: null, entries: [], hasNewer: true, endCursor: { epoch: "history", seq: 8 } };
    });
    const store = createFirstPromptStore({ agents: { ref: () => ({ timeline: { refetch } }) } } as never);
    await store.request("a", () => allowed);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(store.read("a")).toEqual({ state: "error" });
  });

  it("reports a reset or non-advancing cursor rather than searching an incomplete head", async () => {
    for (const reset of [true, false]) {
      const cursor = { epoch: "history", seq: 8 };
      const { api, refetch } = fakeApi([
        { error: null, entries: [], hasNewer: true, endCursor: cursor },
        { error: null, entries: [], hasNewer: true, endCursor: cursor, reset },
      ]);
      const store = createFirstPromptStore(api as never);
      await store.request("a");
      expect(store.read("a")).toEqual({ state: "error" });
      expect(refetch).toHaveBeenCalledTimes(2);
    }
  });

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
