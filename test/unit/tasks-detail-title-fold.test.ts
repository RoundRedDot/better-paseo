/**
 * A card's title at a sidebar's width, laid out by Yoga as Fabric lays it out
 * (`helpers/yoga-host-layout`): a long title shows five lines at most, the
 * same fade and "Show all" row as the message bodies, and all of it once the
 * reader opens the fold. Feeding `onLayout` by hand cannot show whether the
 * clamp really cuts after the fifth line.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    // The fold's clamped height is the steady state; reduced motion keeps the
    // frame at the fold instead of an interpolation the mock cannot report.
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(true),
      addEventListener: () => ({ remove() {} }),
    },
  };
});

vi.mock("@getpaseo/plugin/client", async (original) => ({
  ...(await original<object>()),
  useRpc: () => vi.fn(async () => ({ revealed: null, error: null })),
}));

vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => react.createElement("Icon", props),
    ScrollView: rn.ScrollView,
    copyText: async () => {},
    useToast: () => ({ show() {}, error() {} }),
  };
});

import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { sampleCards } from "../../client/tasks/sample-cards";
import type { TaskCard } from "../../client/tasks/model";
import { TaskDetailCards } from "../../client/tasks/cards";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { settleHostLayout } from "./helpers/yoga-host-layout";

const NOW = Date.parse("2026-10-20T09:00:00.000Z");
const THEME = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f7f7f8",
    surface2: "#efeff1",
    border: "#e2e2e6",
    foreground: "#1b1b1f",
    foregroundMuted: "#6b6b75",
    accent: "#3b6fe0",
    accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b",
    statusWarning: "#a36a00",
    statusDanger: "#d93636",
  },
};

/** The title's authored line height; the board's base step is 20. */
const TITLE_LINE = 20;
const SIDEBAR_WIDTH = 320;

let renderer: ReactTestRenderer | null = null;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
});

function card(title: string): TaskCard {
  const sample = sampleCards(NOW).find((candidate) => candidate.id === "sample-running");
  if (!sample) throw new Error("no sample card");
  return { ...sample, title };
}

function host(root: ReactTestInstance, testID: string): ReactTestInstance {
  return root.find((node) => typeof node.type === "string" && node.props.testID === testID);
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
}

async function mount(title: string): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(TaskDetailCards, { card: card(title), theme: THEME, now: NOW, language: "en", strings: BOARD_STRINGS.en.sidebar }),
    );
  });
  // Reduced motion arrives from AccessibilityInfo after the subscription.
  await act(async () => {
    await Promise.resolve();
  });
  return renderer!;
}

const settle = (tree: ReactTestRenderer) => settleHostLayout(() => host(tree.root, "detail-cards"), { width: SIDEBAR_WIDTH, wrapText: true });

describe("detail title fold", () => {
  it("shows five lines of a long title under the fade, then all of it", async () => {
    const sentence = "A generated title that keeps going well past the five lines a sidebar card shows before it folds, so the reader sees the start of the work and opens the rest from the row under it.";
    const tree = await mount(`${sentence} ${sentence}`);
    const frames = await settle(tree);
    const measure = () => host(tree.root, "detail-title-measure");
    const body = () => host(tree.root, "detail-title-text");
    const measured = frames.get(measure())!;
    expect(measured.height).toBeGreaterThan(5 * TITLE_LINE);
    expect(frames.get(body())!.height).toBe(5 * TITLE_LINE);
    expect(host(tree.root, "detail-title-fade")).toBeDefined();
    expect(textOf(host(tree.root, "detail-title-more"))).toBe(`Show all \u00b7 ${Math.round(measured.height / TITLE_LINE)} lines`);

    await act(async () => host(tree.root, "detail-title-more").props.onPress());
    const expanded = await settle(tree);
    expect(expanded.get(body())!.height).toBe(expanded.get(measure())!.height);
    expect(tree.root.findAll((node) => node.props.testID === "detail-title-fade")).toHaveLength(0);
    expect(textOf(host(tree.root, "detail-title-more"))).toBe("Show less");
  });

  it("keeps a title that fits whole, with no fold row", async () => {
    const tree = await mount("Short title");
    const frames = await settle(tree);
    const measured = frames.get(host(tree.root, "detail-title-measure"))!;
    expect(measured.height).toBeLessThanOrEqual(5 * TITLE_LINE);
    expect(frames.get(host(tree.root, "detail-title-text"))!.height).toBe(measured.height);
    expect(tree.root.findAll((node) => node.props.testID === "detail-title-more")).toHaveLength(0);
  });
});
