import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_TITLE_PROMPT = "Generate a concise, specific task title from the supplied conversation. Use the language of the first user message. Focus on the actual goal and preserve key module names, issue numbers, and technical identifiers. Limit the title to 80 characters including spaces. Return only the title, without quotes, explanations, or Markdown.";

export const titleGenerationSettingsSchema = z.object({
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
  z.object({ state: z.literal("done"), title: z.string() }),
  z.object({ state: z.literal("error"), error: z.string() }),
]);
export type TitleUpdateState = z.output<typeof titleUpdateStateSchema>;

export const titleUpdateRpc = defineRpc({
  name: "tasks.title-update",
  input: z.object({ agentId: z.string().min(1), action: z.enum(["start", "status"]), mode: z.enum(["apply", "preview"]).default("apply") }),
  output: titleUpdateStateSchema,
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
