import { describe, expect, it, vi } from "vitest";
import { createSearchCoverage, retrySearchPrompt } from "../../client/tasks/data/search-first-prompts";
import { firstPromptStoreFor } from "../../client/tasks/data/first-prompt";
import { sampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard } from "../../client/tasks/model";

const card = (id: string, closed = false): TaskCard => ({ ...sampleCards()[0]!, id, closed });
const page = (text: string) => ({ entries: [{ item: { type: "user_message", text } }], error: null });
// `Promise.withResolvers` needs lib ES2024; this repo's tests use this helper instead.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("first-message coverage counts", () => {
  it("counts finished reads as loaded, and failed or unreadable ones as neither", async () => {
    const read = vi.fn(async (id: string) => id === "failed" ? { error: "offline", entries: [] } : page("hello"));
    const api = { agents: { ref: (id: string) => ({ timeline: { refetch: () => read(id) } }) } } as never;
    const cards = [card("one"), card("two"), card("failed"), card("closed", true)];
    const byId = new Map(cards.map((item) => [item.id, item]));
    const store = firstPromptStoreFor(api);
    await Promise.all([store.request("one"), store.request("two"), store.request("failed")]);
    const status = createSearchCoverage(api, () => cards, () => true, (id) => byId.get(id));
    expect(status.read()).toEqual({ pending: 0, loaded: 2 });
    expect(read).not.toHaveBeenCalledWith("closed");
  });

  it("counts reads in flight as pending and publishes each change once", async () => {
    const finish = new Map<string, (value: unknown) => void>();
    const read = vi.fn((id: string) => {
      const { promise, resolve } = deferred<unknown>();
      finish.set(id, resolve);
      return promise;
    });
    const api = { agents: { ref: (id: string) => ({ timeline: { refetch: () => read(id) } }) } } as never;
    const cards = [card("one"), card("two")];
    const byId = new Map(cards.map((item) => [item.id, item]));
    const store = firstPromptStoreFor(api);
    void store.request("one");
    void store.request("two");
    const status = createSearchCoverage(api, () => cards, () => true, (id) => byId.get(id));
    const seen: Array<{ pending: number; loaded: number }> = [];
    const release = status.subscribe(() => seen.push(status.read()));
    expect(status.read()).toEqual({ pending: 2, loaded: 0 });
    finish.get("one")!(page("first"));
    await vi.waitFor(() => expect(status.read()).toEqual({ pending: 1, loaded: 1 }));
    finish.get("two")!(page("second"));
    await vi.waitFor(() => expect(status.read()).toEqual({ pending: 0, loaded: 2 }));
    expect(seen.at(-1)).toEqual({ pending: 0, loaded: 2 });
    release();
  });

  it("reports nothing while no query is active", () => {
    const cards = [card("one")];
    const byId = new Map(cards.map((item) => [item.id, item]));
    const status = createSearchCoverage({} as never, () => cards, () => false, (id) => byId.get(id));
    expect(status.read()).toEqual({ pending: 0, loaded: 0 });
  });
});

describe("single-card retry guard", () => {
  it("stops pagination if the owner closes and uses the same guard for single-card retry", async () => {
    const request = deferred<unknown>();
    const read = vi.fn(() => request.promise);
    const api = { agents: { ref: () => ({ timeline: { refetch: read } }) } } as never;
    let current = card("paged");
    const retried = retrySearchPrompt(api, current, () => current);
    current = { ...current, closed: true };
    request.resolve({ error: null, entries: [], hasNewer: true, endCursor: { epoch: "one", seq: 8 } });
    await retried;
    expect(read).toHaveBeenCalledTimes(1);
    await retrySearchPrompt(api, current, () => current);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
