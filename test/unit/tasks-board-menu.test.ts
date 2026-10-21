import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const React = await import("react");
  return {
    Icon: (props: { name: string; color?: string }) => React.createElement("Icon", { name: props.name, color: props.color }),
    ScrollView: rn.ScrollView,
  };
});

import { Dimensions, StyleSheet } from "react-native";
import { CascadeMenu, MenuBoundsContext } from "../../client/tasks/board/menu";
import { MENU, MENU_EDGE, MENU_FOCUS, layoutMenu, menuChrome, menuKeyReducer, panelMaxHeight, selectableItems, submenuPlacement, type MenuItem, type MenuSection } from "../../client/tasks/board/menu-model";
import { SORT_GROUPS, SORT_ICONS, sortMenuSections } from "../../client/tasks/board/board-menus";
import { SORT_KEYS, type BoardSort } from "../../client/tasks/board/sort";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIGHT = { surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", border: "#e4e4e7", foreground: "#09090b", foregroundMuted: "#71717a", accent: "#18181b", accentForeground: "#ffffff", statusSuccess: "#16a34a", statusWarning: "#d97706", statusDanger: "#dc2626" };
const DARK = { ...LIGHT, surface0: "#181B1A", surface1: "#1E2120", surface2: "#272A29", border: "#252B2A", foreground: "#fafafa", foregroundMuted: "#A1A5A4" };
const SEPIA = { ...LIGHT, surface0: "#fbf6ec", surface1: "#f5eedf", surface2: "#ede3cf", border: "#e2d6bf", foreground: "#3b2f20", foregroundMuted: "#7a6a55" };
const theme = (colors: Record<string, string>) => ({ colors }) as never;

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

describe("the sort menu's structure", () => {
  const choose = vi.fn();
  const sections = (current: BoardSort | null, language: "en" | "zh" = "en") => sortMenuSections(current, BOARD_STRINGS[language], choose);

  it("groups the default, the names, the times and the amounts, every field with its icon and a submenu", () => {
    const groups = sections(null);
    expect(groups.map((group) => group.items.map((item) => item.key))).toEqual([["default"], ...SORT_GROUPS.map((keys) => [...keys])]);
    expect([...SORT_GROUPS.flat()].sort()).toEqual([...SORT_KEYS].sort());
    const [defaults, ...fields] = groups;
    expect(defaults!.items[0]).toMatchObject({ label: "Default order", icon: "ListOrdered", checked: true });
    expect(defaults!.items[0]!.submenu).toBeUndefined();
    for (const item of fields.flatMap((group) => group.items)) {
      expect(item.icon).toBe(SORT_ICONS[item.key as keyof typeof SORT_ICONS]);
      expect(item.submenu?.[0]?.items).toHaveLength(2);
    }
    expect(fields.flatMap((group) => group.items).map((item) => item.icon)).toEqual([
      "AppWindow", "FolderKanban", "GitBranch", "Folder", "Type", "CalendarPlus", "History", "Gauge", "Timer",
    ]);
  });

  it("shows the active field's direction as a hint and checks it in the submenu", () => {
    const groups = sections({ key: "branch", direction: "desc" });
    const branch = groups[1]!.items.find((item) => item.key === "branch")!;
    expect(branch.hint).toBe("Z→A");
    expect(groups[1]!.items.filter((item) => item.hint)).toHaveLength(1);
    expect(groups[0]!.items[0]!.checked).toBe(false);
    expect(branch.submenu![0]!.items.map((item) => [item.label, item.icon, item.checked])).toEqual([
      ["A→Z", "ArrowDownAZ", false],
      ["Z→A", "ArrowUpZA", true],
    ]);
  });

  it("words and draws every field's directions", () => {
    const directions = (key: string, language: "en" | "zh" = "en") =>
      sections(null, language).flatMap((group) => group.items).find((item) => item.key === key)!.submenu![0]!.items.map((item) => `${item.label}:${item.icon}`);
    expect(directions("updated")).toEqual(["Newest first:ArrowDownWideNarrow", "Oldest first:ArrowUpNarrowWide"]);
    expect(directions("updated", "zh")).toEqual(["最新在前:ArrowDownWideNarrow", "最早在前:ArrowUpNarrowWide"]);
    expect(directions("context", "zh")).toEqual(["高→低:ArrowDownWideNarrow", "低→高:ArrowUpNarrowWide"]);
    expect(directions("duration")).toEqual(["Longest first:ArrowDownWideNarrow", "Shortest first:ArrowUpNarrowWide"]);
    expect(directions("duration", "zh")).toEqual(["长→短:ArrowDownWideNarrow", "短→长:ArrowUpNarrowWide"]);
  });

  it("selecting a direction chooses that sort", () => {
    choose.mockClear();
    const title = sections(null).flatMap((group) => group.items).find((item) => item.key === "title")!;
    title.submenu![0]!.items[1]!.onSelect!();
    expect(choose).toHaveBeenCalledWith({ key: "title", direction: "desc" });
  });
});

describe("menu geometry and keys", () => {
  const leaf = (key: string, extra: Partial<MenuItem> = {}): MenuItem => ({ key, label: key, ...extra });
  const sub: MenuSection[] = [{ key: "s", items: [leaf("s1"), leaf("s2")] }];
  const sections: MenuSection[] = [
    { key: "a", items: [leaf("one")] },
    { key: "b", title: "Group", items: [leaf("two", { submenu: sub }), leaf("off", { disabled: true }), leaf("three")] },
  ];

  it("places every row from Linear's fixed metrics", () => {
    const { rows, height } = layoutMenu(sections);
    const firstGroup = MENU.padV;
    const secondGroup = firstGroup + MENU.rowHeight + MENU.separatorGap * 2 + 1 + MENU.titleHeight;
    expect(rows.map((row) => [row.item.key, row.top])).toEqual([
      ["one", firstGroup],
      ["two", secondGroup],
      ["three", secondGroup + 2 * MENU.rowHeight],
    ]);
    expect(height).toBe(secondGroup + 3 * MENU.rowHeight + MENU.padV);
    expect(selectableItems(sections).map((item) => item.key)).toEqual(["one", "two", "three"]);
  });

  it("moves with the arrows, wrapping, steps into and out of a submenu, chooses and closes", () => {
    const top = selectableItems(sections);
    const subs = selectableItems(sub);
    let state = menuKeyReducer(MENU_FOCUS, "ArrowDown", top, null);
    expect(state.focus.top).toBe(0);
    state = menuKeyReducer(menuKeyReducer(state.focus, "ArrowUp", top, null).focus, "ArrowUp", top, null);
    expect(state.focus.top).toBe(1);
    // Right (or Enter) on a row with a submenu opens it and steps in.
    state = menuKeyReducer(state.focus, "ArrowRight", top, null);
    expect(state.focus).toEqual({ level: 1, top: 1, sub: 0, open: 1 });
    state = menuKeyReducer(state.focus, "ArrowDown", top, subs);
    expect(state.focus.sub).toBe(1);
    const chosen = menuKeyReducer(state.focus, "Enter", top, subs);
    expect(chosen.effect).toEqual({ type: "select", level: 1, index: 1 });
    // Left steps back out; Escape closes one level at a time.
    expect(menuKeyReducer(state.focus, "ArrowLeft", top, subs).focus).toEqual({ level: 0, top: 1, sub: -1, open: null });
    const back = menuKeyReducer(state.focus, "Escape", top, subs);
    expect(back.focus.open).toBeNull();
    expect(menuKeyReducer(back.focus, "Escape", top, null).effect).toEqual({ type: "close" });
    // Enter on a plain row chooses it; Enter also opens a submenu.
    expect(menuKeyReducer({ ...MENU_FOCUS, top: 2 }, "Enter", top, null).effect).toEqual({ type: "select", level: 0, index: 2 });
    expect(menuKeyReducer({ ...MENU_FOCUS, top: 1 }, "Enter", top, null).focus.open).toBe(1);
    expect(menuKeyReducer(MENU_FOCUS, "x", top, null).handled).toBe(false);
  });
});

describe("menu chrome", () => {
  it.each([
    // Linear's #f1f1f1 on white, from the theme's foreground over its surface.
    ["Paseo light", LIGHT, "#f1f1f2"],
    ["Paseo dark", DARK, "#2a2d2c"],
    ["sepia light", SEPIA, "#f0ebe1"],
  ] as const)("follows the %s theme", (_name, colors, hover) => {
    const chrome = menuChrome(theme(colors));
    expect(chrome.background).toBe(colors.surface0);
    expect(chrome.border).toBe(colors.border);
    expect(chrome.hover).toBe(hover);
    expect(chrome.shadow).toContain("24px");
  });

  it("is softer on light than on dark", () => {
    expect(menuChrome(theme(LIGHT)).shadow).toContain("0.08");
    expect(menuChrome(theme(DARK)).shadow).toContain("0.45");
  });
});

describe("CascadeMenu", () => {
  let renderer: ReturnType<typeof TestRenderer.create> | undefined;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.useRealTimers();
  });

  const close = vi.fn();
  const picked = vi.fn();
  function render(sections: MenuSection[], colors = LIGHT) {
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(CascadeMenu, { sections, theme: theme(colors), width: 240, top: 34, align: "left", onClose: close }),
      );
    });
  }
  const row = (label: string) =>
    renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem" && textOf(node).startsWith(label))[0]!;
  const submenu = () => renderer!.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "menu-submenu");
  const sections = (): MenuSection[] => [
    {
      key: "fields",
      items: [
        { key: "branch", label: "Branch", icon: "GitBranch", hint: "A→Z", submenu: [{ key: "d", items: [{ key: "asc", label: "A→Z", onSelect: picked }] }] },
        { key: "plain", label: "Plain", icon: "Type", onSelect: picked },
        { key: "multi", label: "Multi", keepOpen: true, onSelect: picked },
      ],
    },
  ];

  it("draws Linear's chrome from the theme: radius 12, a hairline, a wide soft shadow, rows 32 inset 6", () => {
    for (const colors of [LIGHT, DARK, SEPIA]) {
      render(sections(), colors);
      const panel = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "menu-panel");
      expect(StyleSheet.flatten(panel.props.style)).toMatchObject({
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors.surface0,
        paddingVertical: 6,
        boxShadow: menuChrome(theme(colors)).shadow,
      });
      expect(StyleSheet.flatten(row("Plain").props.style)).toMatchObject({ height: 32, marginHorizontal: 6, borderRadius: 6 });
      act(() => renderer!.unmount());
    }
    renderer = undefined;
  });

  it("parts its groups with a line one device pixel thin, on the web too, in a 1 pt box the layout counts", () => {
    for (const os of ["ios", "web"]) {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
      try {
        render([...sections(), { key: "more", items: [{ key: "other", label: "Other", onSelect: picked }] }]);
        const boxes = renderer!.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "menu-separator");
        expect(boxes).toHaveLength(1);
        expect(StyleSheet.flatten(boxes[0]!.props.style)).toMatchObject({ height: 1, marginVertical: MENU.separatorGap });
        const line = boxes[0]!.children[0] as ReactTestInstance;
        // The mock screen is 3x: react-native-web's hairlineWidth would be a whole CSS pixel, three device pixels.
        expect(StyleSheet.flatten(line.props.style)).toMatchObject({
          height: os === "web" ? 1 / 3 : StyleSheet.hairlineWidth,
          backgroundColor: LIGHT.border,
        });
        act(() => renderer!.unmount());
      } finally {
        delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
      }
    }
    renderer = undefined;
  });

  it("stays inside a short window: the panel scrolls above its bottom, the submenu shifts up", () => {
    // Android landscape: 360 high, the sort menu hung 150 down.
    expect(panelMaxHeight(null, 360)).toBe(MENU.maxHeight);
    expect(panelMaxHeight(150, 360)).toBe(360 - 150 - MENU_EDGE);
    expect(panelMaxHeight(20, 1000)).toBe(MENU.maxHeight);
    expect(panelMaxHeight(340, 360)).toBe(MENU.rowHeight * 3 + MENU.padV * 2);
    // A two-row submenu (76) beside a row 160 into the menu would end at 386: it moves up to end at 352.
    const two = layoutMenu([{ key: "d", items: [{ key: "a", label: "A" }, { key: "z", label: "Z" }] }]).height;
    expect(submenuPlacement(160, two, 150, 360)).toEqual({ top: 360 - MENU_EDGE - 150 - two, maxHeight: 360 - 2 * MENU_EDGE });
    // Room enough: beside its row.
    expect(submenuPlacement(40, two, 150, 900).top).toBe(40);
    // Never above the window's top edge.
    expect(submenuPlacement(0, 2000, 100, 360).top).toBe(MENU_EDGE - 100);

    const layout = { createNodeMock: () => ({ measureInWindow: (cb: (x: number, y: number, w: number) => void) => cb(100, 150, 240) }) };
    const many: MenuSection[] = [{ key: "all", items: Array.from({ length: 12 }, (_, at) => ({ key: `k${at}`, label: `Row ${at}`, submenu: [{ key: "d", items: [{ key: "a", label: "A" }, { key: "z", label: "Z" }] }] })) }];
    const dims = vi.spyOn(Dimensions, "get").mockReturnValue({ width: 800, height: 360, scale: 3, fontScale: 1 } as never);
    try {
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(CascadeMenu, { sections: many, theme: theme(LIGHT), width: 240, top: 34, align: "left", onClose: close }),
          layout,
        );
      });
      const panel = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "menu-panel");
      expect(StyleSheet.flatten(panel.props.style).maxHeight).toBe(360 - 150 - MENU_EDGE);
      act(() => row("Row 5").props.onPress());
      const placed = submenu()[0]!;
      expect(StyleSheet.flatten(placed.props.style).top).toBe(360 - MENU_EDGE - 150 - two);
    } finally {
      dims.mockRestore();
    }
  });

  it("ends inside the board's frame when it has one, measured after layout", () => {
    // The window is 371 high, the board ends at 360: the board decides.
    expect(panelMaxHeight(178, 360)).toBe(360 - 178 - MENU_EDGE);
    expect(submenuPlacement(0, 2000, 100, 360, 40).top).toBe(40 + MENU_EDGE - 100);
    expect(submenuPlacement(0, 2000, 100, 360, 40).maxHeight).toBe(360 - 40 - 2 * MENU_EDGE);
    const many: MenuSection[] = [{ key: "all", items: Array.from({ length: 12 }, (_, at) => ({ key: `k${at}`, label: `Row ${at}` })) }];
    const dims = vi.spyOn(Dimensions, "get").mockReturnValue({ width: 800, height: 371, scale: 3, fontScale: 1 } as never);
    let laidOut = false;
    const menuNode = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(100, 178, laidOut ? 240 : 0, 300) };
    const boardNode = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 60, 800, 300) };
    const bounds = { current: boardNode as never };
    try {
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(
            MenuBoundsContext.Provider,
            { value: bounds },
            React.createElement(CascadeMenu, { sections: many, theme: theme(LIGHT), width: 240, top: 34, align: "left", onClose: close, testID: "m" }),
          ),
          { createNodeMock: () => menuNode },
        );
      });
      const panel = () => renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "menu-panel");
      // Not laid out at the first look (native): not measured yet.
      expect(StyleSheet.flatten(panel().props.style).maxHeight).toBeUndefined();
      laidOut = true;
      const container = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "m");
      act(() => container.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 240, height: 300 } } }));
      expect(StyleSheet.flatten(panel().props.style).maxHeight).toBe(360 - 178 - MENU_EDGE);
    } finally {
      dims.mockRestore();
    }
  });

  it("on Android scrolls a tall panel by dragging in JS, since a native ScrollView past its anchor gets no touches", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    const many: MenuSection[] = [{ key: "all", items: Array.from({ length: 12 }, (_, at) => ({ key: `k${at}`, label: `Row ${at}` })) }];
    const dims = vi.spyOn(Dimensions, "get").mockReturnValue({ width: 800, height: 360, scale: 3, fontScale: 1 } as never);
    const node = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(100, 150, 240, 300) };
    try {
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(CascadeMenu, { sections: many, theme: theme(LIGHT), width: 240, top: 34, align: "left", onClose: close }),
          { createNodeMock: () => node },
        );
      });
      const panel = () => renderer!.root.find((n) => (n.type as unknown) === "View" && n.props.testID === "menu-panel");
      expect(renderer!.root.findAll((n) => (n.type as unknown) === "ScrollView")).toHaveLength(0);
      const max = 360 - 150 - MENU_EDGE;
      expect(StyleSheet.flatten(panel().props.style).maxHeight).toBe(max);
      const at = (pageY: number) => ({ nativeEvent: { pageY } });
      expect(panel().props.onStartShouldSetResponderCapture(at(300))).toBe(false);
      // A press stays the row's; a drag past 6 takes the panel.
      expect(panel().props.onMoveShouldSetResponderCapture(at(304))).toBe(false);
      expect(panel().props.onMoveShouldSetResponderCapture(at(290))).toBe(true);
      act(() => panel().props.onResponderGrant(at(290)));
      act(() => panel().props.onResponderMove(at(200)));
      // The panel's first host child is the moving content.
      const content = () => StyleSheet.flatten(panel().findAll((n) => (n.type as unknown) === "View" && n !== panel())[0]!.props.style);
      expect(content().transform).toEqual([{ translateY: -90 }]);
      // Never past the end.
      act(() => panel().props.onResponderMove(at(-2000)));
      const range = layoutMenu(many).height - max;
      expect(content().transform).toEqual([{ translateY: -range }]);
    } finally {
      dims.mockRestore();
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    }
  });

  it("draws the icon, label, hint and a chevron for a submenu", () => {
    render(sections());
    const branch = row("Branch");
    expect(branch.findAll((node) => (node.type as unknown) === "Icon").map((icon) => icon.props.name)).toEqual(["GitBranch", "ChevronRight"]);
    expect(textOf(branch)).toBe("BranchA→Z");
  });

  it("opens a submenu after 150 ms of hover, and fills the hovered row", () => {
    render(sections());
    act(() => row("Branch").props.onHoverIn());
    expect(StyleSheet.flatten(row("Branch").props.style).backgroundColor).toBe(menuChrome(theme(LIGHT)).hover);
    expect(submenu()).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(MENU.hoverMs);
    });
    expect(submenu()).toHaveLength(1);
    // Hovering a plain row closes it after the same delay.
    act(() => row("Plain").props.onHoverIn());
    expect(submenu()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(MENU.hoverMs);
    });
    expect(submenu()).toHaveLength(0);
  });

  it("keeps the submenu when the pointer reaches it within the delay", () => {
    render(sections());
    act(() => row("Branch").props.onPress());
    expect(submenu()).toHaveLength(1);
    // On the way across, the pointer grazes another row, then enters the submenu.
    act(() => row("Plain").props.onHoverIn());
    act(() => submenu()[0]!.props.onPointerEnter());
    act(() => {
      vi.advanceTimersByTime(MENU.hoverMs * 2);
    });
    expect(submenu()).toHaveLength(1);
  });

  it("follows the keys on web, ahead of the board's own", () => {
    close.mockClear();
    picked.mockClear();
    const handlers: { fn: (event: unknown) => void; capture: unknown }[] = [];
    (globalThis as { document?: unknown }).document = {
      addEventListener: (type: string, fn: (event: unknown) => void, capture: unknown) => {
        if (type === "keydown") handlers.push({ fn, capture });
      },
      removeEventListener: () => {},
    };
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    try {
      render(sections());
      expect(handlers).toHaveLength(1);
      expect(handlers[0]!.capture).toBe(true);
      const press = (key: string) => {
        const event = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
        act(() => handlers[0]!.fn(event));
        return event;
      };
      expect(press("ArrowDown").preventDefault).toHaveBeenCalled();
      expect(StyleSheet.flatten(row("Branch").props.style).backgroundColor).toBe(menuChrome(theme(LIGHT)).hover);
      press("ArrowRight");
      expect(submenu()).toHaveLength(1);
      press("ArrowLeft");
      expect(submenu()).toHaveLength(0);
      press("Enter");
      expect(submenu()).toHaveLength(1);
      press("Enter");
      expect(picked).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(press("q").preventDefault).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as { document?: unknown }).document;
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    }
  });

  it("closes on outside pointer presses on web, keeps both panels and the trigger, and removes the listener", () => {
    close.mockClear();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const doc = { addEventListener, removeEventListener };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("__rnMockOS", "web");
    const trigger = {};
    const mainRow = {};
    const subRow = {};
    const inside = new Set([trigger, mainRow, subRow]);
    const node = { parentElement: { contains: (target: unknown) => inside.has(target as object) } };
    try {
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(CascadeMenu, { sections: sections(), theme: theme(LIGHT), width: 240, top: 34, align: "left", onClose: close }),
          { createNodeMock: () => node },
        );
      });
      const registration = addEventListener.mock.calls.find(([type]) => type === "pointerdown")!;
      expect(registration[2]).toBe(true);
      const pointerDown = registration[1] as (event: { target: object }) => void;
      act(() => row("Branch").props.onPress());
      expect(submenu()).toHaveLength(1);
      for (const target of inside) act(() => pointerDown({ target }));
      expect(close).not.toHaveBeenCalled();
      // A sibling toolbar control or anything outside the board closes it,
      // even when that control stops the event from bubbling.
      act(() => pointerDown({ target: {} }));
      expect(close).toHaveBeenCalledTimes(1);
      const updatedClose = vi.fn();
      act(() => renderer!.update(
        React.createElement(CascadeMenu, { sections: sections(), theme: theme(LIGHT), width: 240, top: 34, align: "left", onClose: updatedClose }),
      ));
      act(() => pointerDown({ target: {} }));
      expect(updatedClose).toHaveBeenCalledTimes(1);
      act(() => renderer!.unmount());
      renderer = undefined;
      expect(removeEventListener).toHaveBeenCalledWith("pointerdown", pointerDown, true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens on a click, chooses in the submenu and closes; a multi-select row stays open", () => {
    close.mockClear();
    picked.mockClear();
    render(sections());
    act(() => row("Branch").props.onPress());
    const choice = submenu()[0]!.findAll((node) => (node.type as unknown) === "Pressable" && textOf(node) === "A→Z")[0]!;
    act(() => choice.props.onPress());
    expect(picked).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    act(() => row("Multi").props.onPress());
    expect(picked).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
