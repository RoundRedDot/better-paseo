import type { PluginClientContext } from "@getpaseo/plugin/client";
import { tasksChunkRpc } from "../../../shared/tasks-rpc";
import type { TasksChunk } from "./types";

/**
 * The Tasks chunk fetched from the plugin server (`tasksChunkRpc`) and
 * evaluated here; `remote.ts` makes the one an install uses. Its code is
 * kept on the JS runtime's global by build id, so a bundle a reconnect
 * evaluates again has it at once, with no request. Each bundle evaluation
 * evaluates the code again: its imports of modules the bundle holds
 * (`shared`) must reach this evaluation's instances, or the two would keep
 * apart copies of one store.
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
}

export interface RemoteChunk {
  chunkNow(): TasksChunk | null;
  requestChunk(): void;
  subscribeChunk(listener: () => void): () => void;
  setChunkClient(client: unknown): void;
}

export const CHUNK_CACHE = "__betterPaseoTasksChunk";
const RETRY_MS = [1_000, 3_000, 10_000];

export function createRemoteChunk({ id, shared, hostRequire, retryMs = RETRY_MS }: RemoteChunkOptions): RemoteChunk {
  let chunk: TasksChunk | null = null;
  let client: PluginClientContext | null = null;
  let loading = false;
  let failures = 0;
  const listeners = new Set<() => void>();

  const cached = (): string | null => {
    const entry = (globalThis as Record<string, unknown>)[CHUNK_CACHE] as { id?: unknown; code?: unknown } | undefined;
    return entry && entry.id === id && typeof entry.code === "string" ? entry.code : null;
  };

  const evaluate = (code: string): TasksChunk => {
    const module = { exports: {} as Record<string, unknown> };
    const load = (name: string) => (name in shared ? shared[name] : hostRequire(name));
    new Function("require", "module", "exports", code)(load, module, module.exports);
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

  const requestChunk = (): void => {
    if (chunkNow() || loading || !client) return;
    const from = client;
    loading = true;
    void from
      .rpc(tasksChunkRpc, { id })
      .then((result) => {
        if (client !== from) return;
        if (typeof result.code !== "string") throw new Error("the plugin server holds another Tasks build");
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

  return {
    chunkNow,
    requestChunk,
    subscribeChunk(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setChunkClient(next) {
      client = next as PluginClientContext | null;
    },
  };
}
