import { afterEach, describe, expect, it, vi } from "vitest";
import { CHUNK_CACHE, createRemoteChunk } from "../../client/tasks/chunk/remote-chunk";

// The Tasks chunk an install fetches from its plugin server (`remote-chunk.ts`).

// A chunk's code as the build makes it: a CommonJS body that reads a shared
// module and the host's react through `require`.
const CODE = `
  var store = require("bc-shared:client/tasks/board/enabled.ts");
  var react = require("react");
  exports.TasksBoardScreen = function () { return store.tasksEnabled(); };
  exports.react = react;
`;

function fakeClient(answer: (id: string) => Promise<{ code: string | null }>) {
  return { rpc: vi.fn((_contract: unknown, input: { id: string }) => answer(input.id)) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[CHUNK_CACHE];
  vi.useRealTimers();
});

/** A scheduler the test fires by hand: `fire()` runs every pending background fetch. */
function fakeLater() {
  const pending = new Set<() => void>();
  const later = vi.fn((run: () => void) => {
    pending.add(run);
    return () => {
      pending.delete(run);
    };
  });
  return {
    later,
    pending: () => pending.size,
    fire() {
      const runs = [...pending];
      pending.clear();
      for (const run of runs) run();
    },
  };
}

function make(
  shared: Record<string, unknown> = { "bc-shared:client/tasks/board/enabled.ts": { tasksEnabled: () => true } },
  retryMs?: number[],
  later: (run: () => void) => () => void = fakeLater().later,
) {
  return createRemoteChunk({ id: "build-1", shared, hostRequire: (id) => ({ host: id }), retryMs, later });
}

describe("remote Tasks chunk", () => {
  it("fetches the chunk once, evaluates it with the bundle's modules, and tells subscribers", async () => {
    const remote = make();
    const client = fakeClient(async () => ({ code: CODE }));
    remote.setChunkClient(client);
    const heard = vi.fn();
    remote.subscribeChunk(heard);
    expect(remote.chunkNow()).toBeNull();
    remote.requestChunk();
    remote.requestChunk();
    await settle();
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc.mock.calls[0]![1]).toEqual({ id: "build-1" });
    expect(heard).toHaveBeenCalledTimes(1);
    const chunk = remote.chunkNow() as unknown as { TasksBoardScreen(): boolean; react: unknown };
    expect(chunk.TasksBoardScreen()).toBe(true);
    expect(chunk.react).toEqual({ host: "react" });
  });

  it("after a reconnect, evaluates the kept code at once with the new bundle's modules, and asks for nothing", async () => {
    const first = make();
    first.setChunkClient(fakeClient(async () => ({ code: CODE })));
    first.requestChunk();
    await settle();
    // A reconnect: the bundle is evaluated again, with fresh module instances.
    const again = make({ "bc-shared:client/tasks/board/enabled.ts": { tasksEnabled: () => false } });
    const client = fakeClient(async () => ({ code: CODE }));
    again.setChunkClient(client);
    const chunk = again.chunkNow() as unknown as { TasksBoardScreen(): boolean };
    expect(chunk.TasksBoardScreen()).toBe(false);
    again.requestChunk();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("does not use code kept from another build", () => {
    (globalThis as Record<string, unknown>)[CHUNK_CACHE] = { id: "build-0", code: CODE };
    expect(make().chunkNow()).toBeNull();
  });

  it("tries a failed fetch again, then gives up", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remote = make(undefined, [10]);
    const client = fakeClient(async () => ({ code: null }));
    remote.setChunkClient(client);
    remote.requestChunk();
    await vi.runAllTimersAsync();
    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(remote.chunkNow()).toBeNull();
    warn.mockRestore();
  });

  it("sends nothing without a client, and drops an answer for a client that left", async () => {
    const remote = make();
    remote.requestChunk();
    let answer!: (value: { code: string }) => void;
    const client = fakeClient(() => new Promise((resolve) => (answer = resolve)));
    remote.setChunkClient(client);
    remote.requestChunk();
    remote.setChunkClient(null);
    answer({ code: CODE });
    await settle();
    expect(remote.chunkNow()).toBeNull();
  });
});

describe("remote Tasks chunk, asked for later", () => {
  it("waits for the scheduler: no request at the time, one when startup has settled", async () => {
    const timing = fakeLater();
    const remote = make(undefined, undefined, timing.later);
    const client = fakeClient(async () => ({ code: CODE }));
    remote.setChunkClient(client);
    remote.requestChunkLater();
    await settle();
    expect(client.rpc).not.toHaveBeenCalled();
    timing.fire();
    await settle();
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(remote.chunkNow()).not.toBeNull();
  });

  it("keeps one schedule however many places ask later", () => {
    const timing = fakeLater();
    const remote = make(undefined, undefined, timing.later);
    remote.setChunkClient(fakeClient(async () => ({ code: CODE })));
    remote.requestChunkLater();
    remote.requestChunkLater();
    remote.requestChunkLater();
    expect(timing.later).toHaveBeenCalledTimes(1);
    expect(timing.pending()).toBe(1);
  });

  it("fetches at once when someone asks now, and drops the pending later fetch", async () => {
    const timing = fakeLater();
    const remote = make(undefined, undefined, timing.later);
    const client = fakeClient(async () => ({ code: CODE }));
    remote.setChunkClient(client);
    remote.requestChunkLater();
    remote.requestChunk();
    expect(timing.pending()).toBe(0);
    await settle();
    timing.fire();
    await settle();
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("sends one request when a later fetch fires while one asked now is in flight", async () => {
    const timing = fakeLater();
    const remote = make(undefined, undefined, timing.later);
    let answer: ((value: { code: string }) => void) | null = null;
    const client = fakeClient(() => new Promise((resolve) => { answer = resolve; }));
    remote.setChunkClient(client);
    remote.requestChunk();
    remote.requestChunkLater();
    timing.fire();
    answer!({ code: CODE });
    await settle();
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("schedules nothing once the chunk is here, or without a client", () => {
    const timing = fakeLater();
    const remote = make(undefined, undefined, timing.later);
    remote.requestChunkLater();
    expect(timing.later).not.toHaveBeenCalled();
    (globalThis as Record<string, unknown>)[CHUNK_CACHE] = { id: "build-1", code: CODE };
    remote.setChunkClient(fakeClient(async () => ({ code: CODE })));
    remote.requestChunkLater();
    expect(timing.later).not.toHaveBeenCalled();
  });

  it("drops the pending later fetch when the board is turned off or the client goes", async () => {
    const timing = fakeLater();
    const remote = make(undefined, undefined, timing.later);
    const client = fakeClient(async () => ({ code: CODE }));
    remote.setChunkClient(client);
    remote.requestChunkLater();
    remote.cancelChunkLater();
    expect(timing.pending()).toBe(0);
    remote.requestChunkLater();
    remote.setChunkClient(null);
    expect(timing.pending()).toBe(0);
    timing.fire();
    await settle();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
