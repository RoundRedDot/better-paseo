import { afterEach, describe, expect, it, vi } from "vitest";
import { createSearchCoverage, retrySearchPrompt } from "../../client/tasks/data/search-first-prompts";
import { firstPromptStoreFor } from "../../client/tasks/data/first-prompt";
import { requestSubagentFirstPrompt, setSubagentTimelineLoader } from "../../client/tasks/data/subagent-timeline";
import { sampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard } from "../../client/tasks/model";
const card = (id: string, closed = false): TaskCard => ({ ...sampleCards()[0]!, id, closed });
const page = (text: string) => ({ entries: [{ item: { type: "user_message", text } }], error: null });
afterEach(() => setSubagentTimelineLoader(null));

describe("failed first-message batch retry", () => {
  it.each([false, true])("retains search and ends with all-success=%s", async (success) => {
    const read = vi.fn<(id: string) => Promise<unknown>>().mockRejectedValue(new Error("offline"));
    const api = { agents: { ref: (id: string) => ({ timeline: { refetch: () => read(id) } }) } } as never;
    const cards = [card("one"), card("two"), card("ready"), card("closed", true)];
    const byId = new Map(cards.map((item) => [item.id, item]));
    const store = firstPromptStoreFor(api);
    await Promise.all([store.request("one"), store.request("two"), store.request("closed")]);
    read.mockResolvedValue(page("done"));
    await store.request("ready");
    const status = createSearchCoverage(api, () => cards, () => true, (id) => byId.get(id));
    read.mockReset();
    const done = new Map<string, (value: unknown) => void>();
    read.mockImplementation((id) => new Promise((resolve) => done.set(id, resolve)));
    const updates: ReturnType<typeof status.read>[] = [];
    const release = status.subscribe(() => updates.push(status.read()));
    const retry = status.retry();
    const duplicate = status.retry();
    expect(status.read()).toEqual({ pending: 2, unavailable: 1, failed: 0, retrying: 2 });
    expect(read.mock.calls).toEqual([["one"], ["two"]]);
    done.get("one")!(page("first done"));
    done.get("two")!(success ? page("second done") : { error: "still offline", entries: [] });
    await Promise.all([retry, duplicate]);
    expect(status.read()).toEqual({ pending: 0, unavailable: 1, failed: success ? 0 : 1, retrying: 0 });
    expect(updates.some((update) => update.retrying === 2)).toBe(true);
    release();
  });

  it("distinguishes subagents and skips closed, missing and cached cards", async () => {
    const read = vi.fn(async () => ({ error: "offline", entries: [] }));
    const load = vi.fn(async () => ({ error: "offline" as string | null, rows: [] as Array<{ type: string; text?: string }> }));
    setSubagentTimelineLoader(load);
    const api = { agents: { ref: (id: string) => ({ timeline: { refetch: () => read() } }) } } as never;
    const parent = card("parent");
    const closed = card("closed-parent", true);
    const child = (id: string, parentId: string): TaskCard => ({ ...card(id), subagent: { subtitle: null }, parent: { id: parentId, title: "Parent", missing: false, archived: false } });
    const sub = child("retry-sub", parent.id);
    const closedSub = child("closed-retry-sub", closed.id);
    const missingSub = child("missing-retry-sub", "missing");
    const cards = [parent, closed, sub, closedSub, missingSub];
    const byId = new Map(cards.map((item) => [item.id, item]));
    await firstPromptStoreFor(api).request(parent.id);
    await Promise.all([requestSubagentFirstPrompt(sub.id, parent.id), requestSubagentFirstPrompt(closedSub.id, closed.id), requestSubagentFirstPrompt(missingSub.id, "missing")]);
    read.mockClear(); load.mockClear();
    load.mockResolvedValue({ error: null, rows: [{ type: "user_message", text: "child prompt" }] });
    const status = createSearchCoverage(api, () => cards, () => true, (id) => byId.get(id));
    await status.retry();
    expect(read).toHaveBeenCalledTimes(1);
    expect(load.mock.calls).toEqual([[{ parentAgentId: parent.id, subagentId: sub.id, direction: "after", limit: 8 }]]);
    expect(status.read()).toMatchObject({ failed: 1, unavailable: 3, retrying: 0 });
  });

  it("bounds retry concurrency and rechecks queued cards after sessions close", async () => {
    const read = vi.fn<(id: string) => Promise<unknown>>().mockRejectedValue(new Error("offline"));
    const api = { agents: { ref: (id: string) => ({ timeline: { refetch: () => read(id) } }) } } as never;
    const cards = Array.from({ length: 6 }, (_, index) => card(`retry-${index}`));
    const byId = new Map(cards.map((item) => [item.id, item]));
    await Promise.all(cards.map((item) => firstPromptStoreFor(api).request(item.id)));
    read.mockReset();
    const finish: Array<() => void> = [];
    read.mockImplementation(() => new Promise((resolve) => finish.push(() => resolve(page("done")))));
    const status = createSearchCoverage(api, () => cards, () => true, (id) => byId.get(id));
    const retry = status.retry();
    expect(read).toHaveBeenCalledTimes(4);
    byId.set(cards[4]!.id, { ...cards[4]!, closed: true });
    byId.delete(cards[5]!.id);
    finish.forEach((done) => done());
    await retry;
    expect(read).toHaveBeenCalledTimes(4);
    expect(status.read().retrying).toBe(0);
  });

  it("shares the four slots with automatic reads and cancels queued retries on clear", async () => {
    const read = vi.fn(async () => ({ error: "offline", entries: [] }));
    const api = { agents: { ref: () => ({ timeline: { refetch: read } }) } } as never;
    const task = card("queued-failed");
    await firstPromptStoreFor(api).request(task.id);
    read.mockClear();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const requests = new Set<Promise<void>>([pending, new Promise(() => {}), new Promise(() => {}), new Promise(() => {})]);
    let active = true;
    const status = createSearchCoverage(api, () => [task], () => active, () => task, requests);
    const retry = status.retry();
    expect(status.read().retrying).toBe(1);
    expect(read).not.toHaveBeenCalled();
    active = false;
    finish();
    await retry;
    expect(read).not.toHaveBeenCalled();
  });

  it("stops pagination if the owner closes and uses the same guard for single-card retry", async () => {
    let resolve!: (value: unknown) => void;
    const read = vi.fn(() => new Promise((done) => { resolve = done; }));
    const api = { agents: { ref: () => ({ timeline: { refetch: read } }) } } as never;
    let current = card("paged");
    const request = retrySearchPrompt(api, current, () => current);
    current = { ...current, closed: true };
    resolve({ error: null, entries: [], hasNewer: true, endCursor: { epoch: "one", seq: 8 } });
    await request;
    expect(read).toHaveBeenCalledTimes(1);
    await retrySearchPrompt(api, current, () => current);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
