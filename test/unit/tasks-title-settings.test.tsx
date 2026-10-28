import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TITLE_GENERATION_SETTINGS, titleGenerationSettingsSchema } from "../../shared/title-generation";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-strings";
import { Section, SectionNote, SettingRow, type PageLook } from "../../client/settings-controls";
import "./helpers/quiet-renderer";

const state = vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return { current: null as unknown, catalog: vi.fn() };
});
vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => state.current, useRpc: () => state.catalog }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  return { TextInput: "TextInput", Icon: "Icon", Modal: Object.assign(
    (props: { children: React.ReactNode }) => react.createElement("Modal", props, props.children),
    { Content: (props: { children: React.ReactNode }) => react.createElement("ModalContent", props, props.children) },
  ) };
});
vi.mock("../../client/tasks/i18n", () => ({ useTasksLanguage: () => "zh" }));
import { TitleGenerationSettings } from "../../client/tasks/settings/title-generation";
import { ProviderLogo } from "../../client/components/provider-logo";

const look = {
  compact: false, t: SETTINGS_STRINGS.zh,
  tokens: { typography: { ui: { size: 14 }, content: { size: 16 } }, v2: {}, foreground: "#111111", warning: "#bb0000" },
} as PageLook;
let tree: TestRenderer.ReactTestRenderer;
beforeEach(() => {
  state.catalog.mockReset().mockResolvedValue({ providers: ["claude", "codex"], models: [{ id: "haiku", label: "Haiku", thinkingOptions: [], defaultThinkingOptionId: null }], error: null });
});
afterEach(async () => { await act(async () => tree?.unmount()); });

async function mount(extra: object = {}) {
  const settings = {
    status: "ready", values: titleGenerationSettingsSchema.parse({ customModel: true, disableThinking: false, provider: "claude", model: "haiku" }),
    revision: "r1", saving: false, saveError: null,
    save: vi.fn(async () => true), reset: vi.fn(async () => true), reload: vi.fn(), ...extra,
  };
  state.current = settings;
  await act(async () => { tree = TestRenderer.create(<TitleGenerationSettings look={look} />); });
  return settings;
}
const saveButton = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "保存标题设置");
const customToggle = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "switch" && node.props.accessibilityLabel === "自定义自动标题模型");

