import { z } from "zod";
import { connectHostDaemon } from "./tasks/provider-subagents";

const REGISTRY_URL = "https://plugins.paseo.sh/plugins/roundreddot/better-paseo.json";
const RELEASES_URL = "https://raw.githubusercontent.com/RoundRedDot/better-paseo-assets/main/releases.json";
const MAX_RESPONSE_BYTES = 64 * 1024;
async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Response too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const registrySchema = z.object({
  id: z.literal("roundreddot/better-paseo"),
  artifact: z.object({ kind: z.literal("git"), remote: z.literal("https://github.com/RoundRedDot/better-paseo.git"), commit: sha }),
});
const installationSchema = z.object({
  identity: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("git"), remote: z.string() }),
    z.object({ kind: z.literal("directory") }),
    z.object({ kind: z.literal("npm") }),
  ]),
  currentRevision: z.string().optional(),
});

const releasesSchema = z.object({ releases: z.array(z.object({ hash: sha, version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/), notes: z.object({ zh: z.string().min(1), en: z.string().min(1) }) })) });
type Notes = { status: "available"; zh: string; en: string } | { status: "missing" | "unavailable" };

type Versions = { status: "available"; current: string | null; latest: string | null } | { status: "unavailable" };

type State = { state: "idle" | "checking" | "failed" | "local" | "unsupported" } | { state: "done"; current: string; latest: string; matches: boolean; checkedAt: number; notes: Notes; versions: Versions };

export function createUpdateCheck(deps = { fetchVersion: fetch, connect: connectHostDaemon }) {
  let state: State = { state: "idle" };
  let running = false;
  let stage = "connect";
  async function run() {
    stage = "connect";
    const client = await deps.connect("cid_better_paseo_update_check");
    if (!client) throw new Error("Could not connect to the host.");
    try {
      stage = "registry";
      const response = await deps.fetchVersion(REGISTRY_URL, { signal: AbortSignal.timeout(10_000), cache: "no-store", redirect: "error" });
      if (!response.ok) throw new Error("Could not read the plugin directory.");
      const latest = registrySchema.parse(await readJson(response)).artifact.commit;
      stage = "installation";
      const daemon = client as typeof client & { listPlugins(): Promise<Array<{ id: string; installation?: unknown }>> };
      const plugin = (await daemon.listPlugins()).find((entry) => entry.id === "better-paseo");
      const current = installationSchema.parse(plugin?.installation);
      if (current.identity.kind === "directory") {
        state = { state: "local" };
        return;
      }
      if (current.identity.kind !== "git" || !/^(https:\/\/github\.com\/RoundRedDot\/better-paseo(?:\.git)?|git@github\.com:RoundRedDot\/better-paseo(?:\.git)?)$/i.test(current.identity.remote)) {
        state = { state: "unsupported" };
        return;
      }
      const revision = sha.parse(current.currentRevision);
      let notes: Notes;
      let versions: Versions;
      try {
        const response = await deps.fetchVersion(RELEASES_URL, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
        if (!response.ok) throw new Error("Could not read release information.");
        const releases = releasesSchema.parse(await readJson(response)).releases;
        const published = releases.find((entry) => entry.hash === latest);
        versions = { status: "available", current: releases.find((entry) => entry.hash === revision)?.version ?? null, latest: published?.version ?? null };
        notes = published ? { status: "available", ...published.notes } : { status: "missing" };
      } catch {
        versions = { status: "unavailable" };
        notes = { status: "unavailable" };
      }
      state = { state: "done", current: revision, latest, matches: revision === latest, checkedAt: Date.now(), notes, versions };
    } finally {
      await client.close().catch(() => {});
    }
  }
  return (action: "check" | "status"): State => {
    if (action === "check" && !running) {
      running = true;
      state = { state: "checking" };
      void run().catch(() => { console.warn(`[better-paseo] version check failed: ${stage}`); state = { state: "failed" }; }).finally(() => { running = false; });
    }
    return state;
  };
}
