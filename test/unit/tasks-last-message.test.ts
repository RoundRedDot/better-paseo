import { describe, expect, it, vi } from "vitest";
import React from "react";
import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { createLastMessageStore, createLiveLastMessageStore, lastMessageVersion, lastReplyMessage, useLastMessage, type LastMessage } from "../../client/tasks/data/last-message";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Page = { error: string | null; entries: { timestamp?: string; item: { type: string; text?: string } }[] };

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
const page = (text: string, timestamp?: string): Page => ({ error: null, entries: [{ timestamp, item: { type: "assistant_message", text } }] });

describe("last message", () => {
  it("takes the last assistant message from the timeline's tail", () => {
    expect(lastReplyMessage([
      { item: { type: "user_message", text: "Fix it" } },
      { timestamp: "2026-10-25T08:14:00Z", item: { type: "assistant_message", text: "Earlier reply" } },
      { timestamp: "2026-10-25T08:15:00Z", item: { type: "assistant_message", text: "  Done:\nall green  " } },
      { timestamp: "2026-10-25T08:16:00Z", item: { type: "assistant_message", text: " " } },
      { timestamp: "2026-10-25T08:16:30Z", item: { type: "assistant_message", text: "." } },
      { timestamp: "2026-10-25T08:17:00Z", item: { type: "tool_call" } },
    ])).toEqual({ state: "ready", text: "Done:\nall green", timestamp: "2026-10-25T08:15:00Z" });
    expect(lastReplyMessage([{ item: { type: "user_message", text: "Fix it" } }])).toBeNull();
  });

  it("retains the original sequence for a projected reply", () => {
    expect(lastReplyMessage([{ seqStart: 4, timestamp: "2026-10-25T08:00:00Z", item: { type: "assistant_message", text: "Done" } }], "e"))
      .toMatchObject({ position: { epoch: "e", seq: 4 } });
  });

  it("reads the tail once per version and keeps the older reply while a newer one loads", async () => {
    const firstAt = "2026-10-25T08:15:00Z";
    const secondAt = "2026-10-25T08:17:00Z";
    const { api, refetch } = fakeApi([page("First", firstAt), new Error("offline"), page("Second", secondAt)]);
    const store = createLastMessageStore(api as never);
    expect(store.read("a")).toEqual({ state: "idle" });

    store.request("a", "v1");
    store.request("a", "v1");
    expect(store.read("a")).toEqual({ state: "loading" });
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenLastCalledWith({ direction: "tail", projection: "projected", limit: 40 });
    expect(store.read("a")).toEqual({ state: "ready", text: "First", timestamp: firstAt });
    store.request("a", "v1");
    expect(refetch).toHaveBeenCalledTimes(1);

    store.request("a", "v2");
    expect(store.read("a")).toEqual({ state: "ready", text: "First", timestamp: firstAt });
    await flush();
    expect(store.read("a")).toEqual({ state: "error" });
    // A failure is asked again on the same version.
    store.request("a", "v2");
    await flush();
    expect(store.read("a")).toEqual({ state: "ready", text: "Second", timestamp: secondAt });
  });

  it("drops a stale read that lands after a newer one", async () => {
    let answerOld: (value: Page) => void = () => {};
    const old = new Promise<Page>((resolve) => (answerOld = resolve));
    const timestamp = "2026-10-25T08:17:00Z";
    const { api } = fakeApi([old, page("New", timestamp)]);
    const store = createLastMessageStore(api as never);
    store.request("a", "v1");
    store.request("a", "v2");
    await flush();
    expect(store.read("a")).toEqual({ state: "ready", text: "New", timestamp });
    answerOld(page("Old", "2026-10-25T08:15:00Z"));
    await flush();
    expect(store.read("a")).toEqual({ state: "ready", text: "New", timestamp });
  });

  it("moves its version on a running card's turn and on any other card's update", () => {
    const timing = { updatedAt: "2026-10-22T10:00:00Z", turnStartedAt: "2026-10-22T09:59:00Z" };
    expect(lastMessageVersion({ lane: "running", timing })).toBe(lastMessageVersion({ lane: "running", timing: { ...timing, updatedAt: "2026-10-22T10:00:05Z" } }));
    expect(lastMessageVersion({ lane: "running", timing })).not.toBe(lastMessageVersion({ lane: "running", timing: { ...timing, turnStartedAt: "2026-10-22T10:01:00Z" } }));
    expect(lastMessageVersion({ lane: "done", timing })).not.toBe(lastMessageVersion({ lane: "done", timing: { ...timing, updatedAt: "2026-10-22T10:05:00Z" } }));
  });
});

