import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DETAILS_BREAKPOINTS,
  createResizeSettle,
  detailsForm,
  floatingWidth,
  sidePanelWidth,
} from "../../client/details/layout-model";
import type { LayoutInput } from "../../client/details/contracts";

const input = (width: number, height = 800, sidebar = 0): LayoutInput => ({ width, height, sidebar, pointer: false });

describe("details form", () => {
  it("uses the base width rules and the available side-panel width", () => {
    expect(detailsForm(input(599), null)).toBe("drawer");
    expect(detailsForm(input(600), null)).toBe("floating");
    expect(detailsForm(input(959), null)).toBe("floating");
    expect(detailsForm(input(960), null)).toBe("side");
    expect(detailsForm(input(1200, 800, 400), null)).toBe("floating");
  });

  it("keeps both sides of the 600 px hysteresis band", () => {
    expect(detailsForm(input(599), "drawer")).toBe("drawer");
    expect(detailsForm(input(600), "drawer")).toBe("floating");
    expect(detailsForm(input(584), "floating")).toBe("floating");
    expect(detailsForm(input(583), "floating")).toBe("drawer");
  });

  it("keeps both sides of the 960 px hysteresis band", () => {
    expect(detailsForm(input(959), "floating")).toBe("floating");
    expect(detailsForm(input(960), "floating")).toBe("side");
    expect(detailsForm(input(944), "side")).toBe("side");
    expect(detailsForm(input(943), "side")).toBe("floating");
  });

  it("forces phone landscape to a 400 px side panel and returns at 516 px", () => {
    expect(detailsForm(input(600, 499), "drawer")).toBe("side");
    expect(detailsForm(input(600, 500), "side")).toBe("side");
    expect(detailsForm(input(600, 515), "side")).toBe("side");
    expect(detailsForm(input(600, 516), "side")).toBe("floating");
    expect(detailsForm(input(599, 400), "drawer")).toBe("drawer");
    expect(sidePanelWidth(600, true)).toBe(400);
  });

  it.each([0, 359, 419, 420, 421, 640])("requires actual empty space beside web timeline content (%i px)", (sideSpace) => {
    for (const width of [1280, 1400, 1560, 1920]) {
      for (const current of [null, "floating", "side"] as const) {
        for (const height of [400, 900]) {
          expect(detailsForm({ ...input(width, height), sideSpace }, current)).toBe(sideSpace >= 420 ? "side" : "floating");
        }
      }
    }
  });

  it("calculates side and floating widths", () => {
    expect(sidePanelWidth(800)).toBe(420);
    expect(sidePanelWidth(1500)).toBe(540);
    expect(sidePanelWidth(2000)).toBe(640);
    expect(floatingWidth(390)).toBe(358);
    expect(floatingWidth(900)).toBe(760);
  });
});

describe("resize settle", () => {
  afterEach(() => vi.useRealTimers());

  it("waits 150 ms after the last resize before changing form", () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const resize = createResizeSettle(settled);

    resize.schedule(input(700), "drawer");
    vi.advanceTimersByTime(149);
    expect(settled).not.toHaveBeenCalled();
    resize.schedule(input(1000), "drawer");
    vi.advanceTimersByTime(149);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settled).toHaveBeenCalledExactlyOnceWith("side");
    expect(DETAILS_BREAKPOINTS.resizeSettleMs).toBe(150);
  });

  it("does not publish a form change while resize is settling or when it stays the same", () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const resize = createResizeSettle(settled);
    resize.schedule(input(700), "floating");
    vi.advanceTimersByTime(150);
    expect(settled).not.toHaveBeenCalled();
    resize.schedule(input(1000), "drawer");
    resize.cancel();
    vi.advanceTimersByTime(150);
    expect(settled).not.toHaveBeenCalled();
  });
});
