import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_TITLE_PROMPT = "根据提供的对话，为任务生成简洁、具体的中文标题。突出实际目标，保留关键模块名、问题编号和技术标识，建议不超过 24 个字。只输出标题，不加引号、解释或 Markdown。";

export const titleGenerationSettingsSchema = z.object({
  provider: z.string().catch(""),
  model: z.string().catch(""),
  prompt: z.string().trim().min(1).max(8000).catch(DEFAULT_TITLE_PROMPT),
});
export const TITLE_GENERATION_SETTINGS = defineSettings({
  id: "title-generation", scope: "host", version: 1, schema: titleGenerationSettingsSchema,
});

export const titleUpdateStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }),
  z.object({ state: z.literal("running") }),
  z.object({ state: z.literal("done"), title: z.string() }),
  z.object({ state: z.literal("error"), error: z.string() }),
]);
export type TitleUpdateState = z.output<typeof titleUpdateStateSchema>;

export const titleUpdateRpc = defineRpc({
  name: "tasks.title-update",
  input: z.object({ agentId: z.string().min(1), action: z.enum(["start", "status"]) }),
  output: titleUpdateStateSchema,
});

export const titleModelsRpc = defineRpc({
  name: "tasks.title-models",
  input: z.object({ provider: z.string() }),
  output: z.object({
    providers: z.array(z.string()),
    models: z.array(z.object({ id: z.string(), label: z.string() })),
    error: z.string().nullable(),
  }),
});
