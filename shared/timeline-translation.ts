import { modelCatalogSchema } from "./model-catalog";
import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import {
  FOLLOW_INTERFACE_LANGUAGE_CODE,
  isTranslationLanguageCode,
  resolveTranslationTarget,
} from "./translation-languages";

export const TRANSLATION_HELPER_LABEL = "better-paseo.purpose";
export const TRANSLATION_HELPER_PURPOSE = "timeline-translation";

export const TRANSLATION_PROMPT_MAX_LENGTH = 8000;

// Settings saves write the full value object, so a stored prompt keeps the
// text it was saved with. When this changes, add the old text to
// PREVIOUS_DEFAULT_TRANSLATION_PROMPTS so untouched defaults follow along.
export const DEFAULT_TRANSLATION_PROMPT = [
  "Translate the text into the target language.",
  "Write natural, fluent prose for a native reader while keeping the original meaning, tone, and level of detail.",
  "Keep code, inline code, commands, file names and extensions, paths, URLs, APIs, identifiers, and product or library names exactly as written;",
  "use technical terms in the form developers commonly use in the target language, keeping the original term when that is the norm.",
  "Preserve the Markdown structure. Return only the translation, without explanations.",
].join(" ");

/**
 * Earlier default prompts, matched exactly after trimming. Reading settings
 * maps them to the current default without writing the file; the next normal
 * save persists the current text. Any other prompt is kept as written.
 */
export const PREVIOUS_DEFAULT_TRANSLATION_PROMPTS: readonly string[] = [
  "Translate the supplied text into the target language. Preserve Markdown, code blocks, inline code, commands, paths, links, and technical identifiers. Return only the translation, without explanations.",
];

function currentDefaultPrompt(prompt: string): string {
  return PREVIOUS_DEFAULT_TRANSLATION_PROMPTS.includes(prompt) ? DEFAULT_TRANSLATION_PROMPT : prompt;
}

/**
 * Only these option IDs represent genuinely disabling thinking on a model.
 * Non-off levels such as "minimal" or "low" are never treated as disabled.
 */
export const THINKING_OFF_IDS = ["off", "none", "disabled"] as const;

export interface ThinkingOptionInfo {
  id: string;
  label: string;
}

export type ThinkingCapability =
  | { status: "supported"; offOption: ThinkingOptionInfo; options: readonly ThinkingOptionInfo[] }
  | { status: "unsupported_off"; options: readonly ThinkingOptionInfo[] }
  | { status: "none" };

export function isRealThinkingOffId(id: string | null | undefined): boolean {
  if (!id) return false;
  const normalized = id.trim().toLowerCase();
  return (THINKING_OFF_IDS as readonly string[]).includes(normalized);
}

export function resolveThinkingCapability(
  options: readonly ThinkingOptionInfo[] | null | undefined,
): ThinkingCapability {
  const list = options ?? [];
  if (list.length === 0) return { status: "none" };
  for (const offId of THINKING_OFF_IDS) {
    const match = list.find((option) => option.id.trim().toLowerCase() === offId);
    if (match) return { status: "supported", offOption: match, options: list };
  }
  return { status: "unsupported_off", options: list };
}

/**
 * Whether translation would use the saved thinking option although the model no longer offers
 * it. Translation refuses such a choice instead of falling back to the model default, and the
 * settings let the user clear it. With an off option, "disable thinking" sends that option and
 * never reads the saved one, so a stale saved option does not matter there.
 */
export function savedThinkingStale(input: {
  customModel: boolean;
  disableThinking: boolean;
  thinkingOptionId: string;
  offeredIds: readonly string[];
}): boolean {
  if (!input.customModel || !input.thinkingOptionId) return false;
  if (input.offeredIds.includes(input.thinkingOptionId)) return false;
  const capability = resolveThinkingCapability(input.offeredIds.map((id) => ({ id, label: id })));
  return !(input.disableThinking && capability.status === "supported");
}

export const timelineTranslationSettingsSchema = z.object({
  enabled: z.boolean().catch(false),
  customModel: z.boolean().catch(false),
  disableThinking: z.boolean().catch(true),
  provider: z.string().catch(""),
  model: z.string().catch(""),
  thinkingOptionId: z.string().catch(""),
  targetLanguage: z.string().refine(isTranslationLanguageCode).catch(FOLLOW_INTERFACE_LANGUAGE_CODE),
  prompt: z.string().trim().min(1).max(TRANSLATION_PROMPT_MAX_LENGTH).catch(DEFAULT_TRANSLATION_PROMPT).transform(currentDefaultPrompt),
});

export type TimelineTranslationSettings = z.output<typeof timelineTranslationSettingsSchema>;

export const TIMELINE_TRANSLATION_SETTINGS = defineSettings({
  id: "timeline-translation",
  scope: "host",
  version: 1,
  schema: timelineTranslationSettingsSchema,
});

