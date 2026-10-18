import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => ({
  ...await import("./helpers/rn-mock"), UIManager: { hasViewManagerConfig: () => true },
}));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => async () => null }));
vi.mock("@getpaseo/plugin/client/react-native", async () => ({
  Icon: (await import("./helpers/rn-mock")).View,
  copyText: vi.fn(), useToast: () => ({ show: vi.fn(), error: vi.fn() }),
}));

import { DiffPreview } from "../../client/components/tool-output";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ProseSelectionContext } from "../../client/ui/prose-text";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#06c", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

describe("diff preview native text fragments", () => {
  it.each([
    ["x.ts", "  const keep = 1;\n--const old = 2; // comment\n++const next = 3;"],
    ["x.html", '  <div title="keep">\n--<p>old</p>\n++<p>new</p>'],
    ["x.css", "  .keep { color: red; }\n--.old {}\n++.new { color: blue; }"],
  ])("preserves every character and combined marker in the iOS text view for %s", async (filename, body) => {
    const text = `@@@ -1,2 -1,2 +1,2 @@@\n${body}`;
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(ProseSelectionContext.Provider, { value: true },
        React.createElement(DiffPreview, { text, filename, style: {}, tokens })));
    });
    const root = renderer.root.find((node) => (node.type as unknown) === "RNUITextView");
    const fragments = root.findAll((node) => (node.type as unknown) === "RNUITextViewChild");
    expect(fragments.map((node) => node.props.text).join("")).toBe(text);
    expect(root.findAll((node) => (node.type as unknown) === "Text")).toHaveLength(0);
    act(() => renderer.unmount());
  });
});
