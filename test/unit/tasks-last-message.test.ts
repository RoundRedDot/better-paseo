import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { LIVE_READ_MS, createLastMessageStore, lastMessageVersion, lastReplyMessage, useLiveReplyCount } from "../../client/tasks/data/last-message";

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
      { timestamp: "2026-10-25T08:17:00Z", item: { type: "tool_call" } },
    ])).toEqual({ state: "ready", text: "Done:\nall green", timestamp: "2026-10-25T08:15:00Z" });
    expect(lastReplyMessage([{ item: { type: "user_message", text: "Fix it" } }])).toBeNull();
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

describe("live reply count", () => {
  let renderer: ReactTestRenderer | null = null;
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    vi.useRealTimers();
  });

  function liveApi() {
    let handler: ((event: unknown) => void) | null = null;
    const unsubscribe = vi.fn(() => {
      handler = null;
    });
    const subscribe = vi.fn((next: (event: unknown) => void) => {
      handler = next;
      return Object.assign(unsubscribe, { ready: Promise.resolve() });
    });
    const emit = (event: Record<string, unknown>) => act(() => handler?.({ agentId: "a", event }));
    return { api: { agents: { ref: () => ({ timeline: { subscribe } }) } }, subscribe, unsubscribe, emit };
  }

  function Probe(props: { api: unknown; agentId: string; live: boolean; seen: number[] }) {
    props.seen.push(useLiveReplyCount(props.api as never, props.agentId, props.live));
    return null;
  }

  it("counts a running turn's reply chunks at most once per interval and lets go when not live", () => {
    vi.useFakeTimers();
    const { api, subscribe, unsubscribe, emit } = liveApi();
    const seen: number[] = [];
    const probe = (live: boolean) => React.createElement(Probe, { api, agentId: "a", live, seen });
    act(() => {
      renderer = TestRenderer.create(probe(false));
    });
    expect(subscribe).not.toHaveBeenCalled();

    act(() => renderer!.update(probe(true)));
    expect(subscribe).toHaveBeenCalledTimes(1);
    const reply = { type: "timeline", provider: "codex", item: { type: "assistant_message", text: "Rea" } };
    // A tool call does not move the reply.
    emit({ type: "timeline", provider: "codex", item: { type: "tool_call" } });
    act(() => { vi.advanceTimersByTime(LIVE_READ_MS); });
    expect(seen.at(-1)).toBe(0);

    emit(reply);
    act(() => { vi.advanceTimersByTime(0); });
    expect(seen.at(-1)).toBe(1);
    // Chunks right after wait out the interval, then count once.
    emit(reply);
    emit(reply);
    act(() => { vi.advanceTimersByTime(LIVE_READ_MS - 1); });
    expect(seen.at(-1)).toBe(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(seen.at(-1)).toBe(2);
    // A reconnect may have missed chunks.
    emit({ type: "subscription_restored" });
    act(() => { vi.advanceTimersByTime(LIVE_READ_MS); });
    expect(seen.at(-1)).toBe(3);

    act(() => renderer!.update(probe(false)));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
