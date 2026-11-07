import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

type HighlightAnswer = {
  lines: unknown[];
  language: string | null;
  theme: string;
};

const rpc = vi.hoisted(() => ({
  call: vi.fn(async (_input: unknown): Promise<HighlightAnswer | null> => null),
}));

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpc.call }));
vi.mock("@getpaseo/plugin/client/react-native", async () => ({
  Icon: (await import("./helpers/rn-mock")).View,
  copyText: vi.fn(async (_text: string) => {}),
  useToast: () => ({ show: vi.fn(), error: vi.fn() }),
}));

import { buildThemeTokens } from "../../client/components/theme-tokens";
import { SyntaxHighlightBlock } from "../../client/components/syntax-highlight";


const SURFACE = {
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
};

/** Every colour the block painted, whatever role carried it. */
function paintedColours(renderer: ReactTestRenderer): string[] {
  const found: string[] = [];
  for (const node of renderer.root.findAll((n) => (n.type as unknown) === "Text")) {
    const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
    for (const style of styles) {
      const color = (style as { color?: string } | undefined)?.color;
      if (typeof color === "string") found.push(color.toLowerCase());
    }
  }
  return found;
}

/** Builds tokens the way a rendering component does, so the palette is current. */
async function draw(options?: Parameters<typeof buildThemeTokens>[2], highlight = false) {
  const tokens = buildThemeTokens(SURFACE, undefined, options);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    // `highlight: false` is what a streaming fence asks for: no daemon answer
    // can have arrived yet, so only the local tokeniser paints.
    renderer = TestRenderer.create(
      React.createElement(SyntaxHighlightBlock, { code: "const x = \"text\";", tokens, highlight }),
    );
  });
  return renderer;
}

afterEach(() => {
  rpc.call.mockReset();
  rpc.call.mockImplementation(async () => null);
});

describe("a streaming fence follows the reader's syntax theme", () => {
  it("colours the first fence from the setting, with nothing answered yet", async () => {
    const plain = await draw();
    expect(paintedColours(plain)).toContain("#c678dd");
    act(() => plain.unmount());

    const tokyo = await draw({ syntaxTheme: "tokyo-night" });
    const colours = paintedColours(tokyo);
    expect(colours).toContain("#9d7cd8");
    expect(colours).not.toContain("#c678dd");
    // An open fence has no answer to wait for, so its colours come from this
    // build alone; asking the daemon would be a round trip per theme switch.
    expect(rpc.call).not.toHaveBeenCalled();
    act(() => tokyo.unmount());
  });
});
