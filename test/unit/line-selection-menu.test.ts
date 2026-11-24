import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const copy = vi.hoisted(() => vi.fn(async (_text: string, _options?: object) => true));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("../../client/ui/use-copy", () => ({ useCopy: () => ({ copy }) }));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: (props: object) => React.createElement("Icon", props), ScrollView: rn.ScrollView,
    Modal: Object.assign((props: Record<string, unknown>) => React.createElement(rn.View, { ...props, testID: "translation-sheet" }), {
      Content: (props: { children?: React.ReactNode }) => React.createElement(rn.View, null, props.children),
    }), TextInput: rn.TextInput };
});
const translate = vi.hoisted(() => vi.fn());
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ data: undefined }),
  usePaseo: () => null,
  useRpc: (definition?: { name?: string }) => definition?.name === "translation.translate" ? translate : async () => null,
}));
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { LineSelectionMenu } = await import("../../client/ui/line-selection");
const { SelectionTranslationScope } = await import("../../client/translation/ui");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { DEFAULT_TIMELINE_TRANSLATION_SETTINGS, publishTranslationSettings, resetTranslationSettingsStoreForTests } = await import("../../client/translation/settings-store");
const { resetTranslationStoreForTests } = await import("../../client/translation/store");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#181818", surface1: "#222222", surface2: "#333333", border: "#444444",
  foreground: "#eeeeee", foregroundMuted: "#999999", accent: "#6688ff", accentForeground: "#ffffff",
  statusSuccess: "#00aa00", statusWarning: "#ffaa00", statusDanger: "#ff0000" });

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetTranslationSettingsStoreForTests();
  resetTranslationStoreForTests();
  translate.mockReset();
  copy.mockClear();
});

const TEXT = "Test Files  339 passed (339)\n     Tests  9830 passed";
function render(scoped: boolean, dismiss = vi.fn()) {
  const menu = React.createElement(LineSelectionMenu, { top: 0, text: TEXT, tokens, dismiss });
  act(() => {
    renderer = TestRenderer.create(scoped
      ? React.createElement(SelectionTranslationScope, { agentId: "agent-1", kind: "tool_output", streaming: false, children: menu })
      : menu);
  });
  return dismiss;
}
const button = (label: string) => renderer!.root.findAll((node) =>
  String(node.type) === "Pressable" && node.props.accessibilityLabel === label);
const enable = (enabled: boolean) => publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled,
  mode: "openai", endpoint: "https://api.example.test/v1", endpointModel: "gpt-5" }, "line-menu");

describe("phone line selection menu", () => {
  it("offers Copy alone outside a conversation", () => {
    render(false);
    expect(button("Copy selected lines")).toHaveLength(1);
    expect(button("Translate selected lines")).toHaveLength(0);
  });

  it("hides Translate when translation is off in settings", () => {
    enable(false);
    render(true);
    expect(button("Copy selected lines")).toHaveLength(1);
    expect(button("Translate selected lines")).toHaveLength(0);
  });

  it("translates the selected lines in a sheet that closes with the selection", async () => {
    enable(true);
    translate.mockResolvedValue({ state: "done", translation: "测试文件 339 个通过", targetLanguageCode: "zh-CN", origin: "https://api.example.test", model: "gpt-5" });
    const dismiss = render(true);
    expect(button("Copy selected lines")).toHaveLength(1);
    await act(async () => button("Translate selected lines")[0]!.props.onPress());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(translate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(translate.mock.calls[0]![0])).toContain("9830 passed");
    expect(JSON.stringify(renderer!.toJSON())).toContain("测试文件 339 个通过");
    // The sheet replaces the menu.
    expect(button("Translate selected lines")).toHaveLength(0);
    const sheet = renderer!.root.find((node) => node.props.testID === "translation-sheet");
    act(() => sheet.props.onOpenChange(false));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("still copies and dismisses from the translatable menu", async () => {
    enable(true);
    const dismiss = render(true);
    await act(async () => button("Copy selected lines")[0]!.props.onPress());
    expect(copy).toHaveBeenCalledWith(TEXT, { feedback: "toast" });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
