import { afterEach, describe, expect, it, vi } from "vitest";
import { createTitleUpdateControl } from "../../client/tasks/actions/title-update";
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
