import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const providerFamilyRpc = defineRpc({
  name: "provider.family",
  input: z.object({ provider: z.string() }),
  output: z.object({ codex: z.boolean() }),
});
