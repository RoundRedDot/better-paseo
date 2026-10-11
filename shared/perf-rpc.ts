import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Debug only. Carries a `__bcPerf` snapshot from a client that has no console
 * (production Electron, iOS) to the daemon machine, which writes it to disk.
 * Nothing calls it unless the `/bc-perf dump` slash command is run.
 */
export const perfDumpRpc = defineRpc({
  name: "debug.perf.dump",
  input: z.object({
    label: z.string(),
    platform: z.string(),
    data: z.record(z.string(), z.unknown()),
  }),
  output: z.object({
    path: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
