export const TITLE_HELPER_LABEL = "better-paseo.purpose";
export const TITLE_HELPER_PURPOSE = "title-generation";

import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_TITLE_PROMPT = "Generate a concise, specific task title from the supplied conversation. Use the language of the first user message. Focus on the actual goal and preserve key module names, issue numbers, and technical identifiers. Limit the title to 60 characters including spaces. Return only the title, without quotes, explanations, or Markdown.";

export const titleGenerationSettingsSchema = z.object({
  /** Generate from the first prompt at turn start; retain the stored settings key. */
  afterFirstReply: z.boolean().catch(false),
  customModel: z.boolean().catch(false),
  disableThinking: z.boolean().catch(true),
  provider: z.string().catch(""),
  model: z.string().catch(""),
  thinkingOptionId: z.string().catch(""),
  prompt: z.string().trim().min(1).max(8000).catch(DEFAULT_TITLE_PROMPT),
});
export const TITLE_GENERATION_SETTINGS = defineSettings({
  id: "title-generation", scope: "host", version: 1, schema: titleGenerationSettingsSchema,
});

export const titleUpdateStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }),
  // The title streams in as `text`; `helperId` is the helper agent whose live timeline announces each chunk.
  z.object({ state: z.literal("running"), text: z.string().optional(), helperId: z.string().optional() }),
  z.object({ state: z.literal("done"), title: z.string(), previousTitle: z.string().optional() }),
  z.object({ state: z.literal("error"), error: z.string() }),
]);
export type TitleUpdateState = z.output<typeof titleUpdateStateSchema>;

export const titleUpdateRpc = defineRpc({
  name: "tasks.title-update",
  input: z.object({ agentId: z.string().min(1), action: z.enum(["start", "status"]), mode: z.enum(["apply", "preview"]).default("apply") }),
  output: titleUpdateStateSchema,
});

export const titleUndoRpc = defineRpc({
  name: "tasks.title-undo",
  input: z.object({ agentId: z.string().min(1), title: z.string().min(1), previousTitle: z.string().trim().min(1) }),
  output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
});

export const titleLanguageRpc = defineRpc({
  name: "tasks.title-language",
  input: z.object({ language: z.enum(["en", "zh"]) }),
  output: z.object({ ok: z.literal(true) }),
});

export const titleModelsRpc = defineRpc({
  name: "tasks.title-models",
  input: z.object({ provider: z.string() }),
  output: z.object({
    providers: z.array(z.string()),
    models: z.array(z.object({
      id: z.string(), label: z.string(),
      thinkingOptions: z.array(z.object({ id: z.string(), label: z.string() })),
      defaultThinkingOptionId: z.string().nullable(),
    })),
    error: z.string().nullable(),
  }),
});