function snapshot(text: string, seq = 0, epoch = "e1", messageId = "m1") {
  return {
    ...page(text, "2026-10-31T08:00:00Z"), epoch,
    entries: [{ timestamp: "2026-10-31T08:00:00Z", seqEnd: seq, turnId: "t1", item: { type: "assistant_message", text, messageId } }],
    endCursor: { epoch, seq }, window: { nextSeq: seq + 1 },
  };
}

function liveApi(pages: unknown[], ready = Promise.resolve()) {
  const handlers = new Map<string, (event: unknown) => void>();
  const releases = new Map<string, ReturnType<typeof vi.fn>>();
  const refetch = vi.fn(async () => {
    const next = pages.shift();
    if (!next) throw new Error("no page");
    return next;
  });
  const subscribe = vi.fn((id: string, handler: (event: unknown) => void) => {
    handlers.set(id, handler);
    const release = vi.fn(() => { handlers.delete(id); });
    releases.set(id, release);
    return Object.assign(release, { ready });
  });
  const api = { agents: { ref: (id: string) => ({ timeline: { refetch, subscribe: (handler: (event: unknown) => void) => subscribe(id, handler) } }) } };
  const emit = (seq: number, text: string, options: { id?: string; epoch?: string; turnId?: string; messageId?: string | null; type?: string } = {}) => {
    const id = options.id ?? "a";
    handlers.get(id)?.({ agentId: id, epoch: options.epoch ?? "e1", seq, timestamp: "2026-10-31T08:00:01Z",
      event: { type: "timeline", provider: "codex", turnId: options.turnId ?? "t1", item: { type: options.type ?? "assistant_message", text, messageId: options.messageId === null ? undefined : options.messageId ?? "m1" } } });
  };
  const event = (type: string, id = "a") => handlers.get(id)?.({ agentId: id, event: { type } });
  return { api, refetch, subscribe, releases, emit, event };
}

