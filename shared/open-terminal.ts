import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const openTerminalRpc = defineRpc({
  name: "settings.open-terminal",
  input: z.object({
    source: z.enum(["registry", "git"]),
    latest: z.string().regex(/^[a-f0-9]{40}$/),
  }),
  output: z.object({ status: z.enum(["opened", "unsupported", "failed"]) }),
});

export function updateCommand(source: "registry" | "git", latest: string): string {
  return source === "registry" ? "paseo plugin update better-paseo" : `paseo plugin update better-paseo --ref ${latest}`;
}
