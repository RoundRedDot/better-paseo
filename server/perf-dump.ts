import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PERF_DUMP_DIR = "/tmp/bc-perf";

/** File-name safe: the label and platform come from a client, not from us. */
function safeSegment(value: string, fallback: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 64) || fallback;
}

export interface PerfDumpInput {
  label: string;
  platform: string;
  data: Record<string, unknown>;
}

/**
 * Writes one dump to `<dir>/<platform>-<label>-<timestamp>.json` and returns
 * the path. The timestamp is injectable so the name is testable.
 */
export async function writePerfDump(
  input: PerfDumpInput,
  options: { dir?: string; now?: Date } = {},
): Promise<string> {
  const dir = options.dir ?? PERF_DUMP_DIR;
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const name = `${safeSegment(input.platform, "unknown")}-${safeSegment(input.label, "dump")}-${stamp}.json`;
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, JSON.stringify(input.data, null, 2));
  return path;
}
