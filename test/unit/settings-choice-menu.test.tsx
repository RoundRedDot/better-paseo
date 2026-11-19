import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { DEFAULT_PREFERENCES } from "../../client/preferences";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";
import { resetSafeInsets } from "../../client/details/shell/safe-area";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import { Dimensions } from "./helpers/rn-mock";
import { ChoiceMenuSelect, type MenuChoice } from "../../client/settings-choice-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const colors = {
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#2563eb", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
};
const LABEL = "Model";
const ROW = { phone: 44, desktop: 32 } as const;
const PAD = 12;

function look(compact: boolean) {
  const tokens = buildThemeTokens(colors, { ...DEFAULT_PREFERENCES, language: "en" }, { platform: compact ? "ios" : "web" });
  return { compact, tokens, t: SETTINGS_STRINGS.en };
}

function choices(count: number): MenuChoice[] {
  return Array.from({ length: count }, (_, index) => ({ value: `m${index}`, name: `Model ${index}`, logo: null }));
}

type Box = { x: number; y: number; width: number; height: number };

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let os = "ios";

function setScreen(width: number, height: number) {
  vi.spyOn(Dimensions, "get").mockReturnValue({ width, height, scale: 3, fontScale: 1 });
}

async function openMenu(options: { trigger: Box; count: number; compact: boolean }) {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  await act(async () => {
    renderer = TestRenderer.create(
      <ChoiceMenuSelect value="m0" selected={null} choices={choices(options.count)} onChange={() => {}} look={look(options.compact)} label={LABEL} />,
      {
        createNodeMock: (element) => (element.props as { accessibilityLabel?: string; accessibilityRole?: string }).accessibilityLabel === LABEL
          && (element.props as { accessibilityRole?: string }).accessibilityRole === "button"
          ? { measureInWindow: (report: (x: number, y: number, w: number, h: number) => void) => report(options.trigger.x, options.trigger.y, options.trigger.width, options.trigger.height) }
          : null,
      },
    );
  });
  const button = renderer!.root.find((node) => node.props.accessibilityRole === "button" && node.props.accessibilityLabel === LABEL && typeof node.props.onPress === "function");
  await act(async () => { button.props.onPress(); });
}

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return style && typeof style === "object" ? (style as Record<string, unknown>) : {};
}

/** The menu's card as the user can see and touch it: the absolutely placed view that bounds the scrolling list. */
function card(): { top: number; height: number; node: ReactTestInstance } | null {
  const found = renderer!.root.findAll((node) => {
    if ((node.type as unknown) !== "View") return false;
    const style = flat(node.props.style);
    return style.position === "absolute" && typeof style.top === "number" && typeof style.maxHeight === "number";
  });
  expect(found).toHaveLength(1);
  const node = found[0]!;
  const style = flat(node.props.style);
  if (style.opacity === 0 || node.props.pointerEvents === "none" || node.props.accessibilityElementsHidden) return null;
  return { top: style.top as number, height: style.maxHeight as number, node };
}

function expectInside(box: { top: number; height: number }, top: number, bottom: number) {
  expect(box.top).toBeGreaterThanOrEqual(top);
  expect(box.top + box.height).toBeLessThanOrEqual(bottom);
}

function expectScrolls(box: { height: number; node: ReactTestInstance }, count: number, row: number) {
  expect(box.height).toBeLessThan(count * row + PAD);
  const scroll = box.node.findAll((node) => (node.type as unknown) === "ScrollView");
  expect(scroll).toHaveLength(1);
  const rows = scroll[0]!.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio");
  expect(rows).toHaveLength(count);
}

beforeEach(() => {
  os = "ios";
  resetSafeInsets(null);
});

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  resetSafeInsets(null);
});

describe("ChoiceMenuSelect placement", () => {
  it("keeps a long phone list between the status bar and the home indicator when it opens upward", async () => {
    setScreen(390, 844);
    resetSafeInsets({ top: 59, bottom: 34 });
    await openMenu({ trigger: { x: 16, y: 600, width: 220, height: 44 }, count: 20, compact: true });
    const box = card()!;
    expectInside(box, 59, 844 - 34);
    // It opens above the control without covering it.
    expect(box.top + box.height).toBeLessThanOrEqual(600);
    expectScrolls(box, 20, ROW.phone);
  });

  it("keeps a long phone list off both safe areas when the control sits near the top", async () => {
    setScreen(390, 844);
    resetSafeInsets({ top: 59, bottom: 34 });
    await openMenu({ trigger: { x: 16, y: 70, width: 220, height: 44 }, count: 20, compact: true });
    const box = card()!;
    expectInside(box, 59, 844 - 34);
    expect(box.top).toBeGreaterThanOrEqual(70 + 44);
    expectScrolls(box, 20, ROW.phone);
  });

  it("fits a short landscape window, using whichever side has room", async () => {
    setScreen(844, 390);
    resetSafeInsets({ top: 0, bottom: 21 });
    await openMenu({ trigger: { x: 300, y: 170, width: 220, height: 44 }, count: 20, compact: true });
    const box = card()!;
    expectInside(box, 0, 390 - 21);
    expect(box.top + box.height <= 170 || box.top >= 170 + 44).toBe(true);
    expectScrolls(box, 20, ROW.phone);
  });

  it("covers the control rather than shrinking to a sliver when neither side holds a few rows", async () => {
    setScreen(844, 260);
    resetSafeInsets({ top: 0, bottom: 21 });
    await openMenu({ trigger: { x: 300, y: 100, width: 220, height: 44 }, count: 20, compact: true });
    const box = card()!;
    expectInside(box, 0, 260 - 21);
    expect(box.height).toBeGreaterThan(3 * ROW.phone);
    expectScrolls(box, 20, ROW.phone);
  });

  it("waits for the first safe-area reading before placing the list on a phone", async () => {
    setScreen(390, 844);
    await openMenu({ trigger: { x: 16, y: 600, width: 220, height: 44 }, count: 20, compact: true });
    expect(card()).toBeNull();
    const stage = renderer!.root.findAll((node) => (node.type as unknown) === "View" && node.props.pointerEvents === "none" && typeof node.props.onLayout === "function")[0]!;
    await act(async () => {
      stage.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
      renderer!.root.find((node) => node.props.testID === "details-inset-probe").props.onLayout({ nativeEvent: { layout: { x: 0, y: 59, width: 390, height: 844 - 59 - 34 } } });
    });
    expectInside(card()!, 59, 844 - 34);
  });

  it("keeps the web placement: a short list right under the control, a long one inside the window", async () => {
    os = "web";
    setScreen(1280, 720);
    await openMenu({ trigger: { x: 400, y: 200, width: 240, height: 36 }, count: 4, compact: false });
    expect(card()).toMatchObject({ top: 200 + 36 + 4, height: 4 * ROW.desktop + PAD });
    act(() => renderer!.unmount());

    await openMenu({ trigger: { x: 400, y: 600, width: 240, height: 36 }, count: 40, compact: false });
    const box = card()!;
    expectInside(box, 8, 720 - 8);
    expectScrolls(box, 40, ROW.desktop);
  });
});
