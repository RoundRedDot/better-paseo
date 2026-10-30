import type { PluginClientContext } from "@getpaseo/plugin/client";
import { tasksChunkRpc } from "../../../shared/tasks-rpc";
import { loadMark } from "../../debug/load-marks";
import type { TasksChunk } from "./types";

/**
 * The Tasks chunk fetched from the plugin server (`tasksChunkRpc`) and
 * evaluated here; `remote.ts` makes the one an install uses. Its code is
 * kept on the JS runtime's global by build id, so a bundle a reconnect
 * evaluates again has it at once, with no request. Each bundle evaluation
 * evaluates the code again: its imports of modules the bundle holds
 * (`shared`) must reach this evaluation's instances, or the two would keep
 * apart copies of one store.
 *
 * Two ways to ask: `requestChunk` fetches now (someone opened the board,
 * its settings or the Command Center item), `requestChunkLater` once
 * startup has settled (`afterStartup`: the sidebar row, mounted though
 * hidden on phones, and the board being on), so the chunk's transfer and
 * evaluation stay off the first chat rows. An asking-now cancels a pending
 * later; either way one fetch at a time.
 */
export interface RemoteChunkOptions {
  /** The chunk build this bundle was made with. */
  id: string;
  /** The bundle's modules the chunk imports, by the ids the build gave them. */
  shared: Record<string, unknown>;
  /** The host's `require`, for the chunk's other imports. */
  hostRequire(id: string): unknown;
  /** Waits before trying a failed fetch again; past the last one it stops. */
  retryMs?: readonly number[];
  /** Schedules a background fetch; returns a cancel (`afterStartup` in an install). */
  later: (run: () => void) => () => void;
}

export interface RemoteChunk {
  chunkNow(): TasksChunk | null;
  requestChunk(): void;
  requestChunkLater(): void;
  /** Drops a pending later fetch (the board was turned off). */
  cancelChunkLater(): void;
  subscribeChunk(listener: () => void): () => void;
  setChunkClient(client: unknown): void;
}

export const CHUNK_CACHE = "__betterPaseoTasksChunk";
const RETRY_MS = [1_000, 3_000, 10_000];

export function createRemoteChunk({ id, shared, hostRequire, retryMs = RETRY_MS, later }: RemoteChunkOptions): RemoteChunk {
  let chunk: TasksChunk | null = null;
  let client: PluginClientContext | null = null;
  let loading = false;
  let failures = 0;
  let cancelLater: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const cached = (): string | null => {
    const entry = (globalThis as Record<string, unknown>)[CHUNK_CACHE] as { id?: unknown; code?: unknown } | undefined;
    return entry && entry.id === id && typeof entry.code === "string" ? entry.code : null;
  };

  const evaluate = (code: string): TasksChunk => {
    const module = { exports: {} as Record<string, unknown> };
    const load = (name: string) => (name in shared ? shared[name] : hostRequire(name));
    const factory = new Function("require", "module", "exports", code);
    loadMark("chunk.compiled");
    factory(load, module, module.exports);
    loadMark("chunk.evaluated");
    return module.exports as unknown as TasksChunk;
  };

  const chunkNow = (): TasksChunk | null => {
    // From the cache: whoever asks gets it now, so nobody needs telling (and
    // a render may be asking).
    if (!chunk) {
      const code = cached();
      if (code) chunk = evaluate(code);
    }
    return chunk;
  };

  const dropLater = () => {
    cancelLater?.();
    cancelLater = null;
  };

  const requestChunk = (): void => {
    dropLater();
    if (chunkNow() || loading || !client) return;
    const from = client;
    loading = true;
    loadMark("chunk.request");
    void from
      .rpc(tasksChunkRpc, { id })
      .then((result) => {
        if (client !== from) return;
        if (typeof result.code !== "string") throw new Error("the plugin server holds another Tasks build");
        loadMark("chunk.response");
        chunk = evaluate(result.code);
        (globalThis as Record<string, unknown>)[CHUNK_CACHE] = { id, code: result.code };
        for (const listener of [...listeners]) listener();
      })
      .catch((error: unknown) => {
        console.warn("[better-paseo] Tasks code did not load", error);
        const delay = retryMs[failures++];
        if (delay !== undefined) setTimeout(requestChunk, delay);
      })
      .finally(() => {
        loading = false;
      });
  };

  const requestChunkLater = (): void => {
    if (cancelLater || chunkNow() || loading || !client) return;
    loadMark("chunk.scheduled");
    cancelLater = later(() => {
      cancelLater = null;
      requestChunk();
    });
  };

  return {
    chunkNow,
    requestChunk,
    requestChunkLater,
    cancelChunkLater: dropLater,
    subscribeChunk(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setChunkClient(next) {
      client = next as PluginClientContext | null;
      // A later fetch belongs to the client that asked for it.
      if (!client) dropLater();
    },
  };
}
