import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

const state = vi.hoisted(() => ({ pointer: true }));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { TextInput: rn.TextInput, useToast: () => ({ show() {}, error() {} }) };
});
vi.mock("../../client/ui/use-input-capabilities", () => ({
  useInputCapabilities: (compact = false) => ({ hover: state.pointer, touch: !state.pointer, compact, native: false }),
}));
vi.mock("../../client/state/preference-sync-slot", () => ({ usePreferenceSettings: () => ({ status: "ready", failed: false }) }));
vi.mock("../../client/ui/host-appearance-shim", () => ({ useHostAppearance: () => null }));
vi.mock("../../client/i18n/host-language", async (original) => ({
  ...await original<object>(),
  useHostLanguageVersion() {},
}));
vi.mock("../../client/ui/wide-host-column", () => ({ useWideHostColumn() {} }));
vi.mock("../../client/settings-preview", () => ({ SettingsPreview: () => null }));
vi.mock("../../client/tasks/settings/tasks-panel", () => ({ TasksEntrySection: () => null, TasksSettingsPanel: () => null }));
vi.mock("../../client/settings-tab", () => ({ useSettingsTab: () => "display", setSettingsTab() {} }));
vi.mock("../../client/components/embed-fonts", () => ({ ensureEmbeddedFonts() {} }));

import { DEFAULT_PREFERENCES, getEnhancerPreferences, resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { BetterPaseoSettingsPage } from "../../client/settings-page";
import { toolbarLabel } from "../../client/i18n/toolbar-strings";
import { preferencesSchema } from "../../shared/preferences-settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
  colors: {
    surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
    foreground: "#18181b", foregroundMuted: "#62626b", accent: "#2563eb", accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
  },
};

type Renderer = ReturnType<typeof TestRenderer.create>;
type Node = Renderer["root"];
const textOf = (node: ReactTestInstance): string => node.children.map((child) =>
  typeof child === "string" ? child : textOf(child as ReactTestInstance),
).join("");

function renderPage(): Renderer {
  let renderer!: Renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
      theme: theme as never,
      layout: { platform: "web", compact: false } as never,
      host: {} as never,
    }));
  });
  return renderer;
}

function switchControl(root: Node, label: string): ReactTestInstance {
  return root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "switch" && node.props.accessibilityLabel === label);
}

function choiceGroup(root: Node, label = "Click on a row"): ReactTestInstance | undefined {
  return root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "radiogroup" && node.props.accessibilityLabel === label)[0];
}

afterEach(() => {
  resetEnhancerPreferences();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

beforeEach(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  state.pointer = true;
  resetEnhancerPreferences();
});

describe("block details settings", () => {
  it("turns details on by default and drops a stored row-click choice", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ blockDetails: true });
    expect(DEFAULT_PREFERENCES).not.toHaveProperty("rowClick");
    expect(preferencesSchema.parse({})).toMatchObject({ blockDetails: true });
    expect(preferencesSchema.parse({ blockDetails: false })).toMatchObject({ blockDetails: false });
    for (const rowClick of ["details", "expand", "invalid"]) {
      const parsed = preferencesSchema.parse({ blockDetails: true, rowClick, previewWrap: false });
      expect(parsed).toMatchObject({ blockDetails: true, previewWrap: false });
      expect(parsed).not.toHaveProperty("rowClick");
    }
  });

  it("shows the toggle, and no row-click choice with a pointer or without", () => {
    updateEnhancerPreferences({ blockDetails: false });
    const renderer = renderPage();
    expect(switchControl(renderer.root, "Block details panel (preview)").props["aria-checked"]).toBe(false);
    act(() => switchControl(renderer.root, "Block details panel (preview)").props.onPress());
    expect(getEnhancerPreferences().blockDetails).toBe(true);
    expect(choiceGroup(renderer.root)).toBeUndefined();

    state.pointer = false;
    act(() => renderer.update(React.createElement(BetterPaseoSettingsPage, {
      theme: theme as never,
      layout: { platform: "web", compact: false } as never,
      host: {} as never,
    })));
    expect(choiceGroup(renderer.root)).toBeUndefined();
    act(() => renderer.unmount());
  });

  it("renders the new labels in Chinese", () => {
    updateEnhancerPreferences({ language: "zh", blockDetails: true });
    const renderer = renderPage();
    const text = renderer.root.findAll((node) => typeof node.type === "string" && (node.type as unknown) === "Text").map(textOf).join("\n");
    expect(text).toContain("区块详情面板（预览）");
    expect(text).toContain("点按行可在抽屉或面板中阅读；长按可显示操作。");
    expect(text).not.toContain("点击行身");
    act(() => renderer.unmount());
  });

  it("translates the block-details toolbar labels and streamed line count", () => {
    const labels = [
      "Open details", "Expand in timeline", "Collapse in timeline", "View image", "Copy title", "Close menu", "Code",
      "running", "completed", "failed", "Thinking", "Completed", "Previous block", "Next block",
      "Close details", "Full screen", "Exit full screen", "Widen panel", "Restore panel width", "Open in panel", "More", "Back to latest",
    ];
    for (const label of labels) expect(toolbarLabel(label, "zh")).not.toBe(label);
    expect(toolbarLabel("5 new lines", "zh")).toBe("5 行新输出");
    expect(toolbarLabel("Back to latest · 5 new lines", "zh")).toBe("回到最新 · 5 行新输出");
    expect(toolbarLabel("{count} new lines", "zh")).toBe("{count} 行新输出");
    expect(toolbarLabel("1 new line", "zh")).toBe("1 行新输出");
  });
});
