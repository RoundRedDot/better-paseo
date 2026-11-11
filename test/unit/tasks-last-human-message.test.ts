import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
import { createLastHumanMessageStore, lastHumanMessage, lastHumanMessageVersion, useLastHumanMessage, type LastHumanMessage } from "../../client/tasks/data/last-human-message";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = { timestamp?: string; item: { type: string; text?: string } };
type Page = { error: string | null; entries: Row[]; hasOlder: boolean; startCursor: { epoch: string; seq: number } | null; reset?: boolean };

function fakeApi(pages: Page[]) {
  const refetch = vi.fn(async () => {
    const next = pages.shift();
    if (!next) throw new Error("no page");
    return next;
  });
  return { refetch, api: { agents: { ref: () => ({ timeline: { refetch } }) } } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const user = (text: string, timestamp?: string): Row => ({ timestamp, item: { type: "user_message", text } });
const reply = (text: string): Row => ({ item: { type: "assistant_message", text } });
const tool: Row = { item: { type: "tool_call" } };
const page = (entries: Row[], seq: number | null): Page => ({ error: null, entries, hasOlder: seq !== null, startCursor: seq === null ? null : { epoch: "e", seq } });

describe("last human message", () => {
  it("takes the last user message a person sent, skipping harness envelopes and blanks", () => {
    expect(lastHumanMessage([
      user("Fix it", "2026-10-25T08:00:00Z"),
      reply("Done"),
      user("  Now the tests  ", "2026-10-25T08:10:00Z"),
      user("<system-reminder>\nBe brief\n</system-reminder>"),
      user(" "),
      tool,
    ])).toEqual({ message: { state: "ready", text: "Now the tests", timestamp: "2026-10-25T08:10:00Z" }, earliest: false });
    expect(lastHumanMessage([tool, user("Fix it")])?.earliest).toBe(true);
    expect(lastHumanMessage([reply("Done"), tool])).toBeNull();
  });

  it("returns the sequence of the last human message", () => {
    expect(lastHumanMessage([{ seqStart: 7, timestamp: "2026-10-25T09:00:00Z", item: { type: "user_message", text: "Retry" } }], "e")?.message)
      .toMatchObject({ position: { epoch: "e", seq: 7 } });
  });

  it("pages back from the tail until it finds one", async () => {
    const at = "2026-10-25T09:00:00Z";
    const { api, refetch } = fakeApi([page([tool, tool, reply("Working")], 80), page([user("Fix it"), reply("Done"), user("Retry", at), tool], 40)]);
    const store = createLastHumanMessageStore(api as never);
    store.request("a", "v1");
    expect(store.read("a")).toEqual({ state: "loading" });
    await flush();
    expect(refetch).toHaveBeenNthCalledWith(1, { direction: "tail", projection: "projected", limit: 40 });
    expect(refetch).toHaveBeenNthCalledWith(2, { direction: "before", projection: "projected", limit: 40, cursor: { epoch: "e", seq: 80 } });
    expect(store.read("a")).toEqual({ state: "ready", text: "Retry", timestamp: at });
  });

  it("calls the timeline's first message the first prompt, and settles on it for the version", async () => {
    const { api, refetch } = fakeApi([page([tool, reply("Working")], 40), page([user("Fix it"), reply("Done")], null)]);
    const store = createLastHumanMessageStore(api as never);
    store.request("a", "v1");
    await flush();
    expect(store.read("a")).toEqual({ state: "first" });
    store.request("a", "v1");
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("finds none in a timeline without a person's message, and fails on a cursor that does not move back", async () => {
    const none = fakeApi([page([reply("Hi")], null)]);
    const store = createLastHumanMessageStore(none.api as never);
    store.request("a", "v1");
    await flush();
    expect(store.read("a")).toEqual({ state: "none" });

    const stuck = fakeApi([page([tool], 40), page([tool], 40)]);
    const other = createLastHumanMessageStore(stuck.api as never);
    other.request("a", "v1");
    await flush();
    expect(other.read("a")).toEqual({ state: "error" });
  });

  it("moves its version when someone sends, else with the reply's", () => {
    const timing = { updatedAt: "2026-10-22T10:00:00Z", turnStartedAt: null, lastUserMessageAt: "2026-10-22T09:59:00Z" };
    expect(lastHumanMessageVersion({ lane: "done", timing })).toBe(lastHumanMessageVersion({ lane: "done", timing: { ...timing, updatedAt: "2026-10-22T10:05:00Z" } }));
    expect(lastHumanMessageVersion({ lane: "done", timing })).not.toBe(lastHumanMessageVersion({ lane: "done", timing: { ...timing, lastUserMessageAt: "2026-10-22T10:01:00Z" } }));
    expect(lastHumanMessageVersion({ lane: "done", timing: { ...timing, lastUserMessageAt: null } })).toBe("done|2026-10-22T10:00:00Z");
  });
});

/** Reads that wait until the test answers them, in order. */
function heldReads() {
  const answers: ((page: Page | Error) => void)[] = [];
  const refetch = vi.fn(() => new Promise<Page>((resolve, reject) => {
    answers.push((next) => (next instanceof Error ? reject(next) : resolve(next)));
  }));
  const answer = async (next: Page | Error) => {
    answers.shift()!(next);
    await flush();
  };
  return { refetch, answer, api: { agents: { ref: () => ({ timeline: { refetch } }) } } };
}

describe("last human message, what a request shows at once", () => {
  type Store = ReturnType<typeof createLastHumanMessageStore>;
  type Held = ReturnType<typeof heldReads>;
  const states: [string, (store: Store, held: Held) => Promise<unknown>][] = [
    ["missing", async () => {}],
    ["loading", async (store) => store.request("a", "v1")],
    ["ready", async (store, held) => { store.request("a", "v1"); await held.answer(page([user("Retry"), user("Again")], null)); }],
    ["first", async (store, held) => { store.request("a", "v1"); await held.answer(page([user("Fix it")], null)); }],
    ["none", async (store, held) => { store.request("a", "v1"); await held.answer(page([reply("Hi")], null)); }],
    ["error", async (store, held) => { store.request("a", "v1"); await held.answer(new Error("offline")); }],
  ];
  for (const version of ["v1", "v2"]) {
    it.each(states)(`%s, request ${version}: the same object read returns after it, and nothing changes before it`, async (name, reach) => {
      const held = heldReads();
      const store = createLastHumanMessageStore(held.api as never);
      await reach(store, held);
      if (name !== "missing" && name !== "loading") expect(store.read("a").state).toBe(name);
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
    });
  }
});

describe("useLastHumanMessage", () => {
  function mount(held: ReturnType<typeof heldReads>, props: { version: string; auto: boolean }) {
    const seen: LastHumanMessage[] = [];
    function Probe(given: { version: string; auto: boolean }) {
      seen.push(useLastHumanMessage(held.api as never, "a", given.version, given.auto).prompt);
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

  it("draws a fresh read loading from its first render, keeps first for its version and reads again when someone sends", async () => {
    const held = heldReads();
    const { seen, renderer, update } = mount(held, { version: "v1", auto: true });
    expect(seen.map((read) => read.state)).toEqual(["loading"]);
    await act(async () => held.answer(page([user("Fix it")], null)));
    expect(seen.at(-1)).toEqual({ state: "first" });
    update({ version: "v1", auto: true });
    expect(seen.at(-1)).toEqual({ state: "first" });
    expect(held.refetch).toHaveBeenCalledTimes(1);
    seen.length = 0;
    update({ version: "v2", auto: true });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((read) => read.state === "loading")).toBe(true);
    await act(async () => held.answer(page([user("Fix it"), user("Now the tests")], null)));
    expect(seen.at(-1)).toMatchObject({ state: "ready", text: "Now the tests" });
    act(() => renderer.unmount());
  });
});
