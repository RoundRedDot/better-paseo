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
    z.object({ state: z.literal("done"), source: z.enum(["registry", "git"]), current: z.string(), latest: z.string(), matches: z.boolean(), checkedAt: z.number(), versions: z.discriminatedUnion("status", [
      z.object({ status: z.literal("available"), current: z.string().nullable(), latest: z.string().nullable(), currentBuild: z.number().nullable(), latestBuild: z.number().nullable() }),
      z.object({ status: z.literal("unavailable") }),
    ]), notes: z.discriminatedUnion("status", [
      z.object({ status: z.literal("available"), zh: z.string(), en: z.string() }),
      z.object({ status: z.literal("missing") }),
      z.object({ status: z.literal("unavailable") }),
    ]) }),
  ]),
});

/** Release documents contain stable, numeric versions validated by the server. */
export function isNewerVersion(current: string, latest: string, currentBuild: number, latestBuild: number): boolean {
  const before = current.split(".");
  const after = latest.split(".");
  for (let i = 0; i < 3; i++) {
    if (before[i]!.length !== after[i]!.length) return after[i]!.length > before[i]!.length;
    if (before[i] !== after[i]) return after[i]! > before[i]!;
  }
  return latestBuild > currentBuild;
}

export type UpdateCheckState = z.output<typeof updateCheckRpc.output>;

export function hasUpdate(state: UpdateCheckState): boolean {
  if (state.state !== "done" || state.versions.status !== "available") return false;
  const versions = state.versions;
  return versions.current !== null && versions.latest !== null && versions.currentBuild !== null && versions.latestBuild !== null
    && isNewerVersion(versions.current, versions.latest, versions.currentBuild, versions.latestBuild);
}
