import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StyleSheet } from "react-native";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: () => null, ScrollView: rn.ScrollView, copyText: vi.fn(), useToast: () => ({ show() {}, error() {} }) };
});
vi.mock("../../client/components/markdown/markdown-view", () => ({ MarkdownView: () => null }));

import { TaskDetailCards } from "../../client/tasks/cards/detail-cards";
import { Chip } from "../../client/tasks/cards/detail-charts";
import { pillStyle } from "../../client/tasks/cards/task-card";
import { taskTokens } from "../../client/tasks/cards/tokens";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { previewSampleCards } from "../../client/tasks/sample-cards";
import { TasksTypography } from "../../client/tasks/typography";

const NOW = Date.parse("2026-10-20T09:00:00Z");
const THEME = { colors: {
  surface0: "#ffffff", surface1: "#f7f7f8", surface2: "#efeff1", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d93636",
} };
let renderer: TestRenderer.ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("detail pill sizes", () => {
  it.each(["web", "ios"])("uses the board's hover shadow on %s", async (os) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("__rnMockOS", os);
    const tokens = taskTokens(THEME);
    await act(async () => {
      renderer = TestRenderer.create(<Chip tokens={tokens} text="Model" tip="Model" height={20} font={11} />);
    });
    const chip = renderer!.root.find((node) => (node.type as unknown) === "Pressable");
    expect(StyleSheet.flatten(chip.props.style).boxShadow).toBeUndefined();
    await act(async () => chip.props.onHoverIn());
    expect(StyleSheet.flatten(chip.props.style).boxShadow).toBe(tokens.card.buttonShadowHover);
    await act(async () => chip.props.onHoverOut());
    expect(StyleSheet.flatten(chip.props.style).boxShadow).toBeUndefined();
  });

  it.each([
    ["desktop", "web", false, false],
    ["mobile web", "web", true, true],
    ["iPhone", "ios", true, true],
    ["Android phone", "android", true, true],
    ["iPad", "ios", true, false],
    ["Android tablet", "android", true, false],
    ["web tablet", "web", true, false],
  ] as const)("matches board card pills on %s", async (_device, os, touch, compact) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("__rnMockOS", os);
    const sample = previewSampleCards(NOW).find((card) => card.id === "sample-running")!;
    const card = { ...sample, thinkingLabel: "medium", modeLabel: "Full Access", labels: [{ name: "dev", color: null }] };
    for (const ui of [14, 18]) {
      const theme = { ...THEME, typography: { fontSize: { ui, content: 16 } } };
      await act(async () => {
        renderer = TestRenderer.create(<TasksTypography theme={theme}><TaskDetailCards card={card} theme={theme} now={NOW} language="en" strings={BOARD_STRINGS.en.sidebar} touch={touch} compact={compact} /></TasksTypography>);
      });
      const chips = renderer!.root.findAllByType(Chip);
      expect(chips).toHaveLength(4);
      const expected = pillStyle(taskTokens(theme), compact, null, undefined, ui / 14);
      for (const chip of chips) {
        const view = chip.find((node) => (node.type as unknown) === "Pressable");
        const style = StyleSheet.flatten(view.props.style);
        for (const key of ["height", "minWidth", "maxWidth", "paddingHorizontal", "borderRadius", "gap"] as const) {
          expect(style[key]).toBe(expected[key]);
        }
        const text = chip.find((node) => (node.type as unknown) === "Text");
        expect(StyleSheet.flatten(text.props.style)).toMatchObject({ fontSize: Math.round(11 * ui / 14), lineHeight: Math.round(14 * ui / 14), flexShrink: 1 });
        expect(chip.props.lead.props.size).toBe(compact ? 12 : 11);
      }
      await act(async () => renderer!.unmount());
      renderer = undefined;
    }
  });
});
