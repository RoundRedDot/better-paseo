import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StyleSheet } from "react-native";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: () => null, ScrollView: rn.ScrollView, copyText: vi.fn(), useToast: () => ({ show() {}, error() {} }) };
});
vi.mock("../../client/components/markdown/markdown-view", () => ({ MarkdownView: () => null }));

import { TaskDetailCards, type TaskDetailCardsProps } from "../../client/tasks/cards/detail-cards";
import { resetSectionChoices } from "../../client/tasks/cards/detail-collapse";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { cardStrings } from "../../client/tasks/cards/strings";
import { previewSampleCards } from "../../client/tasks/sample-cards";
import { MarkdownView } from "../../client/components/markdown/markdown-view";
import { TasksTypography, TasksTypographyScale, HOST_FONT } from "../../client/tasks/typography";
import { variantMetrics } from "../../client/components/markdown/render/styles";

const NOW = Date.parse("2026-10-20T09:00:00Z");
const THEME = { colors: {
  surface0: "#ffffff", surface1: "#f7f7f8", surface2: "#efeff1", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d93636",
} };
const ORDER = ["detail-header", "detail-location", "detail-prompt", "detail-message", "detail-subtasks", "detail-usage", "detail-activity"];
let renderer: TestRenderer.ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSectionChoices();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

function props(children: boolean): TaskDetailCardsProps {
  const card = previewSampleCards(NOW).find((card) => card.id === "sample-running")!;
  return {
    card: children ? card : { ...card, children: [] }, theme: THEME, now: NOW,
    language: "en", strings: BOARD_STRINGS.en.sidebar, columns: true, touch: true,
    firstPrompt: { prompt: { state: "none" }, load() {} },
    lastMessage: { prompt: { state: "none" }, load() {} },
  };
}
function host(root: ReactTestInstance, id: string) {
  return root.find((node) => typeof node.type === "string" && node.props.testID === id);
}
function order(root: ReactTestInstance) {
  return root.findAll((node) => typeof node.type === "string" && ORDER.includes(node.props.testID)).map((node) => node.props.testID);
}

describe("details columns", () => {
  it.each(["web", "ios", "android"])("keeps properties above subtasks in separate scrollers on %s", async (os) => {
    vi.stubGlobal("__rnMockOS", os);
    for (const children of [true, false]) {
      await act(async () => { renderer = TestRenderer.create(<TaskDetailCards {...props(children)} />); });
      const root = renderer!.root;
      const left = host(root, "detail-column-head");
      const right = host(root, "detail-column-sections");
      expect(order(left)).toEqual(["detail-header", "detail-location", ...(children ? ["detail-subtasks"] : [])]);
      expect(order(right)).toEqual(["detail-prompt", "detail-message", "detail-usage", "detail-activity"]);
      expect(root.findAll((node) => (node.type as unknown) === "ScrollView")).toEqual([left, right]);
      for (const scroll of [left, right]) {
        expect(scroll.props.style).toMatchObject({ flex: 1 });
        expect(scroll.props.showsVerticalScrollIndicator).toBe(true);
        if (os === "web") expect(scroll.props.dataSet).toEqual({ bcdetails: "inset" });
        else expect(scroll.props.scrollIndicatorInsets).toEqual({ bottom: 8 });
      }
      await act(async () => renderer!.unmount());
      renderer = undefined;
    }
  });

  it("preserves single-column order and section choices when the sheet narrows", async () => {
    const detailProps = props(true);
    await act(async () => { renderer = TestRenderer.create(<TaskDetailCards {...detailProps} />); });
    const heading = () => host(renderer!.root, "detail-location").find((node) => typeof node.type === "string" && typeof node.props.accessibilityState?.expanded === "boolean");
    await act(async () => heading().props.onPress());
    expect(heading().props.accessibilityState.expanded).toBe(false);
    await act(async () => renderer!.update(<TaskDetailCards {...detailProps} columns={false} />));
    expect(order(renderer!.root)).toEqual(ORDER);
    expect(heading().props.accessibilityState.expanded).toBe(false);
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "ScrollView")).toHaveLength(0);
  });
});

describe("detail message typography", () => {
  it.each(["web", "ios", "android"])("follows Paseo's body size for all three messages on %s", async (os) => {
    vi.stubGlobal("__rnMockOS", os);
    const message = (text: string) => ({ prompt: { state: "ready" as const, text: text.repeat(80) }, load() {} });
    const detailProps: TaskDetailCardsProps = {
      ...props(false), touch: os !== "web", columns: false,
      firstPrompt: message("First prompt. "),
      humanMessage: message("Follow-up. "),
      lastMessage: message("Latest reply. "),
    };
    for (const [ui, content, factor] of [[14, 15, 1], [14, 16, 1], [18, 16, 1], [18, 20, 1], [18, 20, 0.9]] as const) {
      const theme = { ...THEME, typography: { fontSize: { ui, content } } };
      const size = Math.round(content * 0.9 * factor);
      await act(async () => {
        renderer = TestRenderer.create(<TasksTypography theme={theme}><TasksTypographyScale factor={factor}><TaskDetailCards {...detailProps} theme={theme} /></TasksTypographyScale></TasksTypography>);
      });
      for (const id of ["detail-prompt", "detail-human", "detail-message"]) {
        const section = host(renderer!.root, id);
        expect(section.findByType(MarkdownView).props.size).toBe(size);
        expect(host(section, `${id}-text`).props.style).toMatchObject({ maxHeight: 4 * variantMetrics("compact", size).bodyLineHeight });
        const more = host(section, `${id}-more`);
        expect(StyleSheet.flatten(more.find((node) => (node.type as unknown) === "Text").props.style).fontSize).toBe(Math.round(HOST_FONT.sm * ui / HOST_FONT.base * factor));
        await act(async () => more.props.onPress());
        expect(host(section, `${id}-text`).props.style).toBeNull();
        expect(section.findByType(MarkdownView).props.size).toBe(size);
      }
      await act(async () => renderer!.unmount());
      renderer = undefined;
    }
  });
});

