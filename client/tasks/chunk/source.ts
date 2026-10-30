import * as entry from "./entry";
import type { TasksChunk } from "./types";

/**
 * The Tasks chunk in a checkout: imported with the rest of the bundle, so
 * it is always there. An install builds the bundle with `remote.ts` in this
 * file's place (`scripts/build-client.mjs`); both export the same functions.
 */

export function chunkNow(): TasksChunk | null {
  return entry;
}

export function requestChunk(): void {}

export function requestChunkLater(): void {}

export function cancelChunkLater(): void {}

export function subscribeChunk(_listener: () => void): () => void {
  return () => {};
}

export function setChunkClient(_client: unknown): void {}
