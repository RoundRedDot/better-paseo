import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import {
  NO_SELECTION,
  SIDEBAR,
  escapeStep,
  readSidebarPreference,
  resetSidebarPreference,
  selectionReducer,
  sidebarMode,
  sidebarWidth,
  writeSidebarPreference,
  type SidebarSelection,
} from "../../client/tasks/board/sidebar-model";

describe("sidebar mode", () => {
  it("is inline on a wide board and floating on a narrow one", () => {
    expect(sidebarMode(2000, null)).toBe("inline");
    expect(sidebarMode(SIDEBAR.inlineFrom, "floating")).toBe("inline");
    expect(sidebarMode(SIDEBAR.floatBelow - 1, "inline")).toBe("floating");
    expect(sidebarMode(820, null)).toBe("floating");
  });

  it("keeps its mode inside the 24 px band", () => {
    expect(SIDEBAR.inlineFrom - SIDEBAR.floatBelow).toBe(24);
    expect(sidebarMode(1000, "inline")).toBe("inline");
    expect(sidebarMode(1000, "floating")).toBe("floating");
    expect(sidebarMode(1000, null)).toBe("inline");
  });
});

describe("sidebar width", () => {
  it("keeps the user's width while the lanes have room", () => {
    expect(sidebarWidth(2000, 380, "inline")).toBe(380);
    expect(sidebarWidth(2000, 900, "inline")).toBe(SIDEBAR.max);
    expect(sidebarWidth(2000, 100, "inline")).toBe(SIDEBAR.min);
  });

  it("narrows an inline sidebar to its minimum before the lanes give way", () => {
    // 1024 wide: 1024 - 12 - 612 = 400 left, so 380 still fits; 1000 leaves 376.
    expect(sidebarWidth(1024, 380, "inline")).toBe(380);
    expect(sidebarWidth(1000, 380, "inline")).toBe(376);
    expect(sidebarWidth(SIDEBAR.inlineFrom, 520, "inline")).toBe(SIDEBAR.inlineFrom - SIDEBAR.gap - SIDEBAR.lanesMin);
    expect(sidebarWidth(900, 380, "inline")).toBe(SIDEBAR.min);
  });

  it("floats at the user's width, inside the board", () => {
    expect(sidebarWidth(820, 380, "floating")).toBe(380);
    expect(sidebarWidth(360, 380, "floating")).toBe(SIDEBAR.min);
  });
});

describe("sidebar selection", () => {
  const run = (...actions: Parameters<typeof selectionReducer>[1][]) => actions.reduce(selectionReducer, NO_SELECTION);

  it("follows hover and the keyboard until a card is pinned", () => {
    expect(run({ type: "hover", id: "a" })).toEqual({ id: "a", pinned: false, back: [] });
    expect(run({ type: "hover", id: "a" }, { type: "focus", id: "b" }).id).toBe("b");
    const pinned = run({ type: "click", id: "a" }, { type: "hover", id: "b" }, { type: "focus", id: "c" });
    expect(pinned).toEqual({ id: "a", pinned: true, back: [] });
  });

  it("pins on a click and unpins on a second click of the same card", () => {
    expect(run({ type: "click", id: "a" })).toEqual({ id: "a", pinned: true, back: [] });
    expect(run({ type: "click", id: "a" }, { type: "click", id: "a" })).toEqual({ id: "a", pinned: false, back: [] });
    expect(run({ type: "click", id: "a" }, { type: "click", id: "b" })).toEqual({ id: "b", pinned: true, back: [] });
  });

  it("toggles the pin with P", () => {
    expect(run({ type: "togglePin", id: "a" })).toEqual({ id: "a", pinned: true, back: [] });
    expect(run({ type: "togglePin", id: "a" }, { type: "togglePin", id: "a" }).pinned).toBe(false);
    expect(run({ type: "togglePin", id: null })).toBe(NO_SELECTION);
  });

  it("jumps to a parent or subtask, pinned, and goes back through the earlier cards", () => {
    const jumped = run({ type: "hover", id: "a" }, { type: "jump", id: "b" }, { type: "jump", id: "c" });
    expect(jumped).toEqual({ id: "c", pinned: true, back: ["a", "b"] });
    const once = selectionReducer(jumped, { type: "back" });
    expect(once).toEqual({ id: "b", pinned: true, back: ["a"] });
    expect(selectionReducer(selectionReducer(once, { type: "back" }), { type: "back" })).toEqual({ id: "a", pinned: true, back: [] });
  });

  it("keeps at most twenty cards to go back to", () => {
    let state: SidebarSelection = NO_SELECTION;
    for (let index = 0; index < 30; index++) state = selectionReducer(state, { type: "jump", id: `c${index}` });
    expect(state.back).toHaveLength(SIDEBAR.history);
    expect(state.back[0]).toBe("c9");
  });

  it("orders Esc: back, unpin, close the floating panel", () => {
    expect(escapeStep({ id: "b", pinned: true, back: ["a"] }, true)).toBe("back");
    expect(escapeStep({ id: "b", pinned: true, back: [] }, true)).toBe("unpin");
    expect(escapeStep({ id: "b", pinned: false, back: [] }, true)).toBe("close");
    expect(escapeStep({ id: "b", pinned: false, back: [] }, false)).toBeNull();
  });
});

describe("sidebar preference", () => {
  afterEach(() => resetSidebarPreference());

  it("opens by default at 380 and remembers what was written", () => {
    expect(readSidebarPreference()).toEqual({ open: true, width: SIDEBAR.width });
    writeSidebarPreference({ open: false, width: 420 });
    expect(readSidebarPreference()).toEqual({ open: false, width: 420 });
  });
});
