import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import type { output as ZodOutput } from "zod";
import { imageRpc } from "../shared/image-rpc";
import { probeImageRpc } from "./debug/perf";

type ImageRpcResult = ZodOutput<typeof imageRpc.output>;
/**
 * One read of one cwd/path pair and its result, shared by every card that
 * shows it. Kept while a card holds it or the RPC is out, then dropped: this
 * is not a cache, a later mount of the same image reads it again.
 */
interface ImageRead {
  request: Promise<ImageRpcResult>;
  /** Resolves once `file` is set. */
  settled: Promise<void>;
  file: ImageFile | null;
  /** The last joiner's commit; the next joiner waits for it. */
  committed: Promise<void>;
  holders: number;
  done: boolean;
}

// This module-level map is connection-local only because Paseo evaluates this
// client bundle once per serverId/pluginId; verified for v0.8.0–v0.11.2.
const imageReads = new Map<string, ImageRead>();
const imageListeners = new Map<string, Set<() => void>>();
const newlyStartedImageReads = new WeakSet<Promise<unknown>>();

const imageKey = (cwd: string, path: string) => JSON.stringify([cwd, path]);

function subscribeImage(key: string, listener: () => void): () => void {
  let set = imageListeners.get(key);
  if (!set) imageListeners.set(key, set = new Set());
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) imageListeners.delete(key);
  };
}

function notifyImage(key: string): void {
  for (const listener of imageListeners.get(key) ?? []) listener();
}

function dropImageRead(key: string, entry: ImageRead): void {
  if (entry.holders > 0 || !entry.done || imageReads.get(key) !== entry) return;
  imageReads.delete(key);
  notifyImage(key);
}

/** What the daemon side could tell the client about one image file. */
export interface ImageFile {
  dataUri: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  error: string | null;
}

/**
 * File extensions worth previewing.
 *
 * The client decides whether to ask at all, so a read of a `.ts` file never
 * costs an RPC. The daemon holds the same list and refuses anything outside
 * it, because that side is the one handing bytes to an `<img>`.
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "svg",
]);

/** Strips the selector a tool appends to a path, such as `shot.png:1-20`. */
function stripSelector(path: string): string {
  const trimmed = path.trim();
  const drive = /^[a-zA-Z]:[\\/]/.test(trimmed);
  const head = drive ? trimmed.slice(0, 3) : "";
  const tail = drive ? trimmed.slice(3) : trimmed;
  const cut = tail.search(/[\s:?#]/);
  return cut === -1 ? trimmed : head + tail.slice(0, cut);
}

/** True when this path names a file the chat can draw rather than tokenise. */
export function isImagePath(path: string | undefined): boolean {
  if (!path) return false;
  // The whole name first: a space or `#` in it (`My Shots/a.png`) is part of
  // the name, and only a name that is not an image is cut at a selector.
  return endsInImageExtension(path.trim()) || endsInImageExtension(stripSelector(path));
}

function endsInImageExtension(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot <= 0 || dot < path.lastIndexOf("/")) return false;
  return IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * Reads an image through the plugin's own daemon-side RPC.
 *
 * Null while the read is in flight. A failure resolves to a record carrying
 * the reason rather than throwing, so a missing file shows its message in the
 * card instead of taking the timeline down.
 */
export function useImageFile(path: string | undefined, cwd: string | null): ImageFile | null {
  const rpcLoad = useRpc(imageRpc);
  const load = useCallback(
    (input: Parameters<typeof rpcLoad>[0]) => {
      const key = imageKey(input.cwd, input.path);
      const shared = imageReads.get(key);
      let commit!: () => void;
      const committed = new Promise<void>((resolve) => { commit = resolve; });
      if (shared) {
        const afterCommit = shared.committed;
        shared.committed = committed;
        shared.holders += 1;
        return { key, entry: shared, afterCommit, commit };
      }

      const request = rpcLoad(input);
      const entry: ImageRead = { request, settled: Promise.resolve(), file: null, committed, holders: 1, done: false };
      entry.settled = request.then(
        (result) => ({
          dataUri: result.dataUri,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
          error: result.error,
        }),
        (error: unknown) => ({
          dataUri: null,
          width: null,
          height: null,
          bytes: null,
          error: error instanceof Error ? error.message : String(error),
        }),
      ).then((file) => {
        entry.file = file;
        entry.done = true;
        dropImageRead(key, entry);
      });
      imageReads.set(key, entry);
      newlyStartedImageReads.add(request);
      return { key, entry, afterCommit: null, commit };
    },
    [rpcLoad],
  );
  const wanted = path !== undefined && isImagePath(path);
  const key = wanted ? imageKey(cwd ?? "", path) : null;
  // Which read this card has been handed. The file itself stays in the
  // shared read, and a card shows it only from its own delivery commit on.
  // A fresh token per delivery, so a repeat delivery still commits and releases the next joiner.
  const [delivered, setDelivered] = useState<{ read: ImageRead } | null>(null);
  const deliveryCommit = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const commit = deliveryCommit.current;
    deliveryCommit.current = null;
    commit?.();
  }, [delivered]);
  const subscribe = useCallback((listener: () => void) => (key === null ? () => {} : subscribeImage(key, listener)), [key]);
  const read = useCallback(() => {
    // A changed path shows nothing from its first render, not the previous image.
    const current = key === null ? undefined : imageReads.get(key);
    return current && current === delivered?.read ? current.file : null;
  }, [key, delivered]);
  const file = useSyncExternalStore(subscribe, read, read);

  useEffect(() => {
    if (!wanted || path === undefined) {
      setDelivered(null);
      return;
    }
    let cancelled = false;
    let frame: number | null = null;
    setDelivered(null);
    const requestCwd = cwd ?? "";
    const { key: readKey, entry, afterCommit, commit } = load({ cwd: requestCwd, path });
    // One growing card per commit: batching shared consumers raised history
    // CLS from 0.257 to 0.583 and made that commit heavier. The starter stays
    // immediate; each joiner waits for the previous commit, then one frame.
    // rAF alone can race React's pending commit and batch two cards again.
    const apply = () => {
      frame = null;
      if (cancelled) return;
      deliveryCommit.current = commit;
      setDelivered({ read: entry });
    };
    void entry.settled.then(() => {
      if (cancelled) return;
      if (afterCommit === null) apply();
      else void afterCommit.then(() => {
        if (!cancelled) frame = requestAnimationFrame(apply);
      });
    });
    // Count this request only when this consumer started the actual RPC.
    if (newlyStartedImageReads.delete(entry.request)) probeImageRpc(requestCwd, path, entry.request);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (deliveryCommit.current === commit) deliveryCommit.current = null;
      // A cancelled slot still releases later joiners, after its predecessor.
      if (afterCommit === null) commit();
      else void afterCommit.then(commit);
      entry.holders -= 1;
      dropImageRead(readKey, entry);
    };
  }, [load, path, cwd, wanted]);

  return file;
}
