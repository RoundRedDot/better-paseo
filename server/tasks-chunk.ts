/**
 * The Tasks chunk this install serves (`tasksChunkRpc`). A checkout keeps
 * null here and draws Tasks from source; `scripts/build-client.mjs --install`
 * overwrites this file in the install's directory with the chunk it built.
 * Never commit a built one.
 */
export const TASKS_CHUNK = null as { id: string; code: string } | null;
