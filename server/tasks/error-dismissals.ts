import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { pluginDataDir } from "../plugin-data";

const schema = z.array(z.object({ agentId: z.string().min(1), error: z.string(), dismissedAt: z.number() }));
export type ErrorDismissal = z.infer<typeof schema>[number];

export function createErrorDismissals(path = join(pluginDataDir(), "tasks-error-dismissals.json")) {
  let entries: ErrorDismissal[] = [];
  let loaded: Promise<void> | null = null;
  let writes: Promise<unknown> = Promise.resolve();
  const load = () => loaded ??= (async () => {
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    entries = schema.parse(JSON.parse(content));
  })();
  return {
    async list() {
      await load();
      return entries;
    },
    dismiss(agentId: string, error: string) {
      const run = writes.then(async () => {
        await load();
        const entry = { agentId, error, dismissedAt: Date.now() };
        const next = [...entries.filter((item) => item.agentId !== agentId), entry];
        await mkdir(dirname(path), { recursive: true });
        const temp = `${path}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(next));
        await rename(temp, path);
        entries = next;
        return entry;
      });
      writes = run.catch(() => {});
      return run;
    },
  };
}
