/**
 * A provider subagent's prompt and latest reply for its details: the agent
 * stores, read through the plugin server's `tasks.subagent-timeline`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import "./helpers/quiet-renderer";
import TestRenderer, { act } from "react-test-renderer";
import { setSubagentTimelineLoader, useSubagentTimeline } from "../../client/tasks/data/subagent-timeline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Reads = ReturnType<typeof useSubagentTimeline>;

function Probe(props: { id: string; running: boolean; version: string; auto: boolean; out: { current: Reads | null } }) {
  props.out.current = useSubagentTimeline({ id: props.id, parentId: "parent-1", running: props.running, version: props.version }, props.auto);
  return null;
}

afterEach(() => {
  setSubagentTimelineLoader(null);
  vi.useRealTimers();
});

describe("useSubagentTimeline", () => {
  it("reads the task from the head and the reply from the tail, naming the parent", async () => {
    const loader = vi.fn(async (input: { direction: "after" | "tail" }) =>
      input.direction === "after"
        ? { rows: [{ type: "user_message", text: " Verify the fix on the Mac Studio ", timestamp: "2026-10-25T08:13:00Z" }, { type: "tool_call" }], error: null }
        : { rows: [{ type: "assistant_message", text: "Round 1 passed" }, { type: "reasoning", text: "thinking" }, { type: "assistant_message", text: "All five rounds passed", timestamp: "2026-10-25T08:15:00Z" }, { type: "tool_call", timestamp: "2026-10-25T08:16:00Z" }], error: null },
    );
    setSubagentTimelineLoader(loader);
    const out: { current: Reads | null } = { current: null };
    await act(async () => {
      TestRenderer.create(<Probe id="toolu_a" running={false} version="failed|1" auto out={out} />);
    });
    expect(out.current!.firstPrompt.prompt).toEqual({ state: "ready", text: "Verify the fix on the Mac Studio", timestamp: "2026-10-25T08:13:00Z" });
    expect(out.current!.lastMessage.prompt).toEqual({ state: "ready", text: "All five rounds passed", timestamp: "2026-10-25T08:15:00Z" });
    expect(loader).toHaveBeenCalledWith({ parentAgentId: "parent-1", subagentId: "toolu_a", direction: "after", limit: 8 });
    expect(loader).toHaveBeenCalledWith({ parentAgentId: "parent-1", subagentId: "toolu_a", direction: "tail", limit: 40 });
  });

  it("says what the server could not read, and reads nothing while not shown", async () => {
    const loader = vi.fn(async () => ({ rows: [], error: "Could not reach the Paseo daemon." }));
    setSubagentTimelineLoader(loader);
    const out: { current: Reads | null } = { current: null };
    await act(async () => {
      TestRenderer.create(<Probe id="toolu_hidden" running={false} version="x" auto={false} out={out} />);
    });
    expect(loader).not.toHaveBeenCalled();
    expect(out.current!.firstPrompt.prompt).toEqual({ state: "idle" });
    await act(async () => {
      TestRenderer.create(<Probe id="toolu_b" running={false} version="x" auto out={out} />);
    });
    expect(out.current!.firstPrompt.prompt).toEqual({ state: "error" });
    expect(out.current!.lastMessage.prompt).toEqual({ state: "error" });
  });

  it("reads a running subagent's reply again every 15 s, keeping the last one meanwhile", async () => {
    vi.useFakeTimers();
    let reply = "Started round 1";
    const loader = vi.fn(async (input: { direction: "after" | "tail" }) => ({
      rows: input.direction === "after" ? [{ type: "user_message", text: "Run five rounds" }] : [{ type: "assistant_message", text: reply }],
      error: null,
    }));
    setSubagentTimelineLoader(loader);
    const out: { current: Reads | null } = { current: null };
    await act(async () => {
      TestRenderer.create(<Probe id="toolu_c" running version="running|1" auto out={out} />);
    });
    expect(out.current!.lastMessage.prompt).toEqual({ state: "ready", text: "Started round 1" });
    reply = "Round 3 of 5";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(out.current!.lastMessage.prompt).toEqual({ state: "ready", text: "Round 3 of 5" });
    // The head is read once.
    expect(loader.mock.calls.filter(([input]) => input.direction === "after")).toHaveLength(1);
  });
});
