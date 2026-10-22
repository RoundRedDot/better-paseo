import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => import("./helpers/rn-mock"));

import { SHEET } from "../../client/tasks/board/sidebar-model";
import { dampOverdrag, detentHeights, releaseDetent, settleMs } from "../../client/details/detent-model";

describe("details detents", () => {
  it("fits content to 58% and offers full only when the content exceeds it", () => {
    expect(SHEET.half).toBe(0.58);
    expect(SHEET.fullGap).toBe(8);
    expect(detentHeights(300, 700)).toEqual({ fit: 300, full: null });
    expect(detentHeights(500, 700)).toEqual({ fit: 406, full: 692 });
  });

  it("changes or closes only beyond the 64 px and 0.5 px/ms thresholds", () => {
    expect(SHEET.distance).toBe(64);
    expect(SHEET.flick).toBe(0.5);
    expect(releaseDetent("fit", -64, 0)).toBe("fit");
    expect(releaseDetent("fit", -65, 0)).toBe("full");
    expect(releaseDetent("fit", 64, 0)).toBe("fit");
    expect(releaseDetent("fit", 0, 0.5)).toBe("fit");
    expect(releaseDetent("fit", 0, 0.501)).toBe("closed");
    expect(releaseDetent("fit", 0, -0.501)).toBe("full");
    expect(releaseDetent("full", 0, 0.5)).toBe("full");
    expect(releaseDetent("full", 0, 0.501)).toBe("fit");
  });

  it("closes full on a downward fling above 1.2 px/ms", () => {
    expect(releaseDetent("full", 0, 1.2)).toBe("fit");
    expect(releaseDetent("full", 0, 1.201)).toBe("closed");
    expect(releaseDetent("full", 65, 0)).toBe("fit");
    expect(releaseDetent("full", -65, 0)).toBe("full");
  });

  it("damps overdrag at an end detent", () => {
    expect(dampOverdrag(100, false)).toBe(30);
    expect(dampOverdrag(100, true)).toBe(100);
  });

  it("clamps settle time from remaining distance and speed to 160–240 ms", () => {
    expect(settleMs(100, 0.5)).toBe(200);
    expect(settleMs(10, 0.5)).toBe(160);
    expect(settleMs(500, 0.5)).toBe(240);
    expect(settleMs(100, -0.5)).toBe(200);
    expect(settleMs(100, 0)).toBe(240);
  });
});
