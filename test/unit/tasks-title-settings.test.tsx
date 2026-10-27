import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { titleGenerationSettingsSchema } from "../../shared/title-generation";
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
  tokens: { typography: { content: { size: 16 } }, v2: {}, foreground: "#111111", warning: "#bb0000" },
} as PageLook;
let tree: TestRenderer.ReactTestRenderer;
beforeEach(() => state.catalog.mockReset().mockResolvedValue({ providers: ["claude", "codex"], models: [{ id: "haiku", label: "Haiku", thinkingOptions: [], defaultThinkingOptionId: null }], error: null }));
afterEach(async () => { await act(async () => tree?.unmount()); });

async function mount(extra: object = {}) {
  const settings = {
    status: "ready", values: titleGenerationSettingsSchema.parse({ provider: "claude", model: "haiku" }),
    revision: "r1", saving: false, saveError: null,
    save: vi.fn(async () => true), reload: vi.fn(), ...extra,
  };
  state.current = settings;
  await act(async () => { tree = TestRenderer.create(<TitleGenerationSettings look={look} />); });
  return settings;
}
const saveButton = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "保存标题设置");

describe("automatic title settings", () => {
  it("loads the selected host's catalog and persists provider, model and custom prompt", async () => {
    const settings = await mount();
    expect(state.catalog).toHaveBeenCalledExactlyOnceWith({ provider: "claude" });
    expect(tree.root.findByType(ProviderLogo).props.provider).toBe("claude");
    await act(async () => tree.root.findByType("TextInput" as never).props.onChangeText("Summarize the actual goal"));
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenCalledExactlyOnceWith({ provider: "claude", model: "haiku", thinkingOptionId: "", prompt: "Summarize the actual goal" }, "r1");
  });

  it("clears the old model on provider change and blocks an incomplete or blank prompt", async () => {
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ provider: "claude", model: "haiku", thinkingOptionId: "off" }) });
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "Provider").props.onPress());
    expect(tree.root.findAllByType(ProviderLogo).map((node) => node.props.provider)).toEqual(["claude", "claude", "codex"]);
    expect(tree.root.findAllByType(ProviderLogo).find((node) => node.props.provider === "codex")!.props.color).toBe(look.tokens.foreground);
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio" && node.props.accessibilityLabel === "Codex").props.onPress());
    expect(state.catalog).toHaveBeenLastCalledWith({ provider: "codex" });
    const modelButton = tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "模型");
    expect(modelButton.findAllByType("Text" as never).some((node) => node.children.join("") === "请选择…")).toBe(true);
    expect(saveButton().props.disabled).toBe(true);
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "模型").props.onPress());
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio" && node.props.accessibilityLabel === "Haiku").props.onPress());
    expect(saveButton().props.disabled).toBe(false);
    await act(async () => saveButton().props.onPress());
    expect(settings.save).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex", thinkingOptionId: "" }), "r1");
    await act(async () => tree.root.findByType("TextInput" as never).props.onChangeText("   "));
    expect(saveButton().props.disabled).toBe(true);
  });

  it.each([false, true])("puts Cursor last with a warning and uses branded provider names and logos (compact: %s)", async (compact) => {
    state.catalog.mockResolvedValue({ providers: ["cursor", "claude", "omp", "opencode", "codex"], models: [{ id: "grok-4.7", label: "Grok 4.7", thinkingOptions: [], defaultThinkingOptionId: null }], error: null });
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ provider: "cursor", model: "grok-4.7" }) });
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
    expect(tree.root.findByType(SectionNote).props.text).toContain("Use the language of firstPrompt. Limit the title to 80 characters including spaces.");
    expect(section.findAllByType(SettingRow).map((row) => [row.props.title, row.props.first === true])).toEqual([
      ["Provider", true], ["模型", false], ["思考等级", false], ["Prompt", false],
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
    const settings = await mount({ values: titleGenerationSettingsSchema.parse({ provider: "claude", model: "haiku", thinkingOptionId: "off" }) });
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
