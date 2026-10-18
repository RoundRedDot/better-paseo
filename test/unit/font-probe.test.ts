import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => ({
  ...await import("./helpers/rn-mock"), UIManager: { hasViewManagerConfig: () => true },
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ copyText: vi.fn() }));

import { CommandFontProbe } from "../../client/debug/font-probe";
import { beginFontProbe, fontProbeSnapshot, resetFontProbe, type FontProbeMetadata } from "../../client/debug/font-probe-store";
import { disablePerf, enablePerf, resetPerf } from "../../client/debug/perf";
import { perfSlashCommand } from "../../client/debug/perf-command";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ProseSelectionContext } from "../../client/ui/prose-text";
import { StyleSheet } from "./helpers/rn-mock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockOS = globalThis as { __rnMockOS?: string };
const metadata: FontProbeMetadata = {
  runtimePlatform: "android", tokenPlatform: "android", family: "monospace", size: 12,
  weight: null, fontStyle: null, letterSpacing: null, monoSource: "paseo-default", selectionContext: true,
};
const colors = {
  surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
  foregroundMuted: "#666", accent: "#06c", accentForeground: "#fff", statusSuccess: "#080",
  statusWarning: "#a60", statusDanger: "#c00",
};

afterEach(() => {
  act(() => disablePerf());
  resetPerf();
  mockOS.__rnMockOS = undefined;
});

describe("command font capture", () => {
  it("requires two positive finite measurements before comparing widths", () => {
    const record = beginFontProbe(metadata);
    record("narrow", 0);
    record("wide", NaN);
    expect(fontProbeSnapshot()).toMatchObject({ narrowWidth: null, wideWidth: null, equalWidths: null });
    record("narrow", 64);
    expect(fontProbeSnapshot()?.equalWidths).toBeNull();
    record("wide", 64.25);
    expect(fontProbeSnapshot()?.equalWidths).toBe(true);
    record("wide", 96);
    expect(fontProbeSnapshot()?.equalWidths).toBe(false);
  });

  it("ignores stale panel events and invalidates callbacks on reset", () => {
    const old = beginFontProbe(metadata);
    const current = beginFontProbe({ ...metadata, family: "other" });
    old("narrow", 10);
    expect(fontProbeSnapshot()?.narrowWidth).toBeNull();
    current("narrow", 64);
    const copy = fontProbeSnapshot()!;
    copy.narrowWidth = 999;
    expect(fontProbeSnapshot()?.narrowWidth).toBe(64);
    resetFontProbe();
    current("wide", 64);
    expect(fontProbeSnapshot()).toBeNull();
  });

  it("exports the capture through the existing dump RPC and clears it with reset", async () => {
    beginFontProbe(metadata)("narrow", 64);
    const rpc = vi.fn().mockResolvedValue({ path: "/tmp/font-dump.json", error: null });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      if (perfSlashCommand.context !== "agent") throw new Error("Expected an agent command");
      await perfSlashCommand.onSubmit({ args: "dump fonts", agent: { id: "a" }, rpc } as unknown as
        Parameters<typeof perfSlashCommand.onSubmit>[0]);
      expect(rpc.mock.calls[0]?.[1]).toMatchObject({
        label: "fonts", data: { commandFont: { family: "monospace", narrowWidth: 64, equalWidths: null } },
      });
      resetPerf();
      expect(fontProbeSnapshot()).toBeNull();
    } finally {
      log.mockRestore();
    }
  });
});

describe("command font probe rendering", () => {
  it("mounts no measurement views while disabled", () => {
    const tokens = buildThemeTokens(colors, undefined, { platform: "android" });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(CommandFontProbe, { tokens, style: {} })); });
    expect(renderer.toJSON()).toBeNull();
    expect(fontProbeSnapshot()).toBeNull();
    act(() => renderer.unmount());
  });

  it.each(["android", "ios"] as const)("measures fixed samples through the %s command selection path", (platform) => {
    mockOS.__rnMockOS = platform;
    act(() => enablePerf());
    const tokens = buildThemeTokens(colors, undefined, { platform });
    const style = { fontFamily: tokens.fontMono, fontSize: 12, lineHeight: 18 };
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(ProseSelectionContext.Provider, { value: true },
        React.createElement(CommandFontProbe, { tokens, style })));
    });
    const probe = renderer.root.findByProps({ testID: "command-font-probe" });
    expect(StyleSheet.flatten(probe.props.style)).toMatchObject({ position: "absolute", opacity: 0 });
    expect(probe.props.importantForAccessibility).toBe("no-hide-descendants");
    const textNodes = renderer.root.findAll((node) => (node.type as unknown) ===
      (platform === "ios" ? "RNUITextViewChild" : "Text"));
    expect(textNodes.map((node) => platform === "ios" ? node.props.text : node.props.children))
      .toEqual(["iiiiiiii", "WWWWWWWW"]);
    for (const node of textNodes) expect(StyleSheet.flatten(node.props.style).fontFamily).toBe(tokens.fontMono);
    act(() => {
      for (const sample of ["narrow", "wide"]) {
        renderer.root.findByProps({ testID: `command-font-probe-${sample}` }).props.onLayout({ nativeEvent: { layout: { width: 64 } } });
      }
    });
    expect(fontProbeSnapshot()).toMatchObject({
      runtimePlatform: platform, tokenPlatform: platform, family: tokens.fontMono,
      selectionContext: true, narrowWidth: 64, wideWidth: 64, equalWidths: true,
    });
    act(() => renderer.update(React.createElement(ProseSelectionContext.Provider, { value: true },
      React.createElement(CommandFontProbe, { tokens, style: { ...style, fontFamily: "unavailable-test-font" } }))));
    expect(fontProbeSnapshot()).toMatchObject({ family: "unavailable-test-font", narrowWidth: null, wideWidth: null });
    const pendingLayout = renderer.root.findByProps({ testID: "command-font-probe-narrow" }).props.onLayout;
    act(() => disablePerf());
    expect(renderer.toJSON()).toBeNull();
    pendingLayout({ nativeEvent: { layout: { width: 999 } } });
    expect(fontProbeSnapshot()?.narrowWidth).toBeNull();
    act(() => renderer.unmount());
  });
});
