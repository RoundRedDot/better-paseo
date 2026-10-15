import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import type { output as ZodOutput } from "zod";
import { imageRpc } from "../shared/image-rpc";
import { probeImageRpc } from "./debug/perf";

type ImageRpcResult = ZodOutput<typeof imageRpc.output>;
interface ImageRead {
  request: Promise<ImageRpcResult>;
  committed: Promise<void>;
}

// This module-level map is connection-local only because Paseo evaluates this
// client bundle once per serverId/pluginId; verified for v0.8.0–v0.11.2.
const imageReadsInFlight = new Map<string, ImageRead>();
const newlyStartedImageReads = new WeakSet<Promise<unknown>>();

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
      const key = JSON.stringify([input.cwd, input.path]);
      const pending = imageReadsInFlight.get(key);
      let commit!: () => void;
      const committed = new Promise<void>((resolve) => { commit = resolve; });
      if (pending) {
        const afterCommit = pending.committed;
        pending.committed = committed;
        return { request: pending.request, afterCommit, commit };
      }

      const request = rpcLoad(input);
      const entry = { request, committed };
      imageReadsInFlight.set(key, entry);
      newlyStartedImageReads.add(request);
      const clear = () => {
        if (imageReadsInFlight.get(key) === entry) imageReadsInFlight.delete(key);
      };
      void request.then(clear, clear);
      return { request, afterCommit: null, commit };
    },
    [rpcLoad],
  );
  const [file, setFile] = useState<ImageFile | null>(null);
  const deliveryCommit = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const commit = deliveryCommit.current;
    deliveryCommit.current = null;
    commit?.();
  }, [file]);
  const wanted = path !== undefined && isImagePath(path);

  useEffect(() => {
    if (!wanted || path === undefined) {
      setFile(null);
      return;
    }
    let cancelled = false;
    let frame: number | null = null;
    setFile(null);
    const requestCwd = cwd ?? "";
    const { request, afterCommit, commit } = load({ cwd: requestCwd, path });
    // One growing card per commit: batching shared consumers raised history
    // CLS from 0.257 to 0.583 and made that commit heavier. The starter stays
    // immediate; each joiner waits for the previous commit, then one frame.
    // rAF alone can race React's pending commit and batch two cards again.
    const deliver = (next: ImageFile) => {
      const apply = () => {
        frame = null;
        if (cancelled) return;
        deliveryCommit.current = commit;
        setFile(next);
      };
      if (afterCommit === null) apply();
      else void afterCommit.then(() => {
        if (!cancelled) frame = requestAnimationFrame(apply);
      });
    };
    request
      .then((result) => {
        if (cancelled) return;
        deliver({
          dataUri: result.dataUri,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
          error: result.error,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        deliver({
          dataUri: null,
          width: null,
          height: null,
          bytes: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    // Count this request only when this consumer started the actual RPC.
    if (newlyStartedImageReads.delete(request)) probeImageRpc(requestCwd, path, request);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (deliveryCommit.current === commit) deliveryCommit.current = null;
      // A cancelled slot still releases later joiners, after its predecessor.
      if (afterCommit === null) commit();
      else void afterCommit.then(commit);
    };
  }, [load, path, cwd, wanted]);

  return wanted ? file : null;
}
