import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COPIED_MESSAGE,
  COPIED_MS,
  COPY_FAILED_MESSAGE,
  createCopyController,
} from "../../client/ui/copy-controller";

function setup(copyText: (text: string) => Promise<void> = async () => {}) {
  const states: boolean[] = [];
  const toast = { show: vi.fn(), error: vi.fn() };
  const clipboard = vi.fn(copyText);
  const controller = createCopyController({
    copyText: clipboard,
    toast,
    onCopiedChange: (copied) => states.push(copied),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  controller.activate();
  return { controller, states, toast, clipboard };
}

describe("copy controller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the check for 1.2 s and a toast after a successful icon copy", async () => {
    const { controller, states, clipboard, toast } = setup();
    await expect(controller.copy("abc")).resolves.toBe(true);
    expect(clipboard).toHaveBeenCalledWith("abc");
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(COPIED_MS - 1);
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(states).toEqual([true, false]);
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith(COPIED_MESSAGE, undefined);
  });

  it("gives any other clipboard write the same check and toast", async () => {
    const { controller, states, clipboard, toast } = setup();
    const write = vi.fn(async () => {});
    await expect(controller.copyWith(write, { label: "Copy as image" })).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(clipboard).not.toHaveBeenCalled();
    expect(states).toEqual([true]);
    expect(toast.show).toHaveBeenCalledWith(COPIED_MESSAGE, "Copy as image");
    await expect(controller.copyWith(async () => { throw new Error("denied"); })).resolves.toBe(false);
    expect(states).toEqual([true, false]);
    expect(toast.error).toHaveBeenCalledWith(COPY_FAILED_MESSAGE);
  });

  it("toasts instead of checking for toast feedback", async () => {
    const { controller, states, toast } = setup();
    await controller.copy("abc", { feedback: "toast" });
    expect(toast.show).toHaveBeenCalledWith(COPIED_MESSAGE, undefined);
    expect(states).toEqual([]);
  });

  it("hands the copy's label to the toast", async () => {
    const { controller, toast } = setup();
    await controller.copy("abc", { label: "Copy path" });
    expect(toast.show).toHaveBeenCalledWith(COPIED_MESSAGE, "Copy path");
  });

  it("toasts an error and never shows the check when copying fails", async () => {
    const { controller, states, toast } = setup(async () => {
      throw new Error("denied");
    });
    await expect(controller.copy("abc")).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledWith(COPY_FAILED_MESSAGE);
    expect(states).toEqual([false]);
    expect(states).not.toContain(true);
  });

  it("restarts the window on a second copy instead of stacking timers", async () => {
    const { controller, states } = setup();
    await controller.copy("a");
    vi.advanceTimersByTime(1000);
    await controller.copy("b");
    vi.advanceTimersByTime(1000);
    expect(states).toEqual([true, true]);
    vi.advanceTimersByTime(200);
    expect(states).toEqual([true, true, false]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer on dispose and ignores copies that resolve after it", async () => {
    let resolve: () => void = () => {};
    const { controller, states } = setup(() => new Promise<void>((r) => (resolve = r)));
    const pending = controller.copy("late");
    controller.dispose();
    resolve();
    await pending;
    expect(states).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a pending reset on dispose", async () => {
    const { controller, states } = setup();
    await controller.copy("a");
    expect(vi.getTimerCount()).toBe(1);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(COPIED_MS);
    expect(states).toEqual([true]);
  });
});
