import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const updateCheckRpc = defineRpc({
  name: "settings.update-check",
  input: z.object({ action: z.enum(["check", "status"]) }),
  output: z.discriminatedUnion("state", [
    z.object({ state: z.literal("idle") }),
    z.object({ state: z.literal("checking") }),
    z.object({ state: z.literal("failed") }),
    z.object({ state: z.literal("local") }),
    z.object({ state: z.literal("unsupported") }),
    z.object({ state: z.literal("done"), current: z.string(), latest: z.string(), matches: z.boolean(), checkedAt: z.number(), versions: z.discriminatedUnion("status", [
      z.object({ status: z.literal("available"), current: z.string().nullable(), latest: z.string().nullable() }),
      z.object({ status: z.literal("unavailable") }),
    ]), notes: z.discriminatedUnion("status", [
      z.object({ status: z.literal("available"), zh: z.string(), en: z.string() }),
      z.object({ status: z.literal("missing") }),
      z.object({ status: z.literal("unavailable") }),
    ]) }),
  ]),
});
