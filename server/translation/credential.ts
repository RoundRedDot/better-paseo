import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { TRANSLATION_API_KEY_MAX_LENGTH } from "../../shared/timeline-translation";

/**
 * The translation API key, bound to the origin it was saved for. It lives in a
 * plain JSON file readable only by the daemon's user (0600) in the plugin's
 * data directory: not the Keychain, not encrypted. Nothing here logs it, and
 * the explicit reveal RPC returns it on request.
 */
export interface TranslationCredential {
  origin: string;
  apiKey: string;
}

/** Visible ASCII only: a key never needs spaces, and a line break would split the header. */
const KEY_PATTERN = /^[\x21-\x7e]+$/;

export function validApiKey(apiKey: string): boolean {
  return apiKey.length > 0 && apiKey.length <= TRANSLATION_API_KEY_MAX_LENGTH && KEY_PATTERN.test(apiKey);
}

const fileSchema = z.object({
  version: z.literal(1),
  origin: z.string().min(1),
  apiKey: z.string().refine(validApiKey),
});

export class CredentialFileError extends Error {}

export function createCredentialStore(path: string) {
  let writes: Promise<unknown> = Promise.resolve();

  async function read(): Promise<TranslationCredential | null> {
    await writes.catch(() => {});
    let content: string;
    try {
      if (process.platform !== "win32" && ((await stat(path)).mode & 0o077) !== 0) {
        // Someone widened the file's permissions: do not use a key others could read.
        throw new CredentialFileError("The translation API key file is readable by other users. Clear the key and save it again.");
      }
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof CredentialFileError) throw error;
      throw new CredentialFileError("Could not read the translation API key file.");
    }
    let parsed: z.output<typeof fileSchema>;
    try {
      parsed = fileSchema.parse(JSON.parse(content));
    } catch {
      // The parse error could quote the file, key included: say only that it is unreadable.
      throw new CredentialFileError("The translation API key file is damaged. Clear the key and save it again.");
    }
    return { origin: parsed.origin, apiKey: parsed.apiKey };
  }

  function queue<T>(work: () => Promise<T>): Promise<T> {
    const run = writes.then(work);
    writes = run.catch(() => {});
    return run;
  }

  return {
    read,
    save(credential: TranslationCredential): Promise<void> {
      return queue(async () => {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const temp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
        // Created 0600 before the key is written, so it is never readable by others.
        const handle = await open(temp, "wx", 0o600);
        try {
          try {
            await handle.writeFile(JSON.stringify({ version: 1, ...credential }));
            await handle.sync();
          } finally {
            await handle.close();
          }
          // `open`'s mode passes through the umask, which can only remove bits; set it exactly.
          await chmod(temp, 0o600);
          await rename(temp, path);
        } catch (error) {
          await rm(temp, { force: true });
          throw error;
        }
      });
    },
    clear(): Promise<void> {
      return queue(() => rm(path, { force: true }));
    },
  };
}

export type CredentialStore = ReturnType<typeof createCredentialStore>;
