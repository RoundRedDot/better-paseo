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

function make(shared: Record<string, unknown> = { "bc-shared:client/tasks/board/enabled.ts": { tasksEnabled: () => true } }, retryMs?: number[]) {
  return createRemoteChunk({ id: "build-1", shared, hostRequire: (id) => ({ host: id }), retryMs });
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
