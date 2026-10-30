import React from "react";
import { describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

// The settings page renders outside a workspace panel, where the host's
// state hooks throw. Its preview (the Read row's panel drawn open, with the
// preview toolbar) must not call them; a timeline row still does.

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: async () => {}, useToast: () => ({ show() {}, error() {} }), useRevealedText: (text: string) => text };
});
const host = vi.hoisted(() => ({ inPanel: false, agentCalls: 0 }));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => {
    host.agentCalls++;
    if (!host.inPanel) throw new Error("Plugin state hooks must run inside a workspace panel");
    return undefined;
  },
  useWorkspace: () => {
    if (!host.inPanel) throw new Error("Plugin state hooks must run inside a workspace panel");
    return undefined;
  },
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { SettingsPreview } from "../../client/settings-preview";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";
import { DEFAULT_PREFERENCES } from "../../client/preferences";
import { ToolPreviewContent } from "../../client/components/tool-callouts";
import { classifyTool } from "../../client/tools/classify";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

describe("the settings preview outside a workspace panel", () => {
  it.each([true, false])("renders without the host's agent state (compact %s)", (compact) => {
    host.inPanel = false;
    host.agentCalls = 0;
    let renderer!: ReturnType<typeof TestRenderer.create>;
    expect(() => act(() => {
      renderer = TestRenderer.create(React.createElement(SettingsPreview, {
        tokens, preferences: { ...DEFAULT_PREFERENCES, hoverPreview: true }, compact, t: SETTINGS_STRINGS.en,
      }));
    })).not.toThrow();
    expect(renderer.toJSON()).not.toBeNull();
    expect(host.agentCalls).toBe(0);
    act(() => renderer.unmount());
  });

  it("still asks the host for the agent's title in a timeline preview", () => {
    host.inPanel = true;
    host.agentCalls = 0;
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "x" } });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(ToolPreviewContent, { data, tokens, compact: false, resolvePath: (path: string) => path } as never));
    });
    expect(host.agentCalls).toBeGreaterThan(0);
    act(() => renderer.unmount());
  });
});
