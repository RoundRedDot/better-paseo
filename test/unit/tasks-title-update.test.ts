import { afterEach, describe, expect, it, vi } from "vitest";
import { createTitleUpdateControl, watchReply } from "../../client/tasks/actions/title-update";
import type { TitleUpdateState } from "../../shared/title-generation";

afterEach(() => vi.useRealTimers());

describe("title update state", () => {
  it("shows pending immediately, deduplicates clicks, polls until done and notifies observers", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async (): Promise<TitleUpdateState> => ({ state: "running" }));
    call.mockResolvedValueOnce({ state: "running" }).mockResolvedValueOnce({ state: "done", title: "Updated" });
    const control = createTitleUpdateControl(call);
    const listener = vi.fn();
    const unsubscribe = control.subscribe(listener);
    control.start("a");
    control.start("a");
    expect(control.read("a")).toEqual({ state: "running" });
    expect(control.read("other")).toEqual({ state: "idle" });
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.read("a")).toEqual({ state: "done", title: "Updated" });
    expect(call.mock.calls).toEqual([[{ agentId: "a", action: "start" }], [{ agentId: "a", action: "status" }]]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("streams the title as the helper's chunks arrive and stops watching once it settles", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async (): Promise<TitleUpdateState> => ({ state: "running" }));
    call.mockResolvedValueOnce({ state: "running", helperId: "helper" })
      .mockResolvedValueOnce({ state: "running", helperId: "helper", text: "Updated" })
      .mockResolvedValueOnce({ state: "running", helperId: "helper", text: "Updated title" })
      .mockResolvedValueOnce({ state: "done", title: "Updated title" });
    const unwatch = vi.fn();
    let chunk!: () => void;
    const watch = vi.fn((_helperId: string, onChunk: () => void) => { chunk = onChunk; return unwatch; });
    const control = createTitleUpdateControl(call, watch);
    control.start("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(watch).toHaveBeenCalledExactlyOnceWith("helper", expect.any(Function));
    // A chunk asks at once rather than at the next poll.
    chunk();
    await vi.advanceTimersByTimeAsync(0);
    expect(control.read("a")).toEqual({ state: "running", helperId: "helper", text: "Updated" });
    chunk();
    await vi.advanceTimersByTimeAsync(0);
    expect(control.read("a")).toMatchObject({ text: "Updated title" });
    expect(call).toHaveBeenCalledTimes(3);
    // The poll still settles it when no chunk comes.
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.read("a")).toEqual({ state: "done", title: "Updated title" });
    expect(watch).toHaveBeenCalledTimes(1);
    expect(unwatch).toHaveBeenCalledTimes(1);
    // The card clears the result once its own title shows the rename.
    control.dismiss("a");
    expect(control.read("a")).toEqual({ state: "idle" });
  });

  it("coalesces chunks that arrive during a status call into one more call", async () => {
    vi.useFakeTimers();
    let answer!: (state: TitleUpdateState) => void;
    const call = vi.fn((): Promise<TitleUpdateState> => new Promise((resolve) => { answer = resolve; }));
    let chunk!: () => void;
    const control = createTitleUpdateControl(call, (_id, onChunk) => { chunk = onChunk; return () => {}; });
    control.start("a");
    answer({ state: "running", helperId: "helper" });
    await vi.advanceTimersByTimeAsync(0);
    chunk();
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toHaveBeenCalledTimes(2);
    chunk();
    chunk();
    answer({ state: "running", helperId: "helper", text: "Up" });
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("counts a helper's reply chunks and reconnects as chunks", () => {
    let handler!: (event: unknown) => void;
    const unsubscribe = vi.fn();
    const api = { agents: { ref: vi.fn(() => ({ timeline: { subscribe: (next: (event: unknown) => void) => { handler = next; return unsubscribe; } } })) } };
    const onChunk = vi.fn();
    const stop = watchReply(api as never, "helper", onChunk);
    expect(api.agents.ref).toHaveBeenCalledWith("helper");
    handler({ agentId: "helper", event: { type: "timeline", item: { type: "reasoning", text: "…" } } });
    handler({ agentId: "helper", event: { type: "timeline", item: { type: "assistant_message", text: "Up" } } });
    handler({ agentId: "helper", subscriptionId: "s", event: { type: "subscription_restored" } });
    expect(onChunk).toHaveBeenCalledTimes(2);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("retains a visible error and permits retry while keeping hosts separate", async () => {
    const call = vi.fn(async (): Promise<TitleUpdateState> => ({ state: "done", title: "Updated" }));
    call.mockRejectedValueOnce(new Error("Disconnected"));
    const firstHost = createTitleUpdateControl(call);
    const secondHost = createTitleUpdateControl(call);
    firstHost.start("same-id");
    await vi.waitFor(() => expect(firstHost.read("same-id")).toEqual({ state: "error", error: expect.stringContaining("Disconnected") }));
    expect(secondHost.read("same-id")).toEqual({ state: "idle" });
    firstHost.start("same-id");
    await vi.waitFor(() => expect(firstHost.read("same-id")).toEqual({ state: "done", title: "Updated" }));
    expect(call).toHaveBeenLastCalledWith({ agentId: "same-id", action: "status" });
  });

  it("reports a server restart instead of spinning forever", async () => {
    const control = createTitleUpdateControl(async () => ({ state: "idle" }));
    control.start("a");
    await vi.waitFor(() => expect(control.read("a")).toEqual({ state: "error", error: "The title generation task was lost. Please retry." }));
  });

  it("keeps pending through a transient polling error, then clears it on success", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async (): Promise<TitleUpdateState> => ({ state: "running" }));
    call.mockResolvedValueOnce({ state: "running" }).mockRejectedValueOnce(new Error("Reconnecting"))
      .mockResolvedValueOnce({ state: "done", title: "Updated" });
    const control = createTitleUpdateControl(call);
    control.start("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.read("a")).toEqual({ state: "running" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.read("a")).toEqual({ state: "done", title: "Updated" });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("allows dismissing an error without losing the ability to reconnect to the existing job", async () => {
    const call = vi.fn(async (): Promise<TitleUpdateState> => ({ state: "done", title: "Updated" }));
    call.mockRejectedValueOnce(new Error("Disconnected"));
    const control = createTitleUpdateControl(call);
    control.start("a");
    await vi.waitFor(() => expect(control.read("a").state).toBe("error"));
    control.dismiss("a");
    expect(control.read("a")).toEqual({ state: "idle" });
    control.start("a");
    await vi.waitFor(() => expect(control.read("a")).toEqual({ state: "done", title: "Updated" }));
    expect(call).toHaveBeenLastCalledWith({ agentId: "a", action: "status" });
  });
});