describe("streaming last reply", () => {
  it("shows a running parent's cached reply while reconnecting after visiting a child", async () => {
    let finish!: (value: unknown) => void;
    const live = liveApi([snapshot("Parent"), snapshot("Child"), new Promise((resolve) => { finish = resolve; })]);
    const seen: Record<string, LastMessage[]> = {};
    function Probe(props: { id: string }) {
      const reply = useLastMessage(live.api as never, props.id, "v1", true, true).prompt;
      (seen[props.id] ??= []).push(reply);
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { id: "parent" })); });
    await act(async () => renderer.update(React.createElement(Probe, { id: "child" })));
    seen.parent = [];
    await act(async () => renderer.update(React.createElement(Probe, { id: "parent" })));
    expect(seen.parent!.length).toBeGreaterThan(0);
    expect(seen.parent!.every((value) => value.state === "ready" && value.text === "Parent")).toBe(true);
    expect(live.refetch).toHaveBeenCalledTimes(3);
    await act(async () => { finish(snapshot("Parent updated", 1)); await flush(); });
    expect(seen.parent!.at(-1)).toMatchObject({ state: "ready", text: "Parent updated" });
    act(() => renderer.unmount());
  });
  it("keeps a cached empty result during a forced refresh and reports failures", async () => {
    let answer!: (value: unknown) => void;
    const empty = { ...snapshot("x"), entries: [] };
    const live = liveApi([empty, new Promise((resolve) => { answer = resolve; })]);
    const store = createLiveLastMessageStore(live.api as never);
    const release = store.watch("a");
    store.request("a", "v1");
    await flush();
    expect(store.read("a")).toEqual({ state: "none" });
    store.request("a", "v1", true);
    expect(store.read("a")).toEqual({ state: "none" });
    answer({ ...empty, error: "offline" });
    await flush();
    expect(store.read("a")).toEqual({ state: "error" });
    release();
  });
  it("keeps the reply start through chunks and advances only for real new text", async () => {
    const initial = snapshot("Old", 2);
    Object.assign(initial.entries[0]!, { seqStart: 1 });
    const live = liveApi([initial]);
    const store = createLiveLastMessageStore(live.api as never);
    const release = store.watch("a");
    store.request("a", "v1");
    await flush();
    expect(store.read("a")).toMatchObject({ position: { epoch: "e1", seq: 1 } });
    live.emit(3, " more");
    expect(store.read("a")).toMatchObject({ text: "Old more", position: { epoch: "e1", seq: 1 } });
    live.emit(4, ".", { messageId: "m2" });
    expect(store.read("a")).toMatchObject({ text: "Old more", position: { epoch: "e1", seq: 1 } });
    live.emit(5, "New", { messageId: "m2" });
    expect(store.read("a")).toMatchObject({ position: { epoch: "e1", seq: 4 } });
    release();
  });

  it("appends each chunk immediately, preserves whitespace, and ignores duplicate rows without refetching", async () => {
    const live = liveApi([snapshot("Hello ")]);
    const store = createLiveLastMessageStore(live.api as never);
    const release = store.watch("a");
    store.request("a", "v1");
    await flush();
    live.emit(1, "**wor", { messageId: null });
    expect(store.read("a")).toMatchObject({ text: "Hello **wor" });
    live.emit(2, "ld**");
    live.emit(2, "ld**");
    expect(store.read("a")).toMatchObject({ text: "Hello **world**" });
    expect(live.refetch).toHaveBeenCalledTimes(1);
    release();
    expect(live.releases.get("a")).toHaveBeenCalledOnce();
  });

  it("keeps the previous reply when omp streams its single-dot filler", async () => {
    const live = liveApi([snapshot("Earlier reply")]);
    const store = createLiveLastMessageStore(live.api as never);
    const release = store.watch("a");
    store.request("a", "v1");
    await flush();
    live.emit(1, ".", { messageId: "m2" });
    expect(store.read("a")).toMatchObject({ text: "Earlier reply" });
    release();
  });

  it("replays chunks arriving during bootstrap exactly once", async () => {
    let resolve!: (value: unknown) => void;
    const live = liveApi([new Promise((done) => { resolve = done; })]);
    const store = createLiveLastMessageStore(live.api as never);
    const release = store.watch("a");
    store.request("a", "v1");
    live.emit(1, "B");
    live.emit(2, "C");
    resolve(snapshot("AB", 1));
    await flush();
    expect(store.read("a")).toMatchObject({ text: "ABC" });
    release();
  });

  it("does not join replies across intervening canonical rows collapsed into an earlier projected row", async () => {
    const projected = snapshot("Earlier reply", 3);
    projected.entries[0]!.seqEnd = 1;
    const live = liveApi([projected]);
    const store = createLiveLastMessageStore(live.api as never);
    const release = store.watch("a");
    store.request("a", "v1");
    await flush();
    live.emit(4, "New reply");
    expect(store.read("a")).toMatchObject({ text: "New reply" });
    release();
  });

  it("starts a new reply across tools, message identities and turns", async () => {
    const live = liveApi([snapshot("Old")]);
    const store = createLiveLastMessageStore(live.api as never);
    const release = store.watch("a");
    store.request("a", "v1");
    await flush();
    live.emit(1, "", { type: "tool_call" });
    live.emit(2, "New");
    expect(store.read("a")).toMatchObject({ text: "New" });
    live.emit(3, "Other", { messageId: "m2" });
    expect(store.read("a")).toMatchObject({ text: "Other" });
    live.emit(4, "Next turn", { turnId: "t2" });
    expect(store.read("a")).toMatchObject({ text: "Next turn" });
    release();
  });

  it("reconciles missed rows on reconnect, replacement and turn completion", async () => {
    const live = liveApi([snapshot("A"), snapshot("ABC", 2), snapshot("Replacement", 0, "e2"), snapshot("Final", 1, "e2")]);
    const store = createLiveLastMessageStore(live.api as never);
    const release = store.watch("a");
    store.request("a", "v1");
    await flush();
    live.event("subscription_restored");
    await flush();
    expect(store.read("a")).toMatchObject({ text: "ABC" });
    live.event("replacement");
    await flush();
    expect(store.read("a")).toMatchObject({ text: "Replacement" });
    live.event("turn_completed");
    await flush();
    expect(store.read("a")).toMatchObject({ text: "Final" });
    release();
  });

  it("repairs sequence gaps and ignores a stale snapshot after a newer request", async () => {
    let resolve!: (value: unknown) => void;
    const live = liveApi([snapshot("A"), new Promise((done) => { resolve = done; }), snapshot("Newest", 4)]);
    const store = createLiveLastMessageStore(live.api as never);
    const release = store.watch("a");
    store.request("a", "v1");
    await flush();
    live.emit(3, "D");
    store.request("a", "v2");
    await flush();
    resolve(snapshot("ABCD", 3));
    await flush();
    expect(store.read("a")).toMatchObject({ text: "Newest" });
    release();
  });

  it("shares a subscription and releases it when the last observer leaves", () => {
    const live = liveApi([]);
    const store = createLiveLastMessageStore(live.api as never);
    const first = store.watch("a");
    const second = store.watch("a");
    expect(live.subscribe).toHaveBeenCalledOnce();
    first();
    expect(live.releases.get("a")).not.toHaveBeenCalled();
    second();
    expect(live.releases.get("a")).toHaveBeenCalledOnce();
  });

  it("switches the hook's task without leaking text or subscriptions and stops when hidden", async () => {
    const live = liveApi([snapshot("Task A"), snapshot("Task B")]);
    const seen: unknown[] = [];
    function Probe(props: { id: string; visible: boolean }) {
      seen.push(useLastMessage(live.api as never, props.id, "v1", true, props.visible).prompt);
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { id: "a", visible: true })); });
    await act(async () => { live.emit(1, " streaming"); });
    expect(seen.at(-1)).toMatchObject({ text: "Task A streaming" });
    await act(async () => { renderer.update(React.createElement(Probe, { id: "b", visible: true })); });
    expect(seen.at(-1)).toMatchObject({ text: "Task B" });
    expect(live.releases.get("a")).toHaveBeenCalledOnce();
    await act(async () => { renderer.update(React.createElement(Probe, { id: "b", visible: false })); });
    expect(live.releases.get("b")).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
  });

  it("waits for subscription readiness and refreshes a reopened running reply", async () => {
    let resolve!: () => void;
    const live = liveApi([snapshot("Before"), snapshot("While hidden", 3)], new Promise<void>((done) => { resolve = done; }));
    let latest: unknown;
    function Probe(props: { visible: boolean }) {
      latest = useLastMessage(live.api as never, "a", "v1", true, props.visible).prompt;
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { visible: true })); });
    expect(live.refetch).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(latest).toMatchObject({ text: "Before" });
    await act(async () => renderer.update(React.createElement(Probe, { visible: false })));
    await act(async () => renderer.update(React.createElement(Probe, { visible: true })));
    expect(latest).toMatchObject({ text: "While hidden" });
    act(() => renderer.unmount());
  });
});

