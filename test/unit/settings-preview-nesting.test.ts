import React from "react";
import { describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

// React Native Web draws role "button" as <button>, and a <button> inside a
// <button> is invalid HTML: React warns "button cannot contain a nested
// button" and flags a hydration error. The settings page showed it from its
// preview's Read and Edit rows, whose path sat inside the row's button.

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: async () => {}, useToast: () => ({ show() {}, error() {} }), useRevealedText: (text: string) => text };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { SettingsPreview } from "../../client/settings-preview";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-strings";
import { DEFAULT_PREFERENCES } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

const isButton = (node: ReactTestInstance) => typeof node.type === "string" && (node.props.role ?? node.props.accessibilityRole) === "button";

function nestedButtons(root: ReactTestInstance): string[] {
  const out: string[] = [];
  for (const node of root.findAll(isButton)) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (isButton(parent)) {
        out.push(`${String(node.props.accessibilityLabel)} in ${String(parent.props.accessibilityLabel)}`);
        break;
      }
    }
  }
  return out;
}

describe("the settings preview", () => {
  it.each([[true, true], [true, false], [false, true], [false, false]])("nests no button in a button (compact %s, hover preview %s)", (compact, hoverPreview) => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    for (const language of ["en", "zh"] as const) {
      act(() => {
        renderer = TestRenderer.create(React.createElement(SettingsPreview, {
          tokens, preferences: { ...DEFAULT_PREFERENCES, hoverPreview }, compact, t: SETTINGS_STRINGS[language],
        }));
      });
      expect(nestedButtons(renderer.root)).toEqual([]);
      act(() => renderer.unmount());
    }
  });
});
