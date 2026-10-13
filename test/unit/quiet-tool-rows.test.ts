import { describe, expect, it, vi } from "vitest";

// Tool rows sit one step behind the prose at rest and come back to full
// contrast on hover, press or when opened (docs/prototypes/quiet-tool-rows.md).

vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput, copyText: async () => {}, useToast: () => ({ show() {}, error() {} }) };
});

const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { rowPalette } = await import("../../client/ui/disclosure-header");

// The reference palettes the design was drawn on.
const LIGHT = {
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#2563eb", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
};
const DARK = {
  surface0: "#0f0f11", surface1: "#17171a", surface2: "#1f1f23", border: "#2a2a30",
  foreground: "#f2f3f5", foregroundMuted: "#a3a6ad", accent: "#7aa2f7", accentForeground: "#0f0f11",
  statusSuccess: "#4cb782", statusWarning: "#d9a53f", statusDanger: "#f2555a",
};

describe("quiet tool rows", () => {
  it("derives the design's light values from the theme", () => {
    const row = buildThemeTokens(LIGHT, undefined, { platform: "web" }).row;
    expect(row).toMatchObject({
      target: "#62626b",
      targetActive: "#3d3d43",
      meta: "#72727a",
      icon: "#919197",
      outputBg: "#f9f9f9",
      outputText: "#2b2b2f",
    });
  });

  it("derives the design's dark values from the theme", () => {
    const row = buildThemeTokens(DARK, undefined, { platform: "web" }).row;
    expect(row).toMatchObject({
      target: "#a3a6ad",
      targetActive: "#cbcdd1",
      meta: "#94979d",
      icon: "#77797e",
      outputBg: "#151517",
      outputText: "#dee0e3",
    });
  });

  it("quiets a finished row and raises it on hover, press or open", () => {
    const tokens = buildThemeTokens(LIGHT, undefined, { platform: "web" });
    const rest = rowPalette(tokens, "quiet", false);
    expect(rest.target).toBe(tokens.row.target);
    expect(rest.meta).toBe(tokens.row.meta);
    expect(rest.diffAdd).toBe(tokens.row.diffAdd);
    const lit = rowPalette(tokens, "quiet", true);
    expect(lit).toEqual({
      target: tokens.foreground,
      meta: tokens.foregroundMuted,
      icon: tokens.foregroundMuted,
      diffAdd: tokens.success,
      diffDel: tokens.danger,
    });
  });

  it("draws a running row halfway back and never dims a waiting question", () => {
    const tokens = buildThemeTokens(DARK, undefined, { platform: "web" });
    const running = rowPalette(tokens, "active", false);
    expect(running.target).toBe(tokens.row.targetActive);
    expect(running.meta).toBe(tokens.foregroundMuted);
    expect(rowPalette(tokens, "loud", false)).toEqual(rowPalette(tokens, "quiet", true));
  });
});
