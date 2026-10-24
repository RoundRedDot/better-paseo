import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
}));

import { Pressable, StyleSheet } from "react-native";
import { BoardEmptyState } from "../../client/tasks/board/empty-state";
import { BOARD_STRINGS, LANE_EMPTY_ICON } from "../../client/tasks/board/strings";
import { LANE_ORDER } from "../../client/tasks/model";
import { HOST_FONT, TasksTypography } from "../../client/tasks/typography";
import type { PluginTheme } from "@getpaseo/plugin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const light = { colors: { surface0: "#ffffff", border: "#e2e2e6", foreground: "#1b1b1f", foregroundMuted: "#6b6b75" } } as PluginTheme;
const dark = { colors: { surface0: "#18181b", border: "#3f3f46", foreground: "#fafafa", foregroundMuted: "#a1a1aa" } } as PluginTheme;
let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

function draw(element: React.ReactElement) {
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = TestRenderer.create(element);
  });
}

function texts() {
  return renderer!.root.findAll((node) => (node.type as unknown) === "Text");
}

describe("board empty states", () => {
  it.each(["web", "ios", "android"])("%s keeps every lane's localized content readable through a theme switch", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    for (const language of ["en", "zh"] as const) {
      const strings = BOARD_STRINGS[language];
      for (const lane of LANE_ORDER) {
        for (const theme of [light, dark]) {
          draw(<BoardEmptyState theme={theme} icon={LANE_EMPTY_ICON[lane]} title={strings.laneEmpty[lane]} hint={strings.laneEmptyHint[lane]} />);
          const [title, hint] = texts();
          expect(title!.props.children).toBe(strings.laneEmpty[lane]);
          expect(hint!.props.children).toBe(strings.laneEmptyHint[lane]);
          expect(StyleSheet.flatten(title!.props.style)).toMatchObject({ color: theme.colors.foreground, textAlign: "center", alignSelf: "stretch" });
          expect(StyleSheet.flatten(hint!.props.style)).toMatchObject({ color: theme.colors.foregroundMuted, textAlign: "center", alignSelf: "stretch" });
          expect(title!.props.numberOfLines).toBeUndefined();
          expect(hint!.props.numberOfLines).toBeUndefined();
          const panel = renderer!.root.findByType("View" as never);
          expect(StyleSheet.flatten(panel.props.style)).toMatchObject({ borderColor: theme.colors.border, borderStyle: "dashed", borderRadius: 8 });
          expect(StyleSheet.flatten(panel.props.style).height).toBeUndefined();
          expect(renderer!.root.findByType("Icon" as never).props).toMatchObject({ name: LANE_EMPTY_ICON[lane], color: theme.colors.foregroundMuted });
        }
      }
    }
  });

  it("uses narrow-lane spacing and follows the user's interface size", () => {
    const theme = { ...light, typography: { fontSize: { ui: 21 } } } as PluginTheme;
    draw(
      <TasksTypography theme={theme}>
        <BoardEmptyState theme={theme} icon="Inbox" title="Nothing to review" hint="Finished tasks wait here." narrow />
      </TasksTypography>,
    );
    expect(StyleSheet.flatten(texts()[0]!.props.style).fontSize).toBe(Math.round(HOST_FONT.base * 21 / HOST_FONT.base));
    expect(StyleSheet.flatten(texts()[1]!.props.style).fontSize).toBe(Math.round(HOST_FONT.sm * 21 / HOST_FONT.base));
    expect(StyleSheet.flatten(renderer!.root.findByType("View" as never).props.style)).toMatchObject({ paddingHorizontal: 16, paddingVertical: 28 });
  });

  it("retains the phone's spacing and filter action", () => {
    const clear = vi.fn();
    draw(
      <BoardEmptyState theme={light} icon="CircleCheck" title="No agents waiting for you" hint="Agents appear here." style={{ marginTop: 36 }}>
        <Pressable accessibilityLabel="Clear filters" onPress={clear} />
      </BoardEmptyState>,
    );
    expect(StyleSheet.flatten(renderer!.root.findByType("View" as never).props.style)).toMatchObject({ marginTop: 36, paddingHorizontal: 20, paddingVertical: 28 });
    act(() => renderer!.root.findByType(Pressable).props.onPress());
    expect(clear).toHaveBeenCalledOnce();
  });

  it("bounds the whole-board message while retaining its theme background", () => {
    draw(<BoardEmptyState theme={dark} icon="SquareKanban" title={BOARD_STRINGS.en.boardEmpty} hint={BOARD_STRINGS.en.boardEmptyHint} style={{ width: "100%", maxWidth: 480, backgroundColor: dark.colors.surface0 }} />);
    expect(texts().map((text) => text.props.children)).toEqual([BOARD_STRINGS.en.boardEmpty, BOARD_STRINGS.en.boardEmptyHint]);
    expect(StyleSheet.flatten(renderer!.root.findByType("View" as never).props.style)).toMatchObject({ width: "100%", maxWidth: 480, backgroundColor: dark.colors.surface0 });
  });
});