/** Reads that wait until the test answers them, in order. */
function heldReads(live = false) {
  const answers: ((page: unknown) => void)[] = [];
  const refetch = vi.fn(() => new Promise((resolve, reject) => {
    answers.push((next) => (next instanceof Error ? reject(next) : resolve(next)));
  }));
  const answer = async (next: unknown) => {
    answers.shift()!(next);
    await flush();
  };
  const subscribe = () => Object.assign(() => {}, { ready: Promise.resolve() });
  return { refetch, answer, api: { agents: { ref: () => ({ timeline: live ? { refetch, subscribe } : { refetch } }) } } };
}

type Held = ReturnType<typeof heldReads>;
type ReadStore = { read(id: string): unknown; readRequested(id: string, version: string): unknown; request(id: string, version: string): void; subscribe(listener: () => void): () => void };

/** Each state a store can hold for "a" at version v1. */
const versionedStates: [string, (store: ReadStore, held: Held) => Promise<unknown>][] = [
  ["missing", async () => {}],
  ["loading", async (store) => store.request("a", "v1")],
  ["ready", async (store, held) => { store.request("a", "v1"); await held.answer(snapshot("Reply")); }],
  ["none", async (store, held) => { store.request("a", "v1"); await held.answer({ ...snapshot("x"), entries: [] }); }],
  ["error", async (store, held) => { store.request("a", "v1"); await held.answer(new Error("offline")); }],
];

/** `readRequested` changes nothing, and `request` then shows that very object. */
async function expectRequestShows(make: (held: Held) => ReadStore, reach: (store: ReadStore, held: Held) => Promise<unknown>, version: string) {
  const held = heldReads(true);
  const store = make(held);
  await reach(store, held);
  const listener = vi.fn();
  store.subscribe(listener);
  const read = store.read("a");
  const calls = held.refetch.mock.calls.length;
  const shown = store.readRequested("a", version);
  expect(store.read("a")).toBe(read);
  expect(held.refetch).toHaveBeenCalledTimes(calls);
  expect(listener).not.toHaveBeenCalled();
  store.request("a", version);
  expect(store.read("a")).toBe(shown);
  return shown;
}

