import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  return {
    Icon: (props: Record<string, unknown>) => react.createElement("Icon", props),
    copyText: vi.fn(),
    useToast: () => ({ show() {}, error() {} }),
  };
});
import "./helpers/quiet-renderer";
import { Platform, StyleSheet } from "react-native";
import { TaskCardView, type TaskCardViewProps } from "../../client/tasks/cards/task-card";
import { sampleCards } from "../../client/tasks/sample-cards";
import { CARD_PRESETS } from "../../shared/tasks-settings";
import { withAlpha } from "../../client/components/theme-tokens";

const NOW = Date.parse("2026-10-20T09:00:00.000Z");
const THEME = {
  colors: {
    surface0: "#18181b", surface1: "#1f1f23", surface2: "#26262b",
    border: "#2e2e33", foreground: "#ededef", foregroundMuted: "#9b9ba5",
    accent: "#3b6fe0", accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d93636",
  },
};
const CARD = sampleCards(NOW).find((card) => card.id === "sample-running")!;
const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style);
const host = (root: ReactTestInstance, testID: string) =>
  root.find((node) => typeof node.type === "string" && node.props.testID === testID);
const button = (root: ReactTestInstance, label: string) =>
  root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === label);

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

async function render(overrides: Partial<TaskCardViewProps> = {}) {
  const preset = CARD_PRESETS.standard;
  const props: TaskCardViewProps = {
    card: CARD, fields: { ...preset.fields, labelLimit: preset.labelLimit },
    theme: THEME, compact: true, permissionButtons: [], stopPhase: "idle",
    focused: false, highlighted: false, now: NOW, language: "en", animated: false,
    onReveal() {}, onStop: vi.fn(), ...overrides,
  };
  await act(async () => { renderer = TestRenderer.create(<TaskCardView {...props} />, {
    createNodeMock: (element) => Platform.OS === "web" || !["task-card-stop", "task-card-stop-menu-stage"].includes((element.props as { testID: string }).testID) ? null : ({
      measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) =>
        (element.props as { testID: string }).testID === "task-card-stop-menu-stage"
          ? callback(0, 24, 390, 800)
          : callback(100, 300, 120, 32),
    }),
  }); });
  return renderer!.root;
}

describe("split Stop button", () => {
  it.each(["ios", "android", "web"])("draws one outline and a separate thin divider on %s", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const root = await render();
    const outline = host(root, "task-card-stop-outline");
    expect(outline.props.pointerEvents).toBe("none");
    expect(flat(outline)).toMatchObject({ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, borderRadius: 7 });
    expect(flat(outline)).toMatchObject(os === "web"
      ? { borderWidth: 0, boxShadow: `inset 0 0 0 0.5px ${THEME.colors.statusDanger}` }
      : { borderWidth: 0.5, borderColor: THEME.colors.statusDanger });
    for (const label of ["Stop", "Stop options"]) {
      const style = flat(button(root, label));
      // No adjoining native borders, per-side colours or negative overlap.
      expect(Object.keys(style).filter((key) => /^(border.*(?:Width|Color)|boxShadow|marginLeft)$/.test(key))).toEqual([]);
    }
    expect(flat(host(root, "task-card-stop-divider"))).toMatchObject({
      position: "absolute", left: 0, top: 0, bottom: 0, width: 0.5,
      backgroundColor: withAlpha(THEME.colors.statusDanger, 0.4),
    });
  });

  it("keeps hover fills independent and the open menu outside the outline", async () => {
    const root = await render();
    await act(async () => button(root, "Stop options").props.onPress());
    expect(flat(button(root, "Stop options")).backgroundColor).not.toBe("transparent");
    expect(flat(button(root, "Stop")).backgroundColor).toBe("transparent");
    const menu = host(root, "task-card-stop-menu");
    expect(flat(menu).top).toBe(0);
    expect(host(root, "task-card-stop-outline").findAll((node) => node.props.testID === "task-card-stop-menu")).toHaveLength(0);
    expect(flat(host(root, "task-card-stop")).overflow).toBeUndefined();
    await act(async () => button(root, "Stop").props.onHoverIn());
    expect(flat(button(root, "Stop")).backgroundColor).not.toBe("transparent");
  });

  it.each(["ios", "android"])("shows an anchored modal above sibling cards and closes it on %s", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const onStop = vi.fn();
    const root = await render({ compact: false, onStop });
    await act(async () => button(root, "Stop options").props.onPress());
    const modal = root.find((node) => (node.type as unknown) === "Modal");
    expect(modal.props).toMatchObject({ transparent: true, animationType: "none" });
    expect(modal.findAll((node) => node.props.testID === "task-card-stop-menu").length).toBeGreaterThan(0);
    await act(async () => modal.props.onShow());
    expect(flat(host(root, "task-card-stop-menu-anchor"))).toMatchObject({ left: 8, top: 312, opacity: 1 });
    const rows = root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem");
    await act(async () => rows[1]!.props.onPress());
    expect(onStop).toHaveBeenCalledWith(CARD, { withChildren: true });
    expect(root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(0);

    await act(async () => button(root, "Stop options").props.onPress());
    await act(async () => host(root, "task-card-stop-menu-backdrop").props.onPress());
    expect(root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(0);
    await act(async () => button(root, "Stop options").props.onPress());
    await act(async () => root.find((node) => (node.type as unknown) === "Modal").props.onRequestClose());
    expect(root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(0);
  });

  it("positions a compact menu above its button in modal coordinates", async () => {
    const root = await render();
    await act(async () => button(root, "Stop options").props.onPress());
    await act(async () => root.find((node) => (node.type as unknown) === "Modal").props.onShow());
    expect(flat(host(root, "task-card-stop-menu-anchor"))).toMatchObject({ left: 8, top: 192, opacity: 1 });
  });

  it("dims the shared outline and disables both actions while stopping", async () => {
    const root = await render({ stopPhase: "stopping" });
    expect(flat(host(root, "task-card-stop-outline")).opacity).toBe(0.6);
    for (const label of ["Stop", "Stop options"]) expect(button(root, label).props.disabled).toBe(true);
    expect(host(root, "task-card-stop-spinner")).toBeTruthy();
  });

  it("keeps the ordinary Stop button's outline when there are no children", async () => {
    const root = await render({ card: { ...CARD, children: [] } });
    expect(flat(button(root, "Stop"))).toMatchObject({ borderWidth: 0.5, borderColor: THEME.colors.statusDanger });
    expect(root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-stop-divider")).toHaveLength(0);
  });
});
