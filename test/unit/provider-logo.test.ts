import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
  copyText: vi.fn(async () => {}),
  useToast: () => ({ show: vi.fn(), error: vi.fn() }),
}));

import { normalizeProvider } from "../../client/components/provider-logo";
import { AssistantFooter } from "../../client/components/turn-footer";
import { MARK_IDS, MONO_MARKS, seedMarkBitmaps } from "../../client/components/marks";
import { MARK_BITMAPS } from "../../server/mark-bitmaps";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { StyleSheet } from "./helpers/rn-mock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  delete (globalThis as { __beautifulChatMarkBitmaps?: unknown }).__beautifulChatMarkBitmaps;
});

describe("Pi provider mark", () => {
  it.each([
    ["pi", "pi"], ["Pi", "pi"], ["pi-acp", "pi"],
    ["omp", "omp"], ["oh-my-pi", "omp"], ["Oh My Pi", "omp"],
    ["copilot", "copilot"], ["github-copilot", "copilot"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeProvider(input)).toBe(expected);
  });

  it.each([false, true])("uses the daemon's Pi bitmap in the footer and both detail rows (compact=%s)", (compact) => {
    const id = "provider:pi";
    expect(MARK_IDS.has(id)).toBe(true);
    expect(MONO_MARKS.has(id)).toBe(true);
    expect(MARK_BITMAPS[id]).toMatch(/^data:image\/png;base64,/);
    expect(MARK_BITMAPS[id]).not.toBe(MARK_BITMAPS["provider:omp"]);
    seedMarkBitmaps(MARK_BITMAPS);
    const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
      foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
      statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(AssistantFooter, {
        text: "Reply", at: new Date(0), agentName: "pi", modelName: "Gemini 4 Argon", compact, tokens,
      }));
    });
    try {
      const check = (count: number) => {
        const images = renderer.root.findAllByType("Image" as never);
        expect(images).toHaveLength(count);
        for (const image of images) {
          expect(image.props.source.uri).toBe(MARK_BITMAPS[id]);
          expect(image.props.accessibilityLabel).toBe("Pi");
          expect(StyleSheet.flatten(image.props.style).tintColor).toBe(tokens.foregroundMuted);
        }
      };
      check(1);
      act(() => { renderer.root.findByProps({ testID: "footer-toolbar" }).props.onLongPress(); });
      check(3);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
