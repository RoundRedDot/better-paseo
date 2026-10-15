import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageFile } from "../../client/image-file";

type ImageRpcInput = { cwd: string; path: string };
type ImageRpcOutput = {
  dataUri: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  error: string | null;
};

const { mockLoad } = vi.hoisted(() => ({
  mockLoad: vi.fn<(input: ImageRpcInput) => Promise<ImageRpcOutput>>(),
}));

vi.mock("@getpaseo/plugin/client", async () => {
  const React = await import("react");
  return {
    useRpc: () => React.useCallback((input: ImageRpcInput) => mockLoad(input), []),
  };
});

import { useImageFile } from "../../client/image-file";
import { disablePerf, enablePerf, perfSnapshot, resetPerf } from "../../client/debug/perf";
import "./helpers/quiet-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const firstResult: ImageRpcOutput = {
  dataUri: "data:image/png;base64,first",
  mime: "image/png",
  width: 640,
  height: 480,
  bytes: 123,
  error: null,
};
const firstFile: ImageFile = {
  dataUri: "data:image/png;base64,first",
  width: 640,
  height: 480,
  bytes: 123,
  error: null,
};
const secondResult: ImageRpcOutput = {
  dataUri: "data:image/png;base64,second",
  mime: "image/png",
  width: 320,
  height: 240,
  bytes: 456,
  error: null,
};
const secondFile: ImageFile = {
  dataUri: "data:image/png;base64,second",
  width: 320,
  height: 240,
  bytes: 456,
  error: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type ConsumerProps = {
  id: string;
  path: string | undefined;
  cwd: string | null;
  onRender?: (file: ImageFile | null) => void;
};

function HookConsumer({ id, path, cwd, onRender }: ConsumerProps) {
  const file = useImageFile(path, cwd);
  onRender?.(file);
  return React.createElement("consumer", { id, file });
}

function consumers(items: readonly ConsumerProps[]) {
  return React.createElement(
    React.Fragment,
    null,
    ...items.map((item) => React.createElement(HookConsumer, { ...item, key: item.id })),
  );
}

function fileFor(renderer: ReactTestRenderer, id: string): ImageFile | null {
  const output = renderer.root.find((node) => (node.type as unknown) === "consumer" && node.props.id === id);
  return output.props.file as ImageFile | null;
}

let renderers = new Set<ReactTestRenderer>();

function mount(items: readonly ConsumerProps[]): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(consumers(items));
  });
  renderers.add(renderer);
  return renderer;
}

function update(renderer: ReactTestRenderer, items: readonly ConsumerProps[]): void {
  act(() => renderer.update(consumers(items)));
}

function unmount(renderer: ReactTestRenderer): void {
  act(() => renderer.unmount());
  renderers.delete(renderer);
}

async function flushResolvedReads(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
});

async function advanceFrame(): Promise<void> {
  const callbacks = [...frames.values()];
  frames.clear();
  await act(async () => callbacks.forEach((callback) => callback(nextFrame * 16)));
}

afterEach(() => {
  for (const renderer of renderers) act(() => renderer.unmount());
  renderers = new Set();
  mockLoad.mockReset();
  disablePerf();
  resetPerf();
  vi.unstubAllGlobals();
});

