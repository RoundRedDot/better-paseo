/**
 * S6: the plugin side of the host's sticky card header API (Paseo H2b).
 *
 * The hook exists only on hosts built with it (`bc/sticky`); a stock 0.11.2
 * host injects `@getpaseo/plugin/client/react-native` without the key. These
 * tests load the real components once per host shape and check feature
 * detection, the enable rule, and what a collapsed row costs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const pluginClient = () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => ({}),
  useSettings: () => ({ data: undefined, status: "loading" }),
});

/** A stand-in for the host's interpolation node. */
function fakeNode(label: string) {
  return { label, interpolate: () => ({ label: `${label}:rule` }) };
}

async function load(shape: "stock" | "sticky") {
  vi.resetModules();
  const hook = vi.fn((_options: { headerHeight: number; enabled: boolean }) => fakeNode("translateY"));
  vi.doMock("react-native", () => import("./helpers/rn-mock"));
  vi.doMock("@getpaseo/plugin/client/react-native", async () => {
    const rn = await import("./helpers/rn-mock");
    const stock = {
      Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
      TextInput: rn.TextInput,
      ScrollView: rn.ScrollView,
      FlatList: rn.ScrollView,
      Modal: rn.View,
      copyText: () => Promise.resolve(true),
      useToast: () => ({ show() {}, error() {}, success() {} }),
      useRevealedText: (text: string) => text,
    };
    return shape === "sticky" ? { ...stock, useTimelineStickyHeader: hook } : stock;
  });
  vi.doMock("@getpaseo/plugin/client", pluginClient);
  await import("./helpers/quiet-renderer");
  const TestRenderer = (await import("react-test-renderer")).default;
  const { act } = await import("react-test-renderer");
  const { countHostViews } = await import("./helpers/host-count");
  const sticky = await import("../../client/ui/sticky-header");
  const { buildThemeTokens } = await import("../../client/components/theme-tokens");
  const { ToolCallout } = await import("../../client/components/tool-callouts");
  const { classifyTool } = await import("../../client/tools/classify");
  const tokens = buildThemeTokens({
    surface0: "#0f1115",
    surface1: "#16191f",
    surface2: "#1d2128",
    border: "#2a2f37",
    foreground: "#e6e8eb",
    foregroundMuted: "#9aa1ab",
    accent: "#4f8cff",
    accentForeground: "#ffffff",
    statusSuccess: "#4cb782",
    statusWarning: "#d9a53f",
    statusDanger: "#e5484d",
  });
  const data = classifyTool({
    name: "Bash",
    status: "completed",
    callId: "sticky-1",
    error: null,
    detail: { type: "shell", command: "npm test", output: "line\n".repeat(40), exitCode: 0, durationMs: 1200 },
  });
  const card = (expanded: boolean) =>
    React.createElement(ToolCallout, { data, tokens, compact: true, expanded, onExpandedChange: () => {} });
  return { hook, sticky, TestRenderer, act, countHostViews, card };
}

afterEach(() => {
  vi.doUnmock("react-native");
  vi.doUnmock("@getpaseo/plugin/client/react-native");
  vi.doUnmock("@getpaseo/plugin/client");
});

describe("resolveStickyHook", () => {
  it("finds the hook only where the host provides a function", async () => {
    const { sticky } = await load("stock");
    const hook = () => null;
    expect(sticky.resolveStickyHook({ useTimelineStickyHeader: hook })).toBe(hook);
    expect(sticky.resolveStickyHook({})).toBeNull();
    expect(sticky.resolveStickyHook({ useTimelineStickyHeader: 1 })).toBeNull();
    expect(sticky.resolveStickyHook(undefined)).toBeNull();
    expect(sticky.resolveStickyHook(null)).toBeNull();
  });

  it("reports the host shape it was loaded on", async () => {
    expect((await load("stock")).sticky.STICKY_SUPPORTED).toBe(false);
    expect((await load("sticky")).sticky.STICKY_SUPPORTED).toBe(true);
  });
});

describe("shouldStick", () => {
  it("pins only an expanded card taller than 60% of the viewport", async () => {
    const { sticky } = await load("stock");
    expect(sticky.shouldStick(true, 507, 844)).toBe(true);
    expect(sticky.shouldStick(true, 506, 844)).toBe(false);
    expect(sticky.shouldStick(false, 2000, 844)).toBe(false);
    expect(sticky.shouldStick(true, 2000, 0)).toBe(false);
  });
});

describe("tool card on a stock 0.11.2 host", () => {
  it("draws exactly as before: no shell, no hook", async () => {
    const { countHostViews, card, hook } = await load("stock");
    const collapsed = countHostViews(card(false));
    const expanded = countHostViews(card(true));
    // Row, slot, icon, target, meta: the verb is drawn with row labels on only.
    expect(collapsed.views).toBe(5);
    expect(expanded.byType["Animated.View"] ?? 0).toBe(1); // the body's fade only
    expect(hook).not.toHaveBeenCalled();
  });
});

describe("tool card on a host with the sticky API", () => {
  it("costs a collapsed row nothing: same views, the hook is never called", async () => {
    const { countHostViews, card, hook } = await load("sticky");
    expect(countHostViews(card(false)).views).toBe(5);
    expect(hook).not.toHaveBeenCalled();
  });

  it("adds the verb, and only the verb, with icons and labels", async () => {
    const { countHostViews, card } = await load("sticky");
    const { updateEnhancerPreferences } = await import("../../client/preferences");
    updateEnhancerPreferences({ rowLabelStyle: "both" });
    expect(countHostViews(card(false)).views).toBe(6);
  });

  it("swaps the icon for the verb with labels only", async () => {
    const { countHostViews, card } = await load("sticky");
    const { updateEnhancerPreferences } = await import("../../client/preferences");
    updateEnhancerPreferences({ rowLabelStyle: "label" });
    expect(countHostViews(card(false)).views).toBe(5);
  });

  it("binds the transform on an expanded card and enables it once the card passes 60% of the window", async () => {
    const { TestRenderer, act, card, hook } = await load("sticky");
    let renderer: ReturnType<typeof TestRenderer.create> | undefined;
    act(() => {
      renderer = TestRenderer.create(card(true));
    });
    // A short card: the hook runs disabled, and the transform is bound to its value.
    expect(hook).toHaveBeenLastCalledWith({ headerHeight: 28, enabled: false });
    const shell = () =>
      renderer!.root.findAll(
        (node) => (node.type as unknown) === "Animated.View" && JSON.stringify(node.props.style ?? "").includes("transform"),
      );
    expect(shell()).toHaveLength(1);

    // The body lays out taller than 60% of an 844pt window.
    const body = renderer!.root.findAll((node) => (node.type as unknown) === "View" && typeof node.props.onLayout === "function");
    act(() => body[0]!.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 900 } } }));
    expect(hook).toHaveBeenLastCalledWith({ headerHeight: 28, enabled: true });
    expect(shell()).toHaveLength(1);

    // Growing further does not re-render: only the threshold crossing does.
    const calls = hook.mock.calls.length;
    act(() => body[0]!.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 1400 } } }));
    expect(hook.mock.calls.length).toBe(calls);

    // Collapsing while pinned unmounts the shell: the row is plain again.
    act(() => renderer!.update(card(false)));
    expect(shell()).toHaveLength(0);
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Pressable").length).toBeGreaterThan(0);
    act(() => renderer!.unmount());
  });
});
