import { describe, expect, it, vi } from "vitest";

// A copy button confirms with a toast as well as its check, in the settings page's language.

const toast = { show: vi.fn(), error: vi.fn() };
vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput, copyText: async () => {}, useToast: () => toast };
});

const React = await import("react");
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { CopyButton } = await import("../../client/ui/copy-button");
const { ToolbarCopyButton } = await import("../../client/ui/toolbar-button");
const { updateEnhancerPreferences } = await import("../../client/preferences");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = buildThemeTokens({
  surface0: "#fff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#2563eb", accentForeground: "#fff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
});

async function pressCopy(element: React.ReactElement) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => { renderer = TestRenderer.create(element); });
  const button = renderer.root.find((node) => (node.type as unknown) === "Pressable");
  await act(async () => { button.props.onPress(); });
  act(() => renderer.unmount());
}

describe("copy toast", () => {
  it("names what each button copied, so two copies are told apart", async () => {
    updateEnhancerPreferences({ language: "en" });
    try {
      toast.show.mockClear();
      await pressCopy(React.createElement(CopyButton, { text: "a", tokens, label: "Copy path" }));
      expect(toast.show).toHaveBeenLastCalledWith("Copied path");
      await pressCopy(React.createElement(ToolbarCopyButton, { text: "a", tokens, label: "Copy file content" }));
      expect(toast.show).toHaveBeenLastCalledWith("Copied file content");
      expect(toast.show).toHaveBeenCalledTimes(2);
    } finally {
      updateEnhancerPreferences({ language: "system" });
    }
  });

  it("says it in Chinese when the settings page is in Chinese", async () => {
    updateEnhancerPreferences({ language: "zh" });
    try {
      await pressCopy(React.createElement(ToolbarCopyButton, { text: "a", tokens, label: "Copy path" }));
      expect(toast.show).toHaveBeenLastCalledWith("已复制路径");
      await pressCopy(React.createElement(ToolbarCopyButton, { text: "a", tokens, label: "Copy new content" }));
      expect(toast.show).toHaveBeenLastCalledWith("已复制新内容");
    } finally {
      updateEnhancerPreferences({ language: "system" });
    }
  });
});
