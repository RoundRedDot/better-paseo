import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import { buildThemeTokens } from "../../client/components/theme-tokens";
import type { PaseoSyntaxThemeId } from "../../client/ui/tokens/host-appearance-shim";

// The surfaces the plugin treats as dark and light.
const SURFACE = {
  surface0: "#0f1115", surface1: "#16191f", surface2: "#1d2128", border: "#2a2f37",
  foreground: "#e6e8eb", foregroundMuted: "#9aa1ab", accent: "#4f8cff", accentForeground: "#ffffff",
  statusSuccess: "#4cb782", statusWarning: "#d9a53f", statusDanger: "#e5484d",
};
const LIGHT_SURFACE = { ...SURFACE, surface0: "#fbfcfd" };

/** Colours a streaming fence is drawn with, for one id and scheme. */
const paletteFor = (syntaxTheme: PaseoSyntaxThemeId | undefined, light = false) =>
  buildThemeTokens(light ? LIGHT_SURFACE : SURFACE, undefined, { syntaxTheme }).syntax;

describe("the streaming palette follows the reader's syntax theme", () => {
  // A block that is still being typed never asks the daemon, so its six colours
  // have to come from this build alone.
  it.each([
    [undefined, "#c678dd"],
    ["one", "#c678dd"],
    ["tokyo-night", "#9d7cd8"],
    ["catppuccin", "#cba6f7"],
    ["gruvbox", "#fe8019"],
    ["solarized", "#93a1a1"],
    ["nord", "#81a1c1"],
    ["dracula", "#ff79c6"],
  ] as const)("paints %s keywords %s", (syntaxTheme, keyword) => {
    expect(paletteFor(syntaxTheme).keyword).toBe(keyword);
  });

  // Shiki ships no light flavour for these three, so each reads its own
  // vendored palette rather than GitHub Light.
  it.each([
    ["dracula", "#A3144D"],
    ["tokyo-night", "#7B43BA"],
    ["nord", "#81A1C1"],
  ] as const)("%s keywords %s in a light surface", (syntaxTheme, keyword) => {
    expect(paletteFor(syntaxTheme, true).keyword).toBe(keyword);
    expect(paletteFor(syntaxTheme, true)).not.toEqual(paletteFor("github", true));
  });

  it("tints diffs with the host's status colours, not the syntax theme", () => {
    const first = paletteFor(undefined);
    const last = paletteFor("nord");
    expect(last.diffAddBg).toBe(first.diffAddBg);
    expect(last.diffRemoveBg).toBe(first.diffRemoveBg);
    // Only the six roles follow the syntax theme, so they still differ.
    expect(last.keyword).not.toBe(first.keyword);
  });
});
