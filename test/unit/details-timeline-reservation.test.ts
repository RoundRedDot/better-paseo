import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { bindTimelineSpace } from "../../client/details/shell/web-layer";

afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

describe("desktop timeline space", () => {
  it("reserves and updates space on a non-overflowing host list, then restores its inline style", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    let padding = "16px";
    let priority = "important";
    const doc = { defaultView: { getComputedStyle: () => ({ overflowY: "auto", paddingRight: "16px" }) } };
    const content = { ownerDocument: doc, style: {
      getPropertyValue: () => padding, getPropertyPriority: () => priority,
      setProperty: (_key: string, value: string, rank: string) => { padding = value; priority = rank; },
      removeProperty: () => { padding = ""; },
    } };
    const scroller = { ownerDocument: doc, parentElement: null, firstElementChild: content,
      scrollHeight: 600, clientHeight: 600, matches: () => true };
    const reservation = bindTimelineSpace({ parentElement: scroller });
    reservation.setWidth(420);
    expect(padding).toBe("calc(16px + 420px)");
    expect(priority).toBe("important");
    reservation.setWidth(500);
    expect(padding).toBe("calc(16px + 500px)");
    reservation.release();
    expect(padding).toBe("16px");
    expect(priority).toBe("important");
  });
});
