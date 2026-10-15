/**
 * A preview survives its row's remount only through a quick handover: the old
 * row lets go and a new one with the same key takes it within
 * `PREVIEW_HANDOVER_MS`. Closing it, or waiting longer, leaves nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPreview, holdPreview, PREVIEW_HANDOVER_MS, recallPreview, rememberPreview } from "../../client/ui/preview-memory";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("preview memory", () => {
  it("hands an open preview over to the next row within the handover window", () => {
    expect(recallPreview("a")).toBeNull();
    const release = holdPreview("a");
    rememberPreview("a", { offset: 120, tail: false, wrap: false, maximized: true });
    release();
    vi.advanceTimersByTime(PREVIEW_HANDOVER_MS);
    expect(recallPreview("a")).toMatchObject({ offset: 120, tail: false, wrap: false, maximized: true, box: null });
    vi.advanceTimersByTime(1);
    expect(recallPreview("a")).toBeNull();
  });

  it("stays held while a newer row holds it, whatever order the rows mount and go in", () => {
    const old = holdPreview("b");
    const next = holdPreview("b");
    old();
    old();
    vi.advanceTimersByTime(PREVIEW_HANDOVER_MS * 10);
    expect(recallPreview("b")).not.toBeNull();
    next();
    vi.advanceTimersByTime(PREVIEW_HANDOVER_MS + 1);
    expect(recallPreview("b")).toBeNull();
  });

  it("forgets a preview the reader closed, and ignores state for one nobody opened", () => {
    holdPreview("c");
    forgetPreview("c");
    expect(recallPreview("c")).toBeNull();
    rememberPreview("d", { offset: 5 });
    expect(recallPreview("d")).toBeNull();
  });
});
