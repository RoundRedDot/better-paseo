import { z } from "zod";

export const modelCatalogSchema = z.object({
  providers: z.array(z.string()),
  providerLabels: z.record(z.string(), z.string()).default({}),
  models: z.array(z.object({
    id: z.string(), label: z.string(),
    thinkingOptions: z.array(z.object({ id: z.string(), label: z.string() })),
    defaultThinkingOptionId: z.string().nullable(),
  })),
  error: z.string().nullable(),
});

export type ModelCatalog = z.output<typeof modelCatalogSchema>;
export type CatalogModel = ModelCatalog["models"][number];

export function thinkingForModel(model: CatalogModel | undefined, current: string): string {
  const options = model?.thinkingOptions ?? [];
  if (current && options.some((option) => option.id === current)) return current;
  return ["off", "none", "disabled", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]
    .find((id) => options.some((option) => option.id === id)) ?? options[0]?.id ?? "";
}

export function modelSelection(model: CatalogModel | undefined, current: string) {
  return { model: model?.id ?? "", thinkingOptionId: thinkingForModel(model, current) };
}
