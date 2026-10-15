/**
 * A row preview that outlives its row's remount.
 *
 * The host can draw a finished item as a new row: a thought is remounted the
 * moment it stops streaming. A preview the reader still has open would close
 * right then, though they did nothing. While it is open its row records it
 * here; a row that mounts with the same key soon after the last one let go
 * opens it again as the reader left it.
 *
 * Only that handover restores a preview: an entry let go longer ago than
 * `PREVIEW_HANDOVER_MS` is dropped, so coming back to an agent later opens
 * nothing nobody asked for. Closing the preview drops its entry at once.
 */
import type { PreviewBox } from "./preview-frame";

/** How long after a row lets go of its preview a remounted row may take it over. */
export const PREVIEW_HANDOVER_MS = 1500;

export interface PreviewMemory {
  /** Kept open after the pointer leaves: pressed, dragged, maximized or popped out. */
  pinned: boolean;
  maximized: boolean;
  placed: boolean;
  popped: boolean;
  /** The box the reader dragged or resized the panel to, if they did. */
  box: PreviewBox | null;
  /** The panel's own wrap toggle. */
  wrap: boolean | null;
  /** The body's scroll offset, and whether it was on the newest output. */
  offset: number;
  tail: boolean;
}

interface Entry extends PreviewMemory {
  /** Rows that have it open. The new row can mount before the old one goes. */
  holders: number;
  /** When the last row holding it let go; null while one does. */
  released: number | null;
}

const entries = new Map<string, Entry>();

const now = () => Date.now();

/** The preview to reopen for `key`, or null when there is none to take over. */
export function recallPreview(key: string): PreviewMemory | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.released !== null && now() - entry.released > PREVIEW_HANDOVER_MS) {
    entries.delete(key);
    return null;
  }
  return entry;
}

/** A row has `key`'s preview open. Returns its hand-back, for when it unmounts or closes. */
export function holdPreview(key: string): () => void {
  const entry = entries.get(key) ?? {
    pinned: false, maximized: false, placed: false, popped: false,
    box: null, wrap: null, offset: 0, tail: true, holders: 0, released: null,
  };
  entry.holders += 1;
  entry.released = null;
  entries.set(key, entry);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    entry.holders -= 1;
    if (entry.holders === 0 && entries.get(key) === entry) entry.released = now();
  };
}

/** Records part of the open preview's state; a key nobody opened is ignored. */
export function rememberPreview(key: string, patch: Partial<PreviewMemory>): void {
  const entry = entries.get(key);
  if (entry) Object.assign(entry, patch);
}

/** The reader closed it: nothing to reopen. */
export function forgetPreview(key: string): void {
  entries.delete(key);
}
