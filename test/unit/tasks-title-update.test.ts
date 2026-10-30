import { afterEach, describe, expect, it, vi } from "vitest";
import { createTitleUpdateControl, watchReply } from "../../client/tasks/actions/title-update";
import type { TitleUpdateState } from "../../shared/title-generation";

afterEach(() => vi.useRealTimers());

describe("title update state", () => {
  it("holds the card through completion until its reveal finishes, without changing the hold on chunks", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async (): Promise<TitleUpdateState> => ({ state: "running" }));
    call.mockResolvedValueOnce({ state: "running", text: "Up" })
      .mockResolvedValueOnce({ state: "done", title: "Updated title" });
    const control = createTitleUpdateControl(call);
    control.start("a");
    const revealing = control.revealing();
    expect(revealing.has("a")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(control.revealing()).toBe(revealing);
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.read("a").state).toBe("done");
    expect(control.revealing()).toBe(revealing);
    control.finishReveal("a");
    expect(control.revealing().has("a")).toBe(false);
    expect(control.read("a")).toEqual({ state: "done", title: "Updated title" });
  });

  it("releases only the failed card while another title is still being generated", async () => {
    const control = createTitleUpdateControl(async ({ agentId }) => agentId === "a" ? { state: "error", error: "Failed" } : new Promise(() => {}));
    control.start("a");
    control.start("b");
    await vi.waitFor(() => expect(control.read("a").state).toBe("error"));
    expect([...control.revealing()]).toEqual(["b"]);
  });

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

describe("following a title the daemon started", () => {
  it("asks until the job runs, then sweeps and holds the card as after a click", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async (_input: { agentId: string; action: string }): Promise<TitleUpdateState> => ({ state: "idle" }));
    call.mockResolvedValueOnce({ state: "idle" })
      .mockResolvedValueOnce({ state: "running", helperId: "helper" })
      .mockResolvedValueOnce({ state: "running", helperId: "helper", text: "Auto" })
      .mockResolvedValueOnce({ state: "done", title: "Auto title" });
    const watch = vi.fn(() => () => {});
    const control = createTitleUpdateControl(call, watch);
    control.attach("a");
    control.attach("a");
    await vi.advanceTimersByTimeAsync(0);
    // Not running yet: the card is left as it is.
    expect(control.read("a")).toEqual({ state: "idle" });
    expect(control.revealing().has("a")).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.read("a")).toMatchObject({ state: "running" });
    expect(control.revealing().has("a")).toBe(true);
    expect(watch).toHaveBeenCalledExactlyOnceWith("helper", expect.any(Function));
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.read("a")).toMatchObject({ state: "running", text: "Auto" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.read("a")).toEqual({ state: "done", title: "Auto title" });
    expect(control.revealing().has("a")).toBe(true);
    control.finishReveal("a");
    expect(control.revealing().has("a")).toBe(false);
    expect(call.mock.calls.every(([input]) => input.action === "status")).toBe(true);
  });

  it("starts the asks over when the board asks again while it waits", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async (): Promise<TitleUpdateState> => ({ state: "idle" }));
    const control = createTitleUpdateControl(call);
    // An early follow (a stale snapshot at creation) is still waiting when the turn really ends.
    control.attach("a");
    await vi.advanceTimersByTimeAsync(3500);
    expect(call).toHaveBeenCalledTimes(4);
    control.attach("a");
    for (let index = 0; index < 3; index++) call.mockResolvedValueOnce({ state: "idle" });
    call.mockResolvedValueOnce({ state: "running" });
    await vi.advanceTimersByTimeAsync(4000);
    expect(call).toHaveBeenCalledTimes(8);
    expect(control.read("a")).toEqual({ state: "running" });
    expect(control.revealing().has("a")).toBe(true);
  });

  it.each([
    ["no job", { state: "idle" }],
    ["an earlier job's title", { state: "done", title: "Old title" }],
    ["an earlier job's error", { state: "error", error: "Old failure" }],
  ] as const)("gives up quietly on %s", async (_name, answer) => {
    vi.useFakeTimers();
    const call = vi.fn(async (): Promise<TitleUpdateState> => answer);
    const control = createTitleUpdateControl(call);
    const listener = vi.fn();
    control.subscribe(listener);
    control.attach("a");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(call).toHaveBeenCalledTimes(5);
    expect(control.read("a")).toEqual({ state: "idle" });
    expect(control.revealing().size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ["fails", { state: "error", error: "Provider failed" }],
    ["is lost", { state: "idle" }],
  ] as const)("keeps the card's title without an error when the job %s", async (_name, end) => {
    vi.useFakeTimers();
    const call = vi.fn(async (): Promise<TitleUpdateState> => end);
    call.mockResolvedValueOnce({ state: "running" });
    const control = createTitleUpdateControl(call);
    control.attach("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(control.revealing().has("a")).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.read("a")).toEqual({ state: "idle" });
    expect(control.revealing().size).toBe(0);
  });

  it("keeps quiet through a lost connection", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async (): Promise<TitleUpdateState> => { throw new Error("Disconnected"); });
    call.mockResolvedValueOnce({ state: "running" });
    const control = createTitleUpdateControl(call);
    control.attach("a");
    await vi.advanceTimersByTimeAsync(5000);
    expect(control.read("a")).toEqual({ state: "idle" });
  });

  it("shows the error of a followed job once the user clicks it", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async (): Promise<TitleUpdateState> => ({ state: "error", error: "Provider failed" }));
    call.mockResolvedValueOnce({ state: "running" });
    const control = createTitleUpdateControl(call);
    control.attach("a");
    await vi.advanceTimersByTimeAsync(0);
    control.start("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.read("a")).toEqual({ state: "error", error: "Provider failed" });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("leaves a click's own job to the click", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async (): Promise<TitleUpdateState> => ({ state: "running" }));
    const control = createTitleUpdateControl(call);
    control.start("a");
    control.attach("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(call.mock.calls).toEqual([[{ agentId: "a", action: "start" }]]);
  });
});
