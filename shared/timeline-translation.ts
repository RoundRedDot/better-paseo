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
  z.object({ state: z.literal("running"), text: z.string().optional(), helperId: z.string().optional() }),
  z.object({
    state: z.literal("done"),
    translation: z.string(),
    targetLanguageCode: z.string(),
    provider: z.string(),
    model: z.string(),
    thinkingMode: translationThinkingModeSchema,
    thinkingOptionId: z.string().nullable(),
  }),
  z.object({ state: z.literal("error"), error: z.string() }),
]);
export type TranslationJobState = z.output<typeof translationJobStateSchema>;

export const translateTimelineItemRpc = defineRpc({
  name: "translation.translate",
  input: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("start"),
      jobId: z.string().min(1),
      agentId: z.string().min(1),
      text: z.string().trim().min(1).max(200_000),
      sourceKind: z.enum(["assistant_message", "user_message", "reasoning", "tool_output"]),
      interfaceLanguage: z.enum(["en", "zh"]).default("en"),
      configSignature: z.string().min(1),
    }),
    z.object({
      action: z.literal("status"),
      jobId: z.string().min(1),
    }),
  ]),
  output: translationJobStateSchema,
});

export type TranslateTimelineItemInput = z.output<typeof translateTimelineItemRpc.input>;

export const translationModelsRpc = defineRpc({
  name: "translation.models",
  input: z.object({ provider: z.string() }),
  output: modelCatalogSchema,
});
