import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TITLE_PROMPT, TITLE_GENERATION_SETTINGS, titleGenerationSettingsSchema } from "../../shared/title-generation";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";
import { Section, SettingsTips, SettingRow, type PageLook } from "../../client/settings-controls";
import "./helpers/quiet-renderer";

const state = vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return { current: null as unknown, catalog: vi.fn(), language: "zh" as "zh" | "en" };
});
vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => state.current, useRpc: () => state.catalog }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  return { TextInput: "TextInput", ScrollView: "ScrollView", Icon: "Icon", Modal: Object.assign(
    (props: { children: React.ReactNode }) => react.createElement("Modal", props, props.children),
    { Content: (props: { children: React.ReactNode }) => react.createElement("ModalContent", props, props.children) },
  ) };
});
vi.mock("../../client/tasks/i18n", () => ({ useTasksLanguage: () => state.language }));
import { TitleGenerationSettings, resetTitleCatalogs } from "../../client/tasks/settings/title-generation";
import { ProviderLogo } from "../../client/components/provider-logo";

const look = {
  compact: false, t: SETTINGS_STRINGS.zh,
  tokens: { typography: { ui: { size: 14 }, content: { size: 16 } }, v2: {}, foreground: "#111111", warning: "#bb0000" },
} as PageLook;
let tree: TestRenderer.ReactTestRenderer;
beforeEach(() => {
  vi.useFakeTimers();
  resetTitleCatalogs();
  state.catalog.mockReset().mockResolvedValue({ providers: ["claude", "codex"], models: [{ id: "haiku", label: "Haiku", thinkingOptions: [], defaultThinkingOptionId: null }], error: null });
});
afterEach(async () => {
  state.language = "zh";
  await act(async () => tree?.unmount());
  vi.useRealTimers();
});

async function mount(extra: object = {}) {
  const settings = {
    status: "ready", values: titleGenerationSettingsSchema.parse({ customModel: true, disableThinking: false, provider: "claude", model: "haiku" }),
    revision: "r1", saving: false, saveError: null,
    save: vi.fn(async (_values: ReturnType<typeof titleGenerationSettingsSchema.parse>, _revision: string) => true), reset: vi.fn(async () => true), reload: vi.fn(), ...extra,
  };
  if (!("save" in extra)) settings.save.mockImplementation(async (values) => { settings.values = values; return true; });
  state.current = settings;
  await act(async () => { tree = TestRenderer.create(<TitleGenerationSettings look={look} />); });
  return settings;
}
const flushSave = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(500); }); };
const customToggle = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "switch" && node.props.accessibilityLabel === "自定义自动标题模型");

const promptDisplay = () => tree.root.findByProps({ testID: "title-generation-prompt" });
const editPrompt = async (value: string) => {
  await act(async () => tree.root.findByProps({ accessibilityLabel: "编辑 Prompt" }).props.onPress());
  await act(async () => tree.root.findByProps({ testID: "title-prompt-edit-input" }).props.onChangeText(value));
};
const savePrompt = async () => { await act(async () => tree.root.findByProps({ accessibilityLabel: "保存" }).props.onPress()); };

