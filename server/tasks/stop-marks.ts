import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { pluginDataDir } from "../plugin-data";

/** A file-name safe agent ID, the same rule `tasks.stop` applies. */
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
/** The marks kept; the oldest go first. */
export const STOPS_KEPT = 500;
/** A mark this old is dropped: the card it labels has long left the board. */
export const STOP_MARK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const fileSchema = z.object({
  stops: z.array(z.object({ agentId: z.string(), stoppedAt: z.string() })),
});

export type StopMark = { agentId: string; stoppedAt: string };

export function stopMarksPath(): string {
  return join(pluginDataDir(), "tasks-stops.json");
}

/**
 * The agents stopped through `tasks.stop`, with when, oldest first. Kept in
 * memory and mirrored to one JSON file, so a daemon restart or a plugin
 * reload keeps them. The file is read once; it is written (atomically, one
 * write at a time) only when a mark is added or cleared. A missing or
 * corrupt file reads as no marks.
 */
export function createStopMarks(path: string, now: () => number = Date.now) {
  const marks = new Map<string, string>();
  let loaded: Promise<void> | null = null;
  let writes: Promise<unknown> = Promise.resolve();

  const prune = () => {
    const oldest = now() - STOP_MARK_MAX_AGE_MS;
    for (const [agentId, stoppedAt] of marks) {
      if (!(Date.parse(stoppedAt) > oldest)) marks.delete(agentId);
    }
    while (marks.size > STOPS_KEPT) marks.delete(marks.keys().next().value as string);
  };

  const load = () => {
    loaded ??= (async () => {
      try {
        const parsed = fileSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
        if (!parsed.success) return;
        for (const stop of parsed.data.stops) {
          // Entries are written oldest first; a repeat keeps the later place.
          if (AGENT_ID_PATTERN.test(stop.agentId) && Number.isFinite(Date.parse(stop.stoppedAt))) {
            marks.delete(stop.agentId);
            marks.set(stop.agentId, stop.stoppedAt);
          }
        }
      } catch {
        // No file yet, or one we cannot read: start empty.
      }
      prune();
    })();
    return loaded;
  };

  const persist = () => {
    const run = writes.then(async () => {
      try {
        const temp = `${path}.${process.pid}.tmp`;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, JSON.stringify({ stops: [...marks].map(([agentId, stoppedAt]) => ({ agentId, stoppedAt })) }));
        await rename(temp, path);
      } catch {
        // A mark that misses the disk is still held in memory.
      }
    });
    writes = run;
    return run;
  };

  return {
    async list(): Promise<StopMark[]> {
      await load();
      prune();
      return [...marks].map(([agentId, stoppedAt]) => ({ agentId, stoppedAt }));
    },
    async mark(agentId: string): Promise<void> {
      await load();
      marks.delete(agentId);
      marks.set(agentId, new Date(now()).toISOString());
      prune();
      await persist();
    },
    /** The agent ran again, or is gone: forget its mark, writing only if it had one. */
    async clear(agentId: string): Promise<void> {
      await load();
      if (marks.delete(agentId)) await persist();
    },
  };
}