export interface ConversationAgentModelConfig {
  provider?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
  effectiveThinkingOptionId?: string | null;
}

export function translationConfigSignature(
  settings: TimelineTranslationSettings,
  interfaceLanguage: "en" | "zh",
  agentConfig?: ConversationAgentModelConfig | null,
): string {
  const target = resolveTranslationTarget(settings.targetLanguage, interfaceLanguage);
  const provider = settings.customModel ? settings.provider : (agentConfig?.provider ?? "");
  const model = settings.customModel ? settings.model : (agentConfig?.model ?? "");
  const thinkingOptionId = settings.customModel
    ? settings.thinkingOptionId
    : (agentConfig?.effectiveThinkingOptionId ?? agentConfig?.thinkingOptionId ?? "");
  return JSON.stringify({
    enabled: settings.enabled,
    targetCode: target.code,
    customModel: settings.customModel,
    provider,
    model,
    disableThinking: settings.disableThinking,
    thinkingOptionId,
    prompt: settings.prompt,
  });
}

export const translationThinkingModeSchema = z.enum([
  "disabled",
  "unsupported_off",
  "none",
  "custom",
  "inherited",
]);
export type TranslationThinkingMode = z.output<typeof translationThinkingModeSchema>;

export const translationJobStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }),
  /** The reply to `check`: every check passed, so the client may send the text. */
  z.object({ state: z.literal("ready") }),
  z.object({
    state: z.literal("running"),
    text: z.string().optional(),
    helperId: z.string().optional(),
    /**
     * The job's unguessable handle, returned by `start`; `status` and `cancel` need it. The plugin
     * serves every RPC caller from one process and learns nothing about who calls, so the handle
     * is the only thing that keeps one caller from reading or cancelling another's job.
     */
    handle: z.string().optional(),
  }),
  z.object({
    state: z.literal("done"),
    translation: z.string(),
    targetLanguageCode: z.string(),
    provider: z.string(),
    model: z.string(),
    thinkingMode: translationThinkingModeSchema,
    thinkingOptionId: z.string().nullable(),
    /** What the host could not rule out for this route; shown with the translation. */
    limitations: z.array(z.string()).optional(),
  }),
  z.object({ state: z.literal("error"), error: z.string() }),
]);
export type TranslationJobState = z.output<typeof translationJobStateSchema>;

export const translateTimelineItemRpc = defineRpc({
  name: "translation.translate",
  input: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("start"),
      agentId: z.string().min(1),
      text: z.string().trim().min(1).max(200_000),
      sourceKind: z.enum(["assistant_message", "user_message", "reasoning", "tool_output"]),
      interfaceLanguage: z.enum(["en", "zh"]).default("en"),
      configSignature: z.string().min(1),
    }),
    // Every check `start` runs, without the text: the client sends the text only after this passes.
    z.object({
      action: z.literal("check"),
      agentId: z.string().min(1),
      interfaceLanguage: z.enum(["en", "zh"]).default("en"),
      configSignature: z.string().min(1),
    }),
    z.object({
      action: z.literal("status"),
      handle: z.string().min(1),
    }),
    // Aborts a running job. Text already sent may still have reached the provider.
    z.object({
      action: z.literal("cancel"),
      handle: z.string().min(1),
    }),
  ]),
  output: translationJobStateSchema,
});

export type TranslateTimelineItemInput = z.output<typeof translateTimelineItemRpc.input>;

/**
 * The translation catalog: `reason` says why it is empty when that is not the host's complete
 * answer, and `uncheckedProviders` lists providers whose check failed, so the list may be missing
 * them.
 */
export const translationCatalogSchema = modelCatalogSchema.extend({
  reason: z.enum(["host_unsupported", "check_failed"]).nullable().default(null),
  uncheckedProviders: z.array(z.string()).default([]),
  /** The selected provider's limitations, as the host reports them. */
  limitations: z.array(z.string()).default([]),
});

const LIMITATION_TEXT: Record<string, { en: string; zh: string }> = {
  provider_runtime_builtin_hooks_unobserved: {
    en: "Paseo could not confirm how the provider runtime's built-in model hooks handle this request.",
    zh: "Paseo 无法确认 Provider 运行时内建的模型钩子如何处理此请求。",
  },
  prompt_sent_to_provider_runtime_and_model_provider: {
    en: "The text goes to the provider runtime on your Paseo host and from there to its model service.",
    zh: "文本会发送到 Paseo 宿主上的 Provider 运行时，再由它发往模型服务。",
  },
};

/** A host limitation in words; one Paseo does not know yet is shown by its identifier. */
export function describeTranslationLimitation(id: string, language: "en" | "zh"): string {
  return LIMITATION_TEXT[id]?.[language] ?? id;
}
export type TranslationCatalog = z.output<typeof translationCatalogSchema>;

export const translationModelsRpc = defineRpc({
  name: "translation.models",
  input: z.object({ provider: z.string() }),
  output: translationCatalogSchema,
});