describe("automatic title settings", () => {
  it.each([
    ["zh", "自动优化新任务标题", "自动根据发送的内容优化标题。", "保存标题设置"],
    ["en", "Optimize new task titles automatically", "Automatically refine the title from what you send.", "Save title settings"],
  ] as const)("offers automatic titles at task start off by default and saves the setting (%s)", async (language, title, description, save) => {
    state.language = language;
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({}) });
    const row = tree.root.findAllByType(SettingRow)[0]!;
    expect(row.props).toMatchObject({ title, description, first: true });
    const toggle = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "switch" && node.props.accessibilityLabel === title);
    expect(toggle().props.accessibilityState.checked).toBe(false);
    await act(async () => toggle().props.onPress());
    expect(toggle().props.accessibilityState.checked).toBe(true);
    expect(settings.save).not.toHaveBeenCalled();
    await flushSave();
    expect(settings.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ afterFirstReply: true, customModel: false }), "r1");
  });

  it.each([false, true])("defaults the thinking override on and saves it across layouts (compact: %s)", async (compact) => {
    state.catalog.mockResolvedValue({ providers: ["claude"], models: [{ id: "haiku", label: "Haiku", thinkingOptions: [{ id: "high", label: "High" }], defaultThinkingOptionId: "high" }], error: null });
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ customModel: true, provider: "claude", model: "haiku", thinkingOptionId: "high" }) });
    await act(async () => tree.update(<TitleGenerationSettings look={{ ...look, compact }} />));
    const toggle = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "switch" && node.props.accessibilityLabel === "关闭标题生成思考模式");
    const thinking = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "思考等级");
    expect(toggle().props.accessibilityState.checked).toBe(true);
    expect(thinking().props.disabled).toBe(true);
    expect(thinking().findAllByType("Text" as never).some((node) => node.children.join("") === "关闭或最低支持等级")).toBe(true);
    await flushSave();
    expect(settings.save).not.toHaveBeenCalled();
    await act(async () => toggle().props.onPress());
    expect(thinking().props.disabled).toBe(false);
    await flushSave();
    expect(settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ disableThinking: false, thinkingOptionId: "high" }), "r1");
  });

  it.each([false, true])("resets only title settings and discards the title draft (compact: %s)", async (compact) => {
    const settings = await mount();
    await act(async () => tree.update(<TitleGenerationSettings look={{ ...look, compact }} />));
    await editPrompt("Unsaved prompt");
    await act(async () => tree.root.findByProps({ accessibilityLabel: "取消" }).props.onPress());
    const reset = tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "恢复自动标题");
    expect(reset.props.disabled).toBe(false);
    await act(async () => reset.props.onPress());
    expect(settings.reset).not.toHaveBeenCalled();
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.children.join("") === "这只会把自动标题设置恢复为默认值。")).toHaveLength(1);
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "确认重置").props.onPress());
    expect(settings.reset).toHaveBeenCalledExactlyOnceWith();
    expect(settings.save).not.toHaveBeenCalled();
    expect(customToggle().props.accessibilityState.checked).toBe(false);
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "关闭标题生成思考模式").props.accessibilityState.checked).toBe(true);
    expect(promptDisplay().props.value).toBe(titleGenerationSettingsSchema.parse({}).prompt);
    expect(promptDisplay().props.value).toContain("Use the language of the first user message.");
    expect(promptDisplay().props.value).toContain("Limit the title to 60 characters including spaces.");
    expect(tree.root.findAllByType(ProviderLogo)).toHaveLength(0);
  });

  it("keeps the draft and exposes a failed title reset", async () => {
    await mount({ reset: vi.fn(async () => false), saveError: "Reset failed" });
    await editPrompt("Keep this prompt");
    await savePrompt();
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "恢复自动标题").props.onPress());
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "确认重置").props.onPress());
    expect(customToggle().props.accessibilityState.checked).toBe(true);
    expect(promptDisplay().props.value).toBe("Keep this prompt");
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert").children.join("")).toContain("Reset failed");
  });

  it("disables title reset while a settings write is pending", async () => {
    await mount({ saving: true });
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "恢复自动标题").props.disabled).toBe(true);
  });

  it("defaults to following the source and saves without selecting a custom model", async () => {
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({}) });
    expect(TITLE_GENERATION_SETTINGS.scope).toBe("host");
    expect(customToggle().props.accessibilityState.checked).toBe(false);
    expect(state.catalog).not.toHaveBeenCalled();
    expect(tree.root.findAllByType(SettingRow).map((row) => row.props.title)).toEqual(["自动优化新任务标题", "自定义自动标题模型", "关闭标题生成思考模式", "Prompt", "恢复「自动标题」默认设置"]);
    await flushSave();
    expect(settings.save).not.toHaveBeenCalled();
    await act(async () => customToggle().props.onPress());
    expect(state.catalog).toHaveBeenCalledWith({ provider: "" });
    expect(state.catalog).toHaveBeenLastCalledWith({ provider: "claude" });
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
    await flushSave();
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ customModel: true, provider: "codex", model: "first" }), "r1");
  });

  it("keeps provider selection empty when none are available", async () => {
    state.catalog.mockResolvedValue({ providers: [], models: [], error: null });
    await mount({ values: titleGenerationSettingsSchema.parse({}) });
    await act(async () => customToggle().props.onPress());
    expect(tree.root.findAllByType(ProviderLogo)).toHaveLength(0);
    await flushSave();
  });

  it("preserves custom selections while the switch is off and restores them when enabled", async () => {
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ customModel: true, disableThinking: false, provider: "claude", model: "haiku", thinkingOptionId: "off" }) });
    await act(async () => customToggle().props.onPress());
    expect(tree.root.findAllByType(ProviderLogo)).toHaveLength(0);
    await flushSave();
    expect(settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ customModel: false, provider: "claude", model: "haiku", thinkingOptionId: "off" }), "r1");
    await act(async () => customToggle().props.onPress());
    expect(tree.root.findByType(ProviderLogo).props.provider).toBe("claude");
    await flushSave();
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
    expect(promptDisplay().props.value).toBe("Shared prompt");
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "关闭标题生成思考模式").props.accessibilityState.checked).toBe(false);
    await flushSave();
    expect(settings.save).not.toHaveBeenCalled();
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
    await editPrompt("Summarize the actual goal");
    await savePrompt();
    await flushSave();
    expect(settings.save).toHaveBeenCalledExactlyOnceWith({ afterFirstReply: false, customModel: true, disableThinking: false, provider: "claude", model: "haiku", thinkingOptionId: "", prompt: "Summarize the actual goal" }, "r1");
  });

  it("saves only on confirmation and discards cancelled or empty edits", async () => {
    const settings = await mount();
    const original = promptDisplay().props.value;
    await editPrompt("Cancelled");
    const input = tree.root.findByProps({ testID: "title-prompt-edit-input" });
    if (input.props.onContentSizeChange) {
      await act(async () => input.props.onContentSizeChange({ nativeEvent: { contentSize: { height: 360 } } }));
      expect(tree.root.findByProps({ testID: "title-prompt-edit-input" }).props.style[1].height).toBe(360);
    }
    await flushSave();
    expect(settings.save).not.toHaveBeenCalled();
    await act(async () => tree.root.findByProps({ accessibilityLabel: "取消" }).props.onPress());
    expect(promptDisplay().props.value).toBe(original);
    await editPrompt("   ");
    expect(tree.root.findByProps({ accessibilityLabel: "保存" }).props.disabled).toBe(true);
    await act(async () => tree.root.findByProps({ testID: "title-prompt-edit-input" }).props.onChangeText("Final"));
    expect(tree.root.findAllByProps({ testID: "task-rename-auto-title" })).toHaveLength(0);
    await savePrompt();
    await flushSave();
    expect(settings.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ prompt: "Final" }), "r1");
  });

  it("restores the default prompt in the editor and saves only when confirmed", async () => {
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ prompt: "Custom prompt" }) });
    await editPrompt("Unsaved edit");
    await act(async () => tree.root.findByProps({ accessibilityLabel: "重置" }).props.onPress());
    expect(tree.root.findByProps({ testID: "title-prompt-edit-input" }).props.value).toBe(DEFAULT_TITLE_PROMPT);
    await flushSave();
    expect(settings.save).not.toHaveBeenCalled();
    await savePrompt();
    await flushSave();
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ prompt: DEFAULT_TITLE_PROMPT }), "r1");
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
    await flushSave();
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex", model: "first", thinkingOptionId: "" }), "r1");

  });

  it("keeps model selection empty when the new provider has no available models", async () => {
    await mount();
    state.catalog.mockResolvedValueOnce({ providers: ["claude", "codex"], models: [], error: null });
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "Provider").props.onPress());
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio" && node.props.accessibilityLabel === "Codex").props.onPress());
    await flushSave();
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
    await flushSave();
    expect(settings.save).not.toHaveBeenCalled();
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "模型").findAllByType("Text" as never).some((node) => node.children.join("") === "Haiku")).toBe(true);
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
    await flushSave();
    expect(settings.save).not.toHaveBeenCalled();
  });

  it("keeps the section note outside the grouped rows and uses a single first row", async () => {
    await mount();
    const section = tree.root.findByType(Section);
    expect(section.findAllByType(SettingsTips)).toHaveLength(0);
    const tips = tree.root.findByType(SettingsTips).props.items;
    expect(tips.map((item: { label: string }) => item.label)).toEqual(["生成方式", "推荐模型", "后台任务"]);
    expect(tips[0].text).toContain("对话摘录和标题提示词");
    expect(tips[1].text).toContain("deepseek/deepseek-flash");
    expect(tips[1].text).toContain("claude-haiku-5-5");
    expect(tips[2].text).toContain("后台任务不进入看板");
    expect(section.findAllByType(SettingRow).map((row) => [row.props.title, row.props.first === true])).toEqual([
      ["自动优化新任务标题", true], ["自定义自动标题模型", false], ["关闭标题生成思考模式", false], ["Provider", false], ["模型", false], ["思考等级", false], ["Prompt", false], ["恢复「自动标题」默认设置", false],
    ]);
  });

  it("shows model thinking options, saves the selection and allows resetting to the model default", async () => {
    state.catalog.mockResolvedValue({ providers: ["claude"], models: [{ id: "haiku", label: "Haiku", thinkingOptions: [{ id: "off", label: "Off" }, { id: "low", label: "Low" }], defaultThinkingOptionId: "low" }], error: null });
    const settings = await mount();
    const thinking = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "思考等级");
    await act(async () => thinking().props.onPress());
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio").map((node) => node.props.accessibilityLabel)).toEqual(["模型默认 · low", "Off", "Low"]);
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Off").props.onPress());
    await flushSave();
    expect(settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ thinkingOptionId: "off" }), "r1");
    await act(async () => thinking().props.onPress());
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "模型默认 · low").props.onPress());
    await flushSave();
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
    await flushSave();
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ model: "next", thinkingOptionId: compatible ? "off" : "" }), "r1");
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "思考等级").props.disabled).toBe(!compatible);
  });

  it("keeps a catalog or save failure visible and supports retry", async () => {
    state.catalog.mockRejectedValueOnce(new Error("Provider offline"));
    const settings = await mount({ save: vi.fn(async () => { throw new Error("Save offline"); }) });
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert")[0]!.children.join("")).toContain("Provider offline");
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "刷新模型").props.onPress());
    expect(state.catalog).toHaveBeenCalledTimes(2);
    await editPrompt("Changed prompt");
    await savePrompt();
    await flushSave();
    expect(settings.save).toHaveBeenCalledTimes(1);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert")[0]!.children.join("")).toContain("Save offline");
  });

  it("shows the last catalog at once when the section mounts again, while it reads the catalog anew", async () => {
    state.catalog.mockResolvedValue({ providers: ["claude", "codex"], models: [{ id: "haiku", label: "Haiku 5.5", thinkingOptions: [], defaultThinkingOptionId: null }], error: null });
    await mount();
    await act(async () => tree.unmount());
    let finish!: (value: unknown) => void;
    state.catalog.mockReset().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await mount();
    const model = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "模型");
    const refresh = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "刷新模型");
    expect(model().findAllByType("Text" as never).some((node) => node.children.join("") === "Haiku 5.5")).toBe(true);
    expect(refresh().props.disabled).toBe(true);
    expect(state.catalog).toHaveBeenCalledTimes(1);
    await act(async () => finish({ providers: ["claude"], models: [], error: "Provider offline" }));
    expect(refresh().props.disabled).toBe(false);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert")[0]!.children.join("")).toContain("Provider offline");
  });
});

describe("automatic title data-flow hint", () => {
  it("states where title input is sent in English and keeps the existing hint", async () => {
    state.language = "en";
    await mount();
    const tips = tree.root.findByType(SettingsTips).props.items;
    expect(tips.map((item: { label: string }) => item.label)).toEqual(["Generation", "Recommended models", "Background tasks"]);
    expect(tips[0].text).toContain("conversation excerpts and the title prompt to a helper agent");
    expect(tips[0].text).toContain("Manual generation also sends them");
    expect(tips[2].text).toContain("Title tasks stay off the board");
  });
});
