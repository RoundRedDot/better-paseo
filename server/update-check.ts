import { z } from "zod";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { connectHostDaemon } from "./tasks/provider-subagents";
import { updateCheckRpc } from "../shared/update-check";

const REGISTRY_URL = "https://plugins.paseo.sh/plugins/roundreddot/better-paseo.json";
const RELEASES_URL = "https://raw.githubusercontent.com/RoundRedDot/better-paseo-assets/main/releases.json";
const MAX_RESPONSE_BYTES = 64 * 1024;
export const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
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
    z.object({ kind: z.literal("git"), remote: z.string(), registry: z.object({ url: z.string(), id: z.string() }).optional() }),
    z.object({ kind: z.literal("directory") }),
    z.object({ kind: z.literal("npm") }),
  ]),
  currentRevision: z.string().optional(),
});

const releasesSchema = z.object({ releases: z.array(z.object({ hash: sha, version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/), build: z.number().int().min(100_000_000_000).max(999_999_999_999), notes: z.object({ zh: z.string().min(1), en: z.string().min(1) }) })) });
type Notes = { status: "available"; zh: string; en: string } | { status: "missing" | "unavailable" };

type Versions = { status: "available"; current: string | null; latest: string | null; currentBuild: number | null; latestBuild: number | null } | { status: "unavailable" };

type State = { state: "idle" | "checking" | "failed" | "local" | "unsupported" } | { state: "done"; source: "registry" | "git"; current: string; latest: string; matches: boolean; checkedAt: number; notes: Notes; versions: Versions };

export function createUpdateCheck(deps = { fetchVersion: fetch, connect: connectHostDaemon }, cachePath?: string) {
  let state: State = { state: "idle" };
  let running = false;
  let lastAttempt = 0;
  let stage = "connect";
  async function save() {
    if (!cachePath) return;
    await mkdir(dirname(cachePath), { recursive: true });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ lastAttempt, state }));
    await rename(temporary, cachePath);
  }
  async function restore() {
    if (!cachePath) return;
    try {
      const cache = z.object({ lastAttempt: z.number().nonnegative(), state: updateCheckRpc.output }).parse(JSON.parse(await readFile(cachePath, "utf8")));
      if (cache.state.state === "local" || cache.state.state === "unsupported") return;
      if (cache.state.state === "done") {
        const client = await deps.connect("cid_better_paseo_update_restore");
        if (!client) return;
        try {
          const daemon = client as typeof client & { listPlugins(): Promise<Array<{ id: string; installation?: unknown }>> };
          const installation = installationSchema.parse((await daemon.listPlugins()).find((entry) => entry.id === "better-paseo")?.installation);
          if (installation.identity.kind !== "git" || installation.currentRevision !== cache.state.current ||
              (cache.state.source === "registry") !== !!installation.identity.registry ||
              !/^(https:\/\/github\.com\/RoundRedDot\/better-paseo(?:\.git)?|git@github\.com:RoundRedDot\/better-paseo(?:\.git)?)$/i.test(installation.identity.remote) ||
              (installation.identity.registry && (installation.identity.registry.url !== "https://plugins.paseo.sh" || installation.identity.registry.id !== "roundreddot/better-paseo"))) return;
        } finally {
          await client.close().catch(() => {});
        }
      }
      if (state.state !== "idle") return;
      lastAttempt = cache.lastAttempt;
      state = cache.state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[better-paseo] could not restore update check", error);
    }
  }
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
      if (current.identity.registry && (current.identity.registry.url !== "https://plugins.paseo.sh" || current.identity.registry.id !== "roundreddot/better-paseo")) {
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
        const installed = releases.find((entry) => entry.hash === revision);
        versions = { status: "available", current: installed?.version ?? null, latest: published?.version ?? null, currentBuild: installed?.build ?? null, latestBuild: published?.build ?? null };
        notes = published ? { status: "available", ...published.notes } : { status: "missing" };
      } catch {
        versions = { status: "unavailable" };
        notes = { status: "unavailable" };
      }
      state = { state: "done", source: current.identity.registry ? "registry" : "git", current: revision, latest, matches: revision === latest, checkedAt: Date.now(), notes, versions };
    } finally {
      await client.close().catch(() => {});
    }
  }
  const check = (action: "check" | "status"): State => {
    if (action === "check" && !running) {
      running = true;
      lastAttempt = Date.now();
      state = { state: "checking" };
      void run().catch(() => { console.warn(`[better-paseo] version check failed: ${stage}`); state = { state: "failed" }; }).then(() => save().catch((error: unknown) => console.warn("[better-paseo] could not save update check", error))).finally(() => { running = false; });
    }
    return state;
  };
  return Object.assign(check, { restore, lastCheckedAt: () => lastAttempt });
}

export function startAutomaticUpdateCheck(
  settings: { read(): Promise<{ status: "ready"; values: { autoUpdateCheck: boolean } } | { status: "invalid" }>; subscribe?(listener: () => void): () => void },
  check: ((action: "check" | "status") => State) & { restore?(): Promise<void>; lastCheckedAt?(): number },
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let initialized = false;
  let generation = 0;
  async function schedule() {
    const current = ++generation;
    clearTimeout(timer);
    try {
      const result = await settings.read();
      if (!active || current !== generation || result.status !== "ready" || !result.values.autoUpdateCheck) return;
      const last = check.lastCheckedAt?.() ?? 0;
      const remaining = last ? Math.max(0, UPDATE_CHECK_INTERVAL - (Date.now() - last)) : 0;
      if (remaining === 0) check("check");
      timer = setTimeout(() => { void schedule(); }, remaining || UPDATE_CHECK_INTERVAL);
    } catch (error) {
      console.warn("[better-paseo] could not read update check settings", error);
      if (active && current === generation) timer = setTimeout(() => { void schedule(); }, UPDATE_CHECK_INTERVAL);
    }
  }
  const unsubscribe = settings.subscribe?.(() => { if (initialized) void schedule(); });
  void (check.restore?.() ?? Promise.resolve()).then(() => {
    if (!active) return;
    initialized = true;
    void schedule();
  });
  return () => { active = false; generation++; clearTimeout(timer); unsubscribe?.(); };
}
