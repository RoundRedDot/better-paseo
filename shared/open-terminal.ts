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

// Official `paseo plugin update <id>` proposes the current default HEAD and asks
// before applying. `--ref` only selects Git content at install time.
export function updateCommand(): string {
  return "paseo plugin update better-paseo";
}
