import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import {
  NO_SELECTION,
  SIDEBAR,
  TABLET_SIDEBAR,
  tabletSidebarWidth,
  clampWidth,
  escapeStep,
  readSidebarPreference,
  resetSidebarPreference,
  selectionReducer,
  sidebarMode,
  sidebarWidth,
  writeSidebarPreference,
  type SidebarSelection,
  sheetHeight,
  sheetRelease,
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

  it("rises from the bottom as a sheet on a board too narrow to float it, with its own 24 px band", () => {
    expect(sidebarMode(580, null)).toBe("sheet");
    expect(sidebarMode(SIDEBAR.sheetBelow - 1, "floating")).toBe("sheet");
    expect(SIDEBAR.floatFrom - SIDEBAR.sheetBelow).toBe(24);
    expect(sidebarMode(770, "sheet")).toBe("sheet");
    expect(sidebarMode(770, "floating")).toBe("floating");
    expect(sidebarMode(770, null)).toBe("floating");
    expect(sidebarMode(SIDEBAR.floatFrom, "sheet")).toBe("floating");
    // A sheet that widens past the floating band goes straight to floating, never to a stale sheet.
    expect(sidebarMode(1000, "sheet")).toBe("floating");
  });
});

describe("bottom sheet", () => {
  it("takes 58% of the lanes' area at half and leaves 8 at full", () => {
    expect(sheetHeight(700, "half")).toBe(406);
    expect(sheetHeight(700, "full")).toBe(692);
  });

  it("moves a height on a long drag or a flick, and closes from half", () => {
    expect(sheetRelease("half", -80, 0)).toBe("full");
    expect(sheetRelease("half", -20, -0.8)).toBe("full");
    expect(sheetRelease("half", 20, 0.1)).toBe("half");
    expect(sheetRelease("half", 90, 0)).toBe("closed");
    expect(sheetRelease("full", 90, 0)).toBe("half");
    expect(sheetRelease("full", -10, 0)).toBe("full");
  });
});

describe("sidebar width", () => {
  it.each(["inline", "floating"] as const)("allows a 260 px desktop sidebar in %s mode and clamps smaller widths", (mode) => {
    expect(sidebarWidth(2000, 260, mode)).toBe(260);
    expect(sidebarWidth(2000, 280, mode)).toBe(280);
    expect(sidebarWidth(2000, 259, mode)).toBe(260);
    expect(clampWidth(259)).toBe(260);
    expect(clampWidth(280)).toBe(280);
  });

  it("uses a separate compact tablet floating width and clamps its drag range", () => {
    expect(tabletSidebarWidth(900)).toBe(340);
    expect(tabletSidebarWidth(900, 100)).toBe(TABLET_SIDEBAR.min);
    expect(tabletSidebarWidth(900, 900)).toBe(TABLET_SIDEBAR.max);
    expect(tabletSidebarWidth(900, 410)).toBe(410);
    expect(tabletSidebarWidth(460, 480)).toBe(436);
  });

  it.each([240, 260, 280, 300, 319])("allows a %i pt tablet floating sidebar", (width) => {
    expect(tabletSidebarWidth(900, width)).toBe(width);
    expect(tabletSidebarWidth(900, 239)).toBe(240);
  });
  it.each(["inline", "floating"] as const)("keeps the user's width up to 800 px while there is room in %s mode", (mode) => {
    expect(sidebarWidth(2000, 380, mode)).toBe(380);
    expect(sidebarWidth(2000, 800, mode)).toBe(800);
    expect(sidebarWidth(2000, 900, mode)).toBe(800);
    expect(sidebarWidth(2000, 100, mode)).toBe(SIDEBAR.min);
  });

  it("narrows an inline sidebar to its minimum before the lanes give way", () => {
    // 1024 wide: 1024 - 12 - 612 = 400 left, so 380 still fits; 1000 leaves 376.
    expect(sidebarWidth(1024, 380, "inline")).toBe(380);
    expect(sidebarWidth(1000, 380, "inline")).toBe(376);
    expect(sidebarWidth(SIDEBAR.inlineFrom, 800, "inline")).toBe(SIDEBAR.inlineFrom - SIDEBAR.gap - SIDEBAR.lanesMin);
    expect(sidebarWidth(900, 380, "inline")).toBe(276);
    expect(sidebarWidth(860, 380, "inline")).toBe(260);
  });

  it("floats at the user's width, inside the board", () => {
    expect(sidebarWidth(820, 380, "floating")).toBe(380);
    expect(sidebarWidth(360, 380, "floating")).toBe(336);
  });
});

describe("sidebar selection", () => {
  const run = (...actions: Parameters<typeof selectionReducer>[1][]) => actions.reduce(selectionReducer, NO_SELECTION);

  it("shows the clicked card, and keeps it on a second click", () => {
    expect(run({ type: "click", id: "a" })).toEqual({ id: "a", back: [] });
    const once = run({ type: "click", id: "a" });
    expect(selectionReducer(once, { type: "click", id: "a" })).toBe(once);
    expect(run({ type: "click", id: "a" }, { type: "click", id: "b" })).toEqual({ id: "b", back: [] });
    expect(run({ type: "click", id: "a" }, { type: "clear" })).toBe(NO_SELECTION);
  });

  it("jumps to a parent or subtask and goes back through the earlier cards", () => {
    const jumped = run({ type: "click", id: "a" }, { type: "jump", id: "b" }, { type: "jump", id: "c" });
    expect(jumped).toEqual({ id: "c", back: ["a", "b"] });
    const once = selectionReducer(jumped, { type: "back" });
    expect(once).toEqual({ id: "b", back: ["a"] });
    expect(selectionReducer(selectionReducer(once, { type: "back" }), { type: "back" })).toEqual({ id: "a", back: [] });
    // A click on a card starts over.
    expect(selectionReducer(jumped, { type: "click", id: "c" })).toEqual({ id: "c", back: [] });
  });

  it("keeps at most twenty cards to go back to", () => {
    let state: SidebarSelection = NO_SELECTION;
    for (let index = 0; index < 30; index++) state = selectionReducer(state, { type: "jump", id: `c${index}` });
    expect(state.back).toHaveLength(SIDEBAR.history);
    expect(state.back[0]).toBe("c9");
  });

  it("orders Esc: back, close the floating panel, let go of the card", () => {
    expect(escapeStep({ id: "b", back: ["a"] }, true)).toBe("back");
    expect(escapeStep({ id: "b", back: [] }, true)).toBe("close");
    expect(escapeStep({ id: "b", back: [] }, false)).toBe("clear");
    expect(escapeStep(NO_SELECTION, false)).toBeNull();
  });
});

describe("sidebar preference", () => {
  afterEach(() => resetSidebarPreference());

  it("opens by default at 380 and remembers what was written", () => {
    expect(readSidebarPreference()).toEqual({ open: true, width: SIDEBAR.width });
    writeSidebarPreference({ open: false, width: 420 });
    expect(readSidebarPreference()).toEqual({ open: false, width: 420 });
  });

  it("remembers the tablet floating width separately from the desktop width", () => {
    writeSidebarPreference({ open: true, width: 420, floatingWidth: 350 });
    expect(readSidebarPreference()).toEqual({ open: true, width: 420, floatingWidth: 350 });
  });
});