describe("detail message times", () => {
  function heading(root: ReactTestInstance, id: string) {
    return host(root, id).find((node) => typeof node.type === "string" && typeof node.props.accessibilityState?.expanded === "boolean");
  }
  function labels(root: ReactTestInstance) {
    return root.findAll((node) => (node.type as unknown) === "Text").map((node) => node.props.children);
  }

  it.each(["web", "ios", "android"])("shows each message's local time on the right, including when folded, on %s", async (os) => {
    vi.stubGlobal("__rnMockOS", os);
    const first = new Date(NOW);
    first.setHours(8, 13, 7, 0);
    const last = new Date(first);
    last.setDate(last.getDate() - 1);
    last.setHours(21, 47, 52, 0);
    const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    for (const language of ["zh", "en"] as const) {
      for (const columns of [false, true]) {
        resetSectionChoices();
        const detailProps: TaskDetailCardsProps = {
          ...props(true), language, strings: BOARD_STRINGS[language].sidebar, columns, touch: os !== "web",
          firstPrompt: { prompt: { state: "ready", text: "First prompt", timestamp: first.toISOString() }, load() {} },
          lastMessage: { prompt: { state: "ready", text: "Last reply", timestamp: last.toISOString() }, load() {} },
        };
        await act(async () => { renderer = TestRenderer.create(<TaskDetailCards {...detailProps} />); });
        const root = renderer!.root;
        const words = cardStrings(language).details;
        for (const [id, title, time, fullTime] of [
          ["detail-prompt", words.prompt, "08:13", `${day(first)} 08:13:07`],
          ["detail-message", words.message, `${last.getMonth() + 1}/${last.getDate()} 21:47`, `${day(last)} 21:47:52`],
        ] as const) {
          expect(labels(heading(root, id))).toEqual([title, time]);
          const stamp = heading(root, id).findAll((node) => (node.type as unknown) === "Text")[1]!;
          expect(stamp.props.numberOfLines).toBe(1);
          expect(stamp.props.dataSet?.bctip).toBe(os === "web" ? fullTime : undefined);
          expect(stamp.props.onPress).toBeUndefined();
          expect(heading(root, id).props.dataSet?.bctip).toBe(os === "web" ? words.collapse(title) : undefined);
          expect(StyleSheet.flatten(stamp.props.style)).toMatchObject({ flexShrink: 1, fontVariant: ["tabular-nums"] });
          await act(async () => heading(root, id).props.onPress());
          expect(heading(root, id).props.accessibilityState.expanded).toBe(false);
          expect(labels(heading(root, id))).toEqual([title, time]);
          const foldedStamp = heading(root, id).findAll((node) => (node.type as unknown) === "Text")[1]!;
          expect(foldedStamp.props.dataSet?.bctip).toBe(os === "web" ? fullTime : undefined);
          expect(heading(root, id).props.dataSet?.bctip).toBe(os === "web" ? words.expand(title) : undefined);
        }
        await act(async () => renderer!.unmount());
        renderer = undefined;
      }
    }
  });

  it("leaves missing, invalid and unloaded message times blank instead of using the task's times", async () => {
    const detailProps = props(true);
    for (const timestamp of [undefined, "", "invalid"]) {
      await act(async () => {
        renderer = TestRenderer.create(<TaskDetailCards {...detailProps}
          firstPrompt={{ prompt: { state: "ready", text: "No time", timestamp }, load() {} }}
          lastMessage={{ prompt: { state: "ready", text: "No time", timestamp }, load() {} }} />);
      });
      for (const id of ["detail-prompt", "detail-message"]) expect(labels(heading(renderer!.root, id))).toHaveLength(1);
      await act(async () => renderer!.unmount());
    }
    for (const state of ["idle", "loading", "none", "error"] as const) {
      await act(async () => {
        renderer = TestRenderer.create(<TaskDetailCards {...detailProps}
          firstPrompt={{ prompt: { state }, load() {} }} lastMessage={{ prompt: { state }, load() {} }} />);
      });
      for (const id of ["detail-prompt", "detail-message"]) expect(labels(heading(renderer!.root, id))).toHaveLength(1);
      await act(async () => renderer!.unmount());
    }
    renderer = undefined;
  });
});