describe("useImageFile", () => {
  it("waits for the preceding consumer's React commit before scheduling its frame", async () => {
    const pending = deferred<ImageRpcOutput>();
    mockLoad.mockReturnValue(pending.promise);
    const renderer = mount(["starter", "second"].map((id) => ({ id, path: "shot.png", cwd: "/workspace" })));
    await act(async () => {
      pending.resolve(firstResult);
      await pending.promise;
      await Promise.resolve();
      // React has not flushed this async act yet. Scheduling now lets rAF
      // race that commit and batch the starter with the second consumer.
      expect(frames.size).toBe(0);
    });
    expect(fileFor(renderer, "starter")).toEqual(firstFile);
    expect(fileFor(renderer, "second")).toBeNull();
    expect(frames.size).toBe(1);
    await advanceFrame();
    expect(fileFor(renderer, "second")).toEqual(firstFile);
  });

  it("delivers to the starter immediately and to later joiners one frame apart in join order", async () => {
    const pending = deferred<ImageRpcOutput>();
    mockLoad.mockReturnValue(pending.promise);
    const received: string[] = [];
    const consumer = (id: string): ConsumerProps => ({
      id, path: "shot.png", cwd: "/workspace",
      onRender: (file) => { if (file) received.push(id); },
    });
    const renderer = mount([consumer("starter"), consumer("second")]);
    update(renderer, [consumer("starter"), consumer("second"), consumer("third")]);

    await act(async () => {
      pending.resolve(firstResult);
      await pending.promise;
    });
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(received).toEqual(["starter"]);
    expect(fileFor(renderer, "second")).toBeNull();
    expect(fileFor(renderer, "third")).toBeNull();

    await advanceFrame();
    expect(received).toEqual(["starter", "second"]);
    expect(fileFor(renderer, "third")).toBeNull();
    await advanceFrame();
    expect(received).toEqual(["starter", "second", "third"]);
    expect(frames.size).toBe(0);
  });

  it.each(["reject", "error-result"])("delivers a shared %s in the same frame order", async (kind) => {
    const pending = deferred<ImageRpcOutput>();
    mockLoad.mockReturnValue(pending.promise);
    const renderer = mount(["starter", "second", "third"].map((id) => ({
      id, path: "shot.png", cwd: "/workspace",
    })));
    const failure = new Error("ENOENT: shot.png");
    await act(async () => {
      if (kind === "reject") pending.reject(failure);
      else pending.resolve({ ...firstResult, dataUri: null, error: failure.message });
      await pending.promise.catch(() => undefined);
    });
    expect(fileFor(renderer, "starter")?.error).toBe(failure.message);
    expect(fileFor(renderer, "second")).toBeNull();
    expect(fileFor(renderer, "third")).toBeNull();
    await advanceFrame();
    expect(fileFor(renderer, "second")?.error).toBe(failure.message);
    expect(fileFor(renderer, "third")).toBeNull();
    await advanceFrame();
    expect(fileFor(renderer, "third")?.error).toBe(failure.message);
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it("cancels a joiner's pending frame on unmount without updating it", async () => {
    const pending = deferred<ImageRpcOutput>();
    const render = vi.fn();
    mockLoad.mockReturnValue(pending.promise);
    const starter: ConsumerProps = { id: "starter", path: "shot.png", cwd: "/workspace" };
    const renderer = mount([starter, { ...starter, id: "removed", onRender: render }]);
    await act(async () => { pending.resolve(firstResult); await pending.promise; });
    const [id, callback] = [...frames.entries()][0]!;
    const rendersBeforeUnmount = render.mock.calls.length;

    update(renderer, [starter]);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(id);
    expect(frames.size).toBe(0);
    await advanceFrame();
    // An already queued callback also respects the per-consumer guard.
    act(() => callback(0));
    expect(render).toHaveBeenCalledTimes(rendersBeforeUnmount);
  });

  it("cancels an old path's delivery frame and reads the new path immediately", async () => {
    const oldRead = deferred<ImageRpcOutput>();
    const newRead = deferred<ImageRpcOutput>();
    mockLoad.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    const starter: ConsumerProps = { id: "starter", path: "shot.png", cwd: "/workspace" };
    const renderer = mount([starter, { ...starter, id: "changed" }]);
    await act(async () => { oldRead.resolve(firstResult); await oldRead.promise; });
    const [id, callback] = [...frames.entries()][0]!;

    update(renderer, [starter, { ...starter, id: "changed", path: "new.png" }]);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(id);
    expect(fileFor(renderer, "changed")).toBeNull();
    await act(async () => { newRead.resolve(secondResult); await newRead.promise; });
    expect(fileFor(renderer, "changed")).toEqual(secondFile);
    act(() => callback(0));
    await advanceFrame();
    expect(fileFor(renderer, "changed")).toEqual(secondFile);
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });

  it("skips a cancelled joiner without letting later joiners race the starter's commit", async () => {
    const pending = deferred<ImageRpcOutput>();
    mockLoad.mockReturnValue(pending.promise);
    const items = ["starter", "removed", "third"].map((id) => ({
      id, path: "shot.png", cwd: "/workspace",
    }));
    const renderer = mount(items);
    update(renderer, [items[0]!, items[2]!]);
    await act(async () => {
      pending.resolve(firstResult);
      await pending.promise;
      await Promise.resolve();
      expect(frames.size).toBe(0);
    });
    expect(fileFor(renderer, "starter")).toEqual(firstFile);
    expect(fileFor(renderer, "third")).toBeNull();
    expect(frames.size).toBe(1);
    await advanceFrame();
    expect(fileFor(renderer, "third")).toEqual(firstFile);
    expect(frames.size).toBe(0);
  });

  it("drops the settled read even while an earlier joiner is waiting for its frame", async () => {
    const pending = deferred<ImageRpcOutput>();
    mockLoad.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(secondResult);
    const first = mount(["starter", "waiting"].map((id) => ({
      id, path: "shot.png", cwd: "/workspace",
    })));
    await act(async () => { pending.resolve(firstResult); await pending.promise; });
    expect(fileFor(first, "waiting")).toBeNull();

    const later = mount([{ id: "later", path: "shot.png", cwd: "/workspace" }]);
    await flushResolvedReads();
    expect(mockLoad).toHaveBeenCalledTimes(2);
    expect(fileFor(later, "later")).toEqual(secondFile);
    await advanceFrame();
    expect(fileFor(first, "waiting")).toEqual(firstFile);
  });

  it("clears an already loaded file before reading a changed path", async () => {
    const next = deferred<ImageRpcOutput>();
    mockLoad.mockResolvedValueOnce(firstResult).mockReturnValueOnce(next.promise);
    const renderer = mount([{ id: "image", path: "old.png", cwd: "/workspace" }]);
    await flushResolvedReads();
    expect(fileFor(renderer, "image")).toEqual(firstFile);
    update(renderer, [{ id: "image", path: "new.png", cwd: "/workspace" }]);
    expect(fileFor(renderer, "image")).toBeNull();
    await act(async () => { next.resolve(secondResult); await next.promise; });
    expect(fileFor(renderer, "image")).toEqual(secondFile);
  });

  it("shares one in-flight read between same-key consumers and probes only the real RPC", async () => {
    enablePerf();
    const pending = deferred<ImageRpcOutput>();
    const secondPending = deferred<ImageRpcOutput>();
    mockLoad.mockReturnValueOnce(pending.promise).mockReturnValueOnce(secondPending.promise);

    const renderer = mount([
      { id: "first", path: "shot.png", cwd: "/workspace" },
      { id: "second", path: "shot.png", cwd: "/workspace" },
    ]);

    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(perfSnapshot().imageRpc).toEqual({ count: 1, duplicatesInFlight: 0 });

    await act(async () => {
      pending.resolve(firstResult);
      secondPending.resolve(secondResult);
      await Promise.all([pending.promise, secondPending.promise]);
    });
    expect(fileFor(renderer, "first")).toEqual(firstFile);
    await advanceFrame();
    expect(fileFor(renderer, "second")).toEqual(firstFile);
  });

  it("keeps different cwd and path pairs separate, including delimiter collisions", async () => {
    const cases: ConsumerProps[] = [
      { id: "cwd-a", path: "same.png", cwd: "/workspace/a" },
      { id: "cwd-b", path: "same.png", cwd: "/workspace/b" },
      { id: "path-a", path: "a.png", cwd: "/workspace" },
      { id: "path-b", path: "b.png", cwd: "/workspace" },
      // Both pairs become the same string if cwd and path are joined with ':'.
      { id: "colon-a", path: "frame.png", cwd: "/workspace:shots" },
      { id: "colon-b", path: "shots:frame.png", cwd: "/workspace" },
      // Both pairs become the same string if cwd and path are joined with '/'.
      { id: "slash-a", path: "shots/frame.png", cwd: "/workspace" },
      { id: "slash-b", path: "frame.png", cwd: "/workspace/shots" },
    ];
    const pending = cases.map(() => deferred<ImageRpcOutput>());
    mockLoad.mockImplementation(() => pending[mockLoad.mock.calls.length - 1]!.promise);

    mount(cases);

    expect(mockLoad).toHaveBeenCalledTimes(cases.length);
    await act(async () => {
      pending.forEach((request, index) => request.resolve({ ...firstResult, dataUri: `data:image/png;base64,${index}` }));
      await Promise.all(pending.map((request) => request.promise));
    });
  });

  it("starts a fresh read for a later mount after the previous read settles", async () => {
    mockLoad.mockResolvedValueOnce(firstResult).mockResolvedValueOnce(secondResult);

    const first = mount([{ id: "first", path: "shot.png", cwd: "/workspace" }]);
    await flushResolvedReads();
    expect(fileFor(first, "first")).toEqual(firstFile);
    unmount(first);

    const second = mount([{ id: "second", path: "shot.png", cwd: "/workspace" }]);
    await flushResolvedReads();

    expect(mockLoad).toHaveBeenCalledTimes(2);
    expect(fileFor(second, "second")).toEqual(secondFile);
  });

  it("shares a failure and retries on a new mount after it settles", async () => {
    const pending = deferred<ImageRpcOutput>();
    const failure = new Error("image read failed");
    mockLoad
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(secondResult);

    const renderer = mount([
      { id: "first", path: "shot.png", cwd: "/workspace" },
      { id: "second", path: "shot.png", cwd: "/workspace" },
    ]);
    expect(mockLoad).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.reject(failure);
      await pending.promise.catch(() => undefined);
    });
    const failedFile: ImageFile = { dataUri: null, width: null, height: null, bytes: null, error: failure.message };
    expect(fileFor(renderer, "first")).toEqual(failedFile);
    await advanceFrame();
    expect(fileFor(renderer, "second")).toEqual(failedFile);
    unmount(renderer);

    const retry = mount([{ id: "retry", path: "shot.png", cwd: "/workspace" }]);
    await flushResolvedReads();
    expect(mockLoad).toHaveBeenCalledTimes(2);
    expect(fileFor(retry, "retry")).toEqual(secondFile);
  });

  it("keeps the shared read alive when one consumer unmounts", async () => {
    const pending = deferred<ImageRpcOutput>();
    const removedConsumerRender = vi.fn();
    mockLoad.mockReturnValueOnce(pending.promise).mockReturnValueOnce(pending.promise);

    const renderer = mount([
      { id: "removed", path: "shot.png", cwd: "/workspace", onRender: removedConsumerRender },
      { id: "remaining", path: "shot.png", cwd: "/workspace" },
    ]);
    expect(mockLoad).toHaveBeenCalledTimes(1);

    update(renderer, [{ id: "remaining", path: "shot.png", cwd: "/workspace" }]);
    expect(removedConsumerRender).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(firstResult);
      await pending.promise;
    });

    await advanceFrame();
    expect(fileFor(renderer, "remaining")).toEqual(firstFile);
    expect(removedConsumerRender).toHaveBeenCalledTimes(1);
  });

  it("clears the old file on path change and ignores its later result", async () => {
    const oldRead = deferred<ImageRpcOutput>();
    const newRead = deferred<ImageRpcOutput>();
    mockLoad.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);

    const renderer = mount([{ id: "image", path: "old.png", cwd: "/workspace" }]);
    update(renderer, [{ id: "image", path: "new.png", cwd: "/workspace" }]);

    expect(mockLoad).toHaveBeenCalledTimes(2);
    expect(fileFor(renderer, "image")).toBeNull();

    await act(async () => {
      oldRead.resolve(firstResult);
      await oldRead.promise;
    });
    expect(fileFor(renderer, "image")).toBeNull();

    await act(async () => {
      newRead.resolve(secondResult);
      await newRead.promise;
    });
    expect(fileFor(renderer, "image")).toEqual(secondFile);
  });
});
