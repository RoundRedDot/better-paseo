import shared from "bc-tasks-shared";
import { afterStartup } from "../../state/startup-settled";
import { createRemoteChunk } from "./remote-chunk";

/**
 * The Tasks chunk in an install, in `source.ts`'s place: the build leaves
 * the board's code out of the bundle and gives this file the chunk's id and
 * the modules it shares (`scripts/build-client.mjs`).
 */
declare const __BC_TASKS_CHUNK_ID__: string;
/** The bundle factory's `require`: the host's, as the bundle got it. */
declare const require: (id: string) => unknown;

const remote = createRemoteChunk({ id: __BC_TASKS_CHUNK_ID__, shared, hostRequire: (id) => require(id), later: afterStartup });

export const chunkNow = remote.chunkNow;
export const requestChunk = remote.requestChunk;
export const requestChunkLater = remote.requestChunkLater;
export const cancelChunkLater = remote.cancelChunkLater;
export const subscribeChunk = remote.subscribeChunk;
export const setChunkClient = remote.setChunkClient;
