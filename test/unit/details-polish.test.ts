import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: vi.fn(async () => {}), useToast: () => ({ show: vi.fn(), error: vi.fn() }), useRevealedText: (text: string) => text };
});
import { ANDROID_NAV_FALLBACK, androidBottomInset } from "../../client/details/shell/safe-area";
import { RowMenu } from "../../client/details/row-menu";
import { buildThemeTokens } from "../../client/components/theme-tokens";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

// Android leaves the details panel no bottom inset of its own: under
// edge-to-edge the Modal reaches under the navigation bar (QA round 2).
describe("Android bottom inset", () => {
  it("keeps nothing clear when the Modal stops above the navigation bar", () => {
    expect(androidBottomInset(796, 844, 796, 24)).toBe(0);
  });

  it("reads the bar from the screen and window when the window leaves it out", () => {
    expect(androidBottomInset(844, 844, 820, 24)).toBe(24);
    expect(androidBottomInset(844, 844, 796, 24)).toBe(48);
    // A window that leaves out the status bar as well.
    expect(androidBottomInset(844, 844, 772, 24)).toBe(48);
  });

  it("falls back to the gesture bar when an edge-to-edge window leaves nothing out", () => {
    expect(androidBottomInset(844, 844, 844, 24)).toBe(ANDROID_NAV_FALLBACK);
    expect(ANDROID_NAV_FALLBACK).toBe(24);
  });
});

describe("row menu", () => {
  it("draws no scroll track beside its items", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(createElement(RowMenu, {
        anchor: { x: 0, y: 300, width: 390, height: 28 }, title: "npm test", hasBody: true,
        copyItems: [{ id: "output", label: "Copy output", icon: "Copy", text: "ok" }], tokens,
        onOpen() {}, onExpand() {}, onClose() {},
      }));
    });
    const scroller = renderer.root.findAll((node) => (node.type as unknown) === "ScrollView")[0]!;
    expect(scroller.props.showsVerticalScrollIndicator).toBe(false);
    act(() => renderer.unmount());
  });
});
