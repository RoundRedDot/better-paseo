import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import {
  FOLLOW_INTERFACE_LANGUAGE_CODE,
  isTranslationLanguageCode,
  resolveTranslationTarget,
} from "./translation-languages";

export const TRANSLATION_HELPER_LABEL = "better-paseo.purpose";
export const TRANSLATION_HELPER_PURPOSE = "timeline-translation";

export const DEFAULT_TRANSLATION_PROMPT =
  "Translate the supplied text into the target language. Preserve Markdown, code blocks, inline code, commands, paths, links, and technical identifiers. Return only the translation, without explanations.";

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
  enabled: z.boolean().catch(true),
  customModel: z.boolean().catch(false),
  disableThinking: z.boolean().catch(true),
  provider: z.string().catch(""),
  model: z.string().catch(""),
  thinkingOptionId: z.string().catch(""),
  targetLanguage: z.string().refine(isTranslationLanguageCode).catch(FOLLOW_INTERFACE_LANGUAGE_CODE),
  prompt: z.string().trim().min(1).max(8000).catch(DEFAULT_TRANSLATION_PROMPT),
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
      sourceKind: z.enum(["assistant_message", "reasoning"]),
      interfaceLanguage: z.enum(["en", "zh"]).default("en"),
    }),
    z.object({
      action: z.literal("status"),
      jobId: z.string().min(1),
    }),
  ]),
  output: translationJobStateSchema,
});

export const translationModelsRpc = defineRpc({
  name: "translation.models",
  input: z.object({ provider: z.string() }),
  output: z.object({
    providers: z.array(z.string()),
    providerLabels: z.record(z.string(), z.string()).default({}),
    models: z.array(z.object({
      id: z.string(),
      label: z.string(),
      thinkingOptions: z.array(z.object({ id: z.string(), label: z.string() })),
      defaultThinkingOptionId: z.string().nullable(),
    })),
    error: z.string().nullable(),
  }),
});