describe("last message, what a request shows at once", () => {
  it.each(["versioned", "live"] as const)("deduplicates a %s empty result's in-flight refresh", async (kind) => {
    const held = heldReads(true);
    const store = kind === "live" ? createLiveLastMessageStore(held.api as never) : createLastMessageStore(held.api as never);
    store.request("a", "v1");
    await held.answer({ ...snapshot("x"), entries: [] });
    store.request("a", "v1");
    store.request("a", "v1");
    expect(store.read("a")).toEqual({ state: "none" });
    expect(held.refetch).toHaveBeenCalledTimes(2);
    await held.answer(snapshot("New"));
    expect(store.read("a")).toMatchObject({ state: "ready", text: "New" });
  });
  for (const version of ["v1", "v2"]) {
    it.each(versionedStates)(`versioned store, %s, request ${version}`, async (_name, reach) => {
      await expectRequestShows((held) => createLastMessageStore(held.api as never), reach, version);
    });
    it.each(versionedStates)(`live store read once, %s, request ${version}`, async (_name, reach) => {
      await expectRequestShows((held) => createLiveLastMessageStore(held.api as never), reach, version);
    });
  }

  it("keeps an older reply up for a new version, and shows loading for a first read", async () => {
    expect(await expectRequestShows((held) => createLastMessageStore(held.api as never), versionedStates[2]![1], "v2")).toMatchObject({ state: "ready", text: "Reply" });
    expect(await expectRequestShows((held) => createLastMessageStore(held.api as never), versionedStates[0]![1], "v1")).toEqual({ state: "loading" });
    expect(await expectRequestShows((held) => createLastMessageStore(held.api as never), versionedStates[4]![1], "v1")).toEqual({ state: "loading" });
  });
});

describe("useLastMessage, read once", () => {
  function mount(held: Held, props: { version: string; auto: boolean; live?: boolean }) {
    const seen: LastMessage[] = [];
    function Probe(given: { version: string; auto: boolean; live?: boolean }) {
      seen.push(useLastMessage(held.api as never, "a", given.version, given.auto, given.live).prompt);
      return null;
    }
    let renderer!: ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(Probe, props)); });
    return { seen, renderer, update: (next: typeof props) => act(() => { renderer.update(React.createElement(Probe, next)); }) };
  }

  it("waits for load() when not auto", () => {
    const held = heldReads();
    const { seen, renderer } = mount(held, { version: "v1", auto: false });
    expect(seen.map((read) => read.state)).toEqual(["idle"]);
    expect(held.refetch).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("draws a fresh read loading from its first render, keeps an error on screen, and asks again for a new version", async () => {
    const held = heldReads();
    const { seen, renderer, update } = mount(held, { version: "v1", auto: true });
    expect(seen.map((read) => read.state)).toEqual(["loading"]);
    await act(async () => held.answer(new Error("offline")));
    expect(seen.at(-1)).toEqual({ state: "error" });
    seen.length = 0;
    update({ version: "v2", auto: true });
    // Already subscribed, React compares the request's news against the last committed error and draws again;
    // no render shows that error for the new version.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((read) => read.state === "loading")).toBe(true);
    expect(held.refetch).toHaveBeenCalledTimes(2);
    await act(async () => held.answer(snapshot("Reply")));
    expect(seen.at(-1)).toMatchObject({ state: "ready", text: "Reply" });
    // A newer version keeps the reply up while the tail is read again.
    seen.length = 0;
    update({ version: "v3", auto: true });
    expect(seen.map((read) => read.state)).toEqual(["ready"]);
    expect(held.refetch).toHaveBeenCalledTimes(3);
    await act(async () => held.answer(snapshot("Newer")));
    expect(seen.at(-1)).toMatchObject({ state: "ready", text: "Newer" });
    // The same version again reads nothing.
    update({ version: "v3", auto: true });
    expect(held.refetch).toHaveBeenCalledTimes(3);
    act(() => renderer.unmount());
  });

  it("does not project a live reply: it shows what is held until its subscription is ready", async () => {
    const held = heldReads(true);
    const { seen, renderer } = mount(held, { version: "v1", auto: true, live: true });
    expect(seen.map((read) => read.state)).toEqual(["idle"]);
    expect(held.refetch).not.toHaveBeenCalled();
    await act(async () => { await flush(); });
    expect(held.refetch).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)!.state).toBe("loading");
    act(() => renderer.unmount());
  });
});
