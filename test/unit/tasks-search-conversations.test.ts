import { describe, expect, it, vi } from "vitest";
import { createConversationSearch } from "../../client/tasks/data/search-conversations";
import { sampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard } from "../../client/tasks/model";
import type { ConversationSearchPage } from "../../shared/conversation-search";

const card = (id: string, closed = false): TaskCard => ({ ...sampleCards()[0]!, id, closed, children: [] });
const page: ConversationSearchPage = { match: null, nextCursor: null, unavailable: false, error: null };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: (value: ConversationSearchPage) => void;
  const promise = new Promise<ConversationSearchPage>((done) => { resolve = done; });
  return { promise, resolve };
};

describe("incremental conversation search", () => {
  it("keeps two page requests in flight, rotates between tasks and exposes matches immediately", async () => {
    const requests = Array.from({ length: 4 }, deferred);
    const load = vi.fn().mockImplementationOnce(() => requests[0]!.promise).mockImplementationOnce(() => requests[1]!.promise).mockImplementationOnce(() => requests[2]!.promise).mockImplementationOnce(() => requests[3]!.promise);
    const store = createConversationSearch(load);
    const cards = [card("a"), card("b"), card("c")];
    store.configure(cards, "target");
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.read()).toEqual({ pending: 3, unavailable: 0, failed: 0, retrying: 0 });
    requests[0]!.resolve({ ...page, nextCursor: { epoch: "one", seq: 16 } });
    await settle();
    expect(load.mock.calls[2]![0].agentId).toBe("c");
    requests[1]!.resolve({ ...page, match: "target in b" });
    await settle();
    expect([...store.messages()]).toEqual([["b", "target in b"]]);
    expect(load.mock.calls[3]![0]).toEqual({ agentId: "a", query: "target", cursor: { epoch: "one", seq: 16 } });
    requests[2]!.resolve(page);
    requests[3]!.resolve({ ...page, match: "target in a" });
    await settle();
    expect(store.read().pending).toBe(0);
    expect(store.prompt(cards[0]!)).toMatchObject({ state: "ready", field: "conversation" });
  });

  it("drops old query results and shares its two slots across replacement searches", async () => {
    const first = deferred();
    const second = deferred();
    const load = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise).mockResolvedValue(page);
    const store = createConversationSearch(load);
    const cards = [card("a"), card("b")];
    store.configure(cards, "old");
    await settle();
    store.configure(cards, "new");
    expect(load).toHaveBeenCalledTimes(2);
    first.resolve({ ...page, match: "old target" });
    second.resolve({ ...page, nextCursor: { epoch: "old", seq: 16 } });
    await settle();
    expect(load.mock.calls.slice(2).every(([input]) => input.query === "new" && !input.cursor)).toBe(true);
    expect(store.messages().size).toBe(0);
    expect(store.read().pending).toBe(0);
  });

  it("clears all excerpts and stops pagination when full-text search is switched off", async () => {
    const pending = deferred();
    const load = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue({ ...page, match: "target" });
    const store = createConversationSearch(load);
    store.configure([card("a"), card("b"), card("c")], "target");
    await settle();
    expect(store.messages().size).toBe(2);
    store.configure([], "");
    pending.resolve({ ...page, nextCursor: { epoch: "history", seq: 16 } });
    await settle();
    expect(store.messages().size).toBe(0);
    expect(store.read()).toEqual({ pending: 0, unavailable: 0, failed: 0, retrying: 0 });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("skips closed owners and removed directories, then retries only temporary failures", async () => {
    const load = vi.fn().mockResolvedValue({ ...page, error: "offline" });
    const store = createConversationSearch(load);
    const parent = card("parent", true);
    const child = { ...card("child"), subagent: { subtitle: null }, parent: { id: parent.id, title: "parent", missing: false, archived: false } };
    const removed = { ...card("removed"), availability: { issue: null, blocked: { read: { code: "directory_missing" as const, detail: "/removed" } } } };
    store.configure([card("a"), parent, child, removed], "target");
    await settle();
    expect(load.mock.calls.map(([input]) => input.agentId)).toEqual(["a"]);
    expect(store.read()).toEqual({ pending: 0, unavailable: 3, failed: 1, retrying: 0 });
    load.mockResolvedValue({ ...page, match: "target" });
    await store.retry();
    expect(store.read()).toEqual({ pending: 0, unavailable: 3, failed: 0, retrying: 0 });
    expect(store.messages().get("a")).toBe("target");
  });

  it("retains a bounded match when a session closes and evicts removed cards", async () => {
    const load = vi.fn(async () => ({ ...page, match: "target" }));
    const store = createConversationSearch(load);
    store.configure([card("a")], "target");
    await settle();
    store.configure([card("a", true)], "target");
    expect(store.messages().get("a")).toBe("target");
    expect(load).toHaveBeenCalledTimes(1);
    store.configure([], "target");
    expect(store.messages().size).toBe(0);
  });

  it("stops reading after the owner closes between pages and restarts on recovery", async () => {
    const pending = deferred();
    const load = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue({ ...page, match: "target" });
    const store = createConversationSearch(load);
    store.configure([card("a")], "target");
    await settle();
    store.configure([card("a", true)], "target");
    pending.resolve({ ...page, nextCursor: { epoch: "history", seq: 16 } });
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.read().unavailable).toBe(1);
    store.configure([card("a")], "target");
    await settle();
    expect(store.messages().get("a")).toBe("target");
  });

  it("does not accumulate pages, previous queries, or loading-only list snapshots", async () => {
    let seq = 0;
    const load = vi.fn(async () => ++seq < 2000 ? { ...page, nextCursor: { epoch: "history", seq } } : { ...page, match: "target" });
    const store = createConversationSearch(load);
    const maps = new Set<ReadonlyMap<string, string>>();
    store.subscribe(() => maps.add(store.messages()));
    store.configure([card("long")], "target");
    while (store.read().pending) await settle();
    expect(load).toHaveBeenCalledTimes(2000);
    expect([...store.messages()]).toEqual([["long", "target"]]);
    expect(maps.size).toBe(2);
    store.configure([], "");
    expect(store.messages().size).toBe(0);
  });
});