describe("automatic title settings", () => {
  it.each([false, true])("defaults the thinking override on and saves it across layouts (compact: %s)", async (compact) => {
    state.catalog.mockResolvedValue({ providers: ["claude"], models: [{ id: "haiku", label: "Haiku", thinkingOptions: [{ id: "high", label: "High" }], defaultThinkingOptionId: "high" }], error: null });
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ customModel: true, provider: "claude", model: "haiku", thinkingOptionId: "high" }) });
    await act(async () => tree.update(<TitleGenerationSettings look={{ ...look, compact }} />));
    const toggle = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "switch" && node.props.accessibilityLabel === "关闭标题生成思考模式");
    const thinking = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "思考等级");
    expect(toggle().props.accessibilityState.checked).toBe(true);
    expect(thinking().props.disabled).toBe(true);
    expect(thinking().findAllByType("Text" as never).some((node) => node.children.join("") === "关闭或最低支持等级")).toBe(true);
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ disableThinking: true, thinkingOptionId: "high" }), "r1");
    await act(async () => toggle().props.onPress());
    expect(thinking().props.disabled).toBe(false);
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ disableThinking: false, thinkingOptionId: "high" }), "r1");
  });

  it.each([false, true])("resets only title settings and discards the title draft (compact: %s)", async (compact) => {
    const settings = await mount();
    await act(async () => tree.update(<TitleGenerationSettings look={{ ...look, compact }} />));
    await act(async () => tree.root.findByType("TextInput" as never).props.onChangeText("Unsaved prompt"));
    const reset = tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "重置标题设置");
    expect(reset.props.disabled).toBe(false);
    await act(async () => reset.props.onPress());
    expect(settings.reset).toHaveBeenCalledExactlyOnceWith();
    expect(settings.save).not.toHaveBeenCalled();
    expect(customToggle().props.accessibilityState.checked).toBe(false);
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "关闭标题生成思考模式").props.accessibilityState.checked).toBe(true);
    expect(tree.root.findByType("TextInput" as never).props.value).toBe(titleGenerationSettingsSchema.parse({}).prompt);
    expect(tree.root.findByType("TextInput" as never).props.value).toContain("Use the language of the first user message.");
    expect(tree.root.findByType("TextInput" as never).props.value).toContain("Limit the title to 80 characters including spaces.");
    expect(tree.root.findAllByType(ProviderLogo)).toHaveLength(0);
  });

  it("keeps the draft and exposes a failed title reset", async () => {
    await mount({ reset: vi.fn(async () => false), saveError: "Reset failed" });
    await act(async () => tree.root.findByType("TextInput" as never).props.onChangeText("Keep this prompt"));
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "重置标题设置").props.onPress());
    expect(customToggle().props.accessibilityState.checked).toBe(true);
    expect(tree.root.findByType("TextInput" as never).props.value).toBe("Keep this prompt");
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert").children.join("")).toContain("Reset failed");
  });

  it("disables title reset while a settings write is pending", async () => {
    await mount({ saving: true });
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "重置标题设置").props.disabled).toBe(true);
  });

  it("defaults to following the source and saves without selecting a custom model", async () => {
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({}) });
    expect(TITLE_GENERATION_SETTINGS.scope).toBe("host");
    expect(customToggle().props.accessibilityState.checked).toBe(false);
    expect(state.catalog).not.toHaveBeenCalled();
    expect(tree.root.findAllByType(SettingRow).map((row) => row.props.title)).toEqual(["自定义自动标题模型", "关闭标题生成思考模式", "Prompt"]);
    expect(saveButton().props.disabled).toBe(false);
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ customModel: false, provider: "", model: "" }), "r1");
    await act(async () => customToggle().props.onPress());
    expect(state.catalog).toHaveBeenCalledWith({ provider: "" });
    expect(state.catalog).toHaveBeenLastCalledWith({ provider: "claude" });
    expect(saveButton().props.disabled).toBe(false);
  });

  it.each([false, true])("selects the first available provider and its first model when enabling custom models (compact: %s)", async (compact) => {
    state.catalog.mockImplementation(async ({ provider }: { provider: string }) => ({
      providers: ["cursor", "codex", "claude"],
      models: provider === "codex" ? [
        { id: "first", label: "First model", thinkingOptions: [], defaultThinkingOptionId: null },
        { id: "second", label: "Second model", thinkingOptions: [], defaultThinkingOptionId: null },
      ] : [], error: null,
    }));
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({}) });
    await act(async () => tree.update(<TitleGenerationSettings look={{ ...look, compact }} />));
    await act(async () => customToggle().props.onPress());
    expect(tree.root.findByType(ProviderLogo).props.provider).toBe("codex");
    expect(state.catalog).toHaveBeenLastCalledWith({ provider: "codex" });
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ customModel: true, provider: "codex", model: "first" }), "r1");
  });

  it("keeps provider selection empty when none are available", async () => {
    state.catalog.mockResolvedValue({ providers: [], models: [], error: null });
    await mount({ values: titleGenerationSettingsSchema.parse({}) });
    await act(async () => customToggle().props.onPress());
    expect(tree.root.findAllByType(ProviderLogo)).toHaveLength(0);
    expect(saveButton().props.disabled).toBe(true);
  });

  it("preserves custom selections while the switch is off and restores them when enabled", async () => {
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ customModel: true, disableThinking: false, provider: "claude", model: "haiku", thinkingOptionId: "off" }) });
    await act(async () => customToggle().props.onPress());
    expect(tree.root.findAllByType(ProviderLogo)).toHaveLength(0);
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ customModel: false, provider: "claude", model: "haiku", thinkingOptionId: "off" }), "r1");
    await act(async () => customToggle().props.onPress());
    expect(tree.root.findByType(ProviderLogo).props.provider).toBe("claude");
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ customModel: true, model: "haiku", thinkingOptionId: "off" }), "r1");
  });

  it.each([false, true])("applies settings revisions received from another client (compact: %s)", async (compact) => {
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({}) });
    state.current = { ...settings, revision: "r2", values: titleGenerationSettingsSchema.parse({
      customModel: true, disableThinking: false, provider: "claude", model: "haiku", thinkingOptionId: "off", prompt: "Shared prompt",
    }) };
    await act(async () => tree.update(<TitleGenerationSettings look={{ ...look, compact }} />));
    expect(customToggle().props.accessibilityState.checked).toBe(true);
    expect(tree.root.findByType(ProviderLogo).props.provider).toBe("claude");
    expect(tree.root.findByType("TextInput" as never).props.value).toBe("Shared prompt");
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "关闭标题生成思考模式").props.accessibilityState.checked).toBe(false);
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ customModel: true, thinkingOptionId: "off", prompt: "Shared prompt" }), "r2");
    state.current = { ...settings, revision: "r3", values: titleGenerationSettingsSchema.parse({ customModel: false, provider: "claude", model: "haiku" }) };
    await act(async () => tree.update(<TitleGenerationSettings look={{ ...look, compact }} />));
    expect(customToggle().props.accessibilityState.checked).toBe(false);
    expect(tree.root.findAllByType(ProviderLogo)).toHaveLength(0);
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "关闭标题生成思考模式").props.accessibilityState.checked).toBe(true);
  });

  it("loads the selected host's catalog and persists provider, model and custom prompt", async () => {
    const settings = await mount();
    expect(state.catalog).toHaveBeenCalledExactlyOnceWith({ provider: "claude" });
    expect(tree.root.findByType(ProviderLogo).props.provider).toBe("claude");
    await act(async () => tree.root.findByType("TextInput" as never).props.onChangeText("Summarize the actual goal"));
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenCalledExactlyOnceWith({ customModel: true, disableThinking: false, provider: "claude", model: "haiku", thinkingOptionId: "", prompt: "Summarize the actual goal" }, "r1");
  });

  it.each([false, true])("selects the first available model on provider change (compact: %s)", async (compact) => {
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ customModel: true, disableThinking: false, provider: "claude", model: "haiku", thinkingOptionId: "off" }) });
    await act(async () => tree.update(<TitleGenerationSettings look={{ ...look, compact }} />));
    state.catalog.mockResolvedValueOnce({ providers: ["claude", "codex"], models: [
      { id: "first", label: "First model", thinkingOptions: [], defaultThinkingOptionId: null },
      { id: "second", label: "Second model", thinkingOptions: [], defaultThinkingOptionId: null },
    ], error: null });
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "Provider").props.onPress());
    expect(tree.root.findAllByType(ProviderLogo).map((node) => node.props.provider)).toEqual(["claude", "claude", "codex"]);
    expect(tree.root.findAllByType(ProviderLogo).find((node) => node.props.provider === "codex")!.props.color).toBe(look.tokens.foreground);
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio" && node.props.accessibilityLabel === "Codex").props.onPress());
    expect(state.catalog).toHaveBeenLastCalledWith({ provider: "codex" });
    const modelButton = tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "模型");
    expect(modelButton.findAllByType("Text" as never).some((node) => node.children.join("") === "First model")).toBe(true);
    expect(saveButton().props.disabled).toBe(false);
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex", model: "first", thinkingOptionId: "" }), "r1");
    await act(async () => tree.root.findByType("TextInput" as never).props.onChangeText("   "));
    expect(saveButton().props.disabled).toBe(true);
  });

  it("keeps model selection empty when the new provider has no available models", async () => {
    await mount();
    state.catalog.mockResolvedValueOnce({ providers: ["claude", "codex"], models: [], error: null });
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "Provider").props.onPress());
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio" && node.props.accessibilityLabel === "Codex").props.onPress());
    expect(saveButton().props.disabled).toBe(true);
    const model = tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "模型");
    expect(model.findAllByType("Text" as never).some((node) => node.children.join("") === "请选择…")).toBe(true);
  });

  it("preserves a selected model when loading or refreshing the catalog", async () => {
    state.catalog.mockResolvedValue({ providers: ["claude", "codex"], models: [
      { id: "first", label: "First", thinkingOptions: [], defaultThinkingOptionId: null },
      { id: "haiku", label: "Haiku", thinkingOptions: [], defaultThinkingOptionId: null },
    ], error: null });
    const settings = await mount();
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "刷新模型").props.onPress());
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ model: "haiku" }), "r1");
  });

  it.each([false, true])("puts Cursor last with a warning and uses branded provider names and logos (compact: %s)", async (compact) => {
    state.catalog.mockResolvedValue({ providers: ["cursor", "claude", "omp", "opencode", "codex"], models: [{ id: "grok-4.7", label: "Grok 4.7", thinkingOptions: [], defaultThinkingOptionId: null }], error: null });
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ customModel: true, disableThinking: false, provider: "cursor", model: "grok-4.7" }) });
    await act(async () => tree.update(<TitleGenerationSettings look={{ ...look, compact }} />));
    const providerButton = tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "Provider");
    expect(providerButton.findAllByType("Text" as never).some((node) => node.children.join("") === "Cursor · 不推荐使用")).toBe(true);
    await act(async () => providerButton.props.onPress());
    const options = tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio");
    expect(options.map((node) => node.props.accessibilityLabel)).toEqual(["Claude", "Oh My Pi", "OpenCode", "Codex", "Cursor · 不推荐使用"]);
    expect(options.map((node) => node.findByType(ProviderLogo).props.provider)).toEqual(["claude", "omp", "opencode", "codex", "cursor"]);
    await act(async () => options[4]!.props.onPress());
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ provider: "cursor", model: "grok-4.7" }), "r1");
  });

  it("keeps the section note outside the grouped rows and uses a single first row", async () => {
    await mount();
    const section = tree.root.findByType(Section);
    expect(section.findAllByType(SectionNote)).toHaveLength(0);
    expect(tree.root.findByType(SectionNote).props.text).toContain("后台任务不进入看板");
    expect(tree.root.findByType(SectionNote).props.text).toContain("Oh My Pi / DeepSeek Flash（deepseek/deepseek-flash），思考等级 low");
    expect(tree.root.findByType(SectionNote).props.text).toContain("Claude / Haiku 5.5（claude-haiku-5-5），思考等级 off");
    expect(tree.root.findByType(SectionNote).props.text).not.toContain("建议在默认 prompt 末尾补充");
    expect(section.findAllByType(SettingRow).map((row) => [row.props.title, row.props.first === true])).toEqual([
      ["自定义自动标题模型", true], ["关闭标题生成思考模式", false], ["Provider", false], ["模型", false], ["思考等级", false], ["Prompt", false],
    ]);
  });

  it("shows model thinking options, saves the selection and allows resetting to the model default", async () => {
    state.catalog.mockResolvedValue({ providers: ["claude"], models: [{ id: "haiku", label: "Haiku", thinkingOptions: [{ id: "off", label: "Off" }, { id: "low", label: "Low" }], defaultThinkingOptionId: "low" }], error: null });
    const settings = await mount();
    const thinking = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "思考等级");
    await act(async () => thinking().props.onPress());
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio").map((node) => node.props.accessibilityLabel)).toEqual(["模型默认 · low", "Off", "Low"]);
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Off").props.onPress());
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ thinkingOptionId: "off" }), "r1");
    await act(async () => thinking().props.onPress());
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "模型默认 · low").props.onPress());
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ thinkingOptionId: "" }), "r1");
  });

  it.each([true, false])("keeps only a compatible thinking selection when switching models (compatible: %s)", async (compatible) => {
    state.catalog.mockResolvedValue({ providers: ["claude"], models: [
      { id: "haiku", label: "Haiku", thinkingOptions: [{ id: "off", label: "Off" }], defaultThinkingOptionId: "off" },
      { id: "next", label: "Next", thinkingOptions: compatible ? [{ id: "off", label: "Off" }] : [], defaultThinkingOptionId: null },
    ], error: null });
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ customModel: true, disableThinking: false, provider: "claude", model: "haiku", thinkingOptionId: "off" }) });
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "模型").props.onPress());
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Next").props.onPress());
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ model: "next", thinkingOptionId: compatible ? "off" : "" }), "r1");
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "思考等级").props.disabled).toBe(!compatible);
  });

  it("keeps a catalog or save failure visible and supports retry", async () => {
    state.catalog.mockRejectedValueOnce(new Error("Provider offline"));
    const settings = await mount({ save: vi.fn(async () => { throw new Error("Save offline"); }) });
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert")[0]!.children.join("")).toContain("Provider offline");
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "重试").props.onPress());
    expect(state.catalog).toHaveBeenCalledTimes(2);
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenCalledTimes(1);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert")[0]!.children.join("")).toContain("Save offline");
  });
});
