import type { PluginServerContext } from "@getpaseo/plugin/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import { buildThemeTokens } from "../../client/components/theme-tokens";
import { LIGHT_SYNTAX_THEMES } from "../../server/light-syntax-themes";
import { PASEO_SYNTAX_THEMES, type PaseoSyntaxThemeId } from "../../client/ui/tokens/host-appearance-shim";

interface Answer {
  lines: unknown[];
  language: string | null;
  theme: string;
}

type Handler = (input: unknown) => Promise<Answer>;

/** The daemon's `highlight` handler, out of the route the plugin registers. */
async function highlightHandler(): Promise<Handler> {
  const { default: contribute } = await import("../../index.server");
  const handlers = new Map<string, Handler>();
  const server = new Proxy({}, {
    get: (_, key) => key === "registerSettings"
      ? () => ({ read: async () => ({ status: "invalid", revision: "test", error: "test" }), subscribe: () => () => {} })
      : key === "handle"
        ? (contract: { name: string }, handler: Handler) => handlers.set(contract.name, handler)
        : () => () => {},
  }) as PluginServerContext;
  contribute(server);
  return handlers.get("highlight.tokens")!;
}

const CODE = 'const x = 1;\nobj.method("text");\n// a comment';

/** The surfaces the plugin treats as dark and light. */
const DARK_SURFACE = {
  surface0: "#0f1115", surface1: "#16191f", surface2: "#1d2128", border: "#2a2f37",
  foreground: "#e6e8eb", foregroundMuted: "#9aa1ab", accent: "#4f8cff", accentForeground: "#ffffff",
  statusSuccess: "#4cb782", statusWarning: "#d9a53f", statusDanger: "#e5484d",
};
const LIGHT_SURFACE = { ...DARK_SURFACE, surface0: "#fbfcfd" };

/** The six roles the client colours a streaming fence with, for one id and scheme. */
function clientPalette(syntaxTheme: PaseoSyntaxThemeId, dark: boolean): Record<string, string> {
  const { keyword, string, number, comment, property, function: fn } =
    buildThemeTokens(dark ? DARK_SURFACE : LIGHT_SURFACE, undefined, { syntaxTheme }).syntax;
  // Theme files disagree about hex case, so compare without it.
  return { keyword, string, number, comment, property, function: fn };
}

const normalise = (palette: Record<string, string>) =>
  Object.fromEntries(Object.entries(palette).map(([role, color]) => [role, color.toLowerCase()]));

describe("the daemon follows Paseo's syntax theme", () => {
  it.each([
    ["one", "dark", "one-dark-pro"],
    ["catppuccin", "light", "catppuccin-latte"],
    ["gruvbox", "dark", "gruvbox-dark-medium"],
    ["solarized", "light", "solarized-light"],
    ["tokyo-night", "dark", "tokyo-night"],
    // The three families Shiki has no light flavour for and this plugin vendors.
    ["tokyo-night", "light", "tokyo-night-light"],
    ["dracula", "light", "alucard"],
    ["nord", "light", "polar"],
    // A client that names no theme gets today's pair.
    [undefined, "dark", "github-dark-default"],
    // Only an id this table does not know falls back.
    ["unknown-id", "dark", "github-dark-default"],
  ] as const)("maps %s (%s) to %s", async (syntaxTheme, scheme, theme) => {
    const answer = await (await highlightHandler())({
      code: CODE,
      language: "typescript",
      dark: scheme === "dark",
      syntaxTheme,
    });
    expect(answer.theme).toBe(theme);
  }, 30_000);

  it("streams the same palette the daemon highlights with", async () => {
    const handler = await highlightHandler();
    const [core, regex] = await Promise.all([
      import("@shikijs/core"),
      import("@shikijs/engine-javascript"),
    ]);
    const highlighter = await core.createHighlighterCore({
      themes: [],
      langs: [await import("@shikijs/langs/typescript")],
      engine: regex.createJavaScriptRegexEngine({ forgiving: true }),
    });

    // One fixed sample, one marker word per role, so no two roles share a run.
    const probe = (theme: string) => {
      const tokens = highlighter
        .codeToTokens('// BANANA\nconst APPLE = 7;\nfig.KIWI = MANGO("PEACH");', { lang: "typescript", theme })
        .tokens
        .flat();
      const at = (marker: string) => {
        const color = tokens.find((token) => token.content.includes(marker))?.color;
        return typeof color === "string" ? color.toLowerCase() : "";
      };
      return {
        keyword: at("const"),
        string: at("PEACH"),
        number: at("7"),
        comment: at("BANANA"),
        property: at("KIWI"),
        function: at("MANGO"),
      };
    };

    // The theme names come from the daemon itself, so a mapping change here fails
    // against whatever it really painted with rather than a copied list.
    for (const syntaxTheme of PASEO_SYNTAX_THEMES) {
      for (const dark of [true, false]) {
        const theme = (await handler({ code: CODE, language: "typescript", dark, syntaxTheme })).theme;
        if (!highlighter.getLoadedThemes().includes(theme)) {
          // A vendored palette is not an `@shikijs/themes` subpath, so the computed
          // import below cannot reach it; the daemon reads it out of its own build.
          await highlighter.loadTheme(
            LIGHT_SYNTAX_THEMES[theme as keyof typeof LIGHT_SYNTAX_THEMES] ??
              (await import(`@shikijs/themes/${theme}`)).default,
          );
        }
        expect(probe(theme), `${syntaxTheme} ${dark ? "dark" : "light"}`)
          .toEqual(normalise(clientPalette(syntaxTheme, dark)));
      }
    }
  }, 120_000);

  it("tokenises the same text differently per theme", async () => {
    const handler = await highlightHandler();
    const ask = async (syntaxTheme: string) =>
      (await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme })).lines;
    expect(await ask("one")).not.toEqual(await ask("nord"));
  }, 30_000);
});
