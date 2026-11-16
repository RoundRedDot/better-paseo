import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { FILE_OPEN_APPS } from "./preferences-settings";

/**
 * Opens a file with the configured editor on the daemon's machine. The system
 * option opens it in its default app on macOS and reveals it on other platforms.
 * Directories and paths that would launch retain the platform's reveal behavior.
 *
 * The client cannot reach the operating system, and Paseo exposes no file
 * navigation to plugins, so the daemon side does the work: it resolves the
 * path against the agent's working directory and asks the platform shell
 * (`server/open-path.ts`). The name stays `file.reveal` for older clients.
 */
export const revealPathRpc = defineRpc({
  // The host accepts lower-case, dotted RPC names only.
  name: "file.reveal",
  input: z.object({
    cwd: z.string(),
    path: z.string(),
    expectedApp: z.enum(FILE_OPEN_APPS).optional(),
  }),
  output: z.object({
    revealed: z.string().nullable(),
    error: z.string().nullable(),
    errorKind: z.enum(["settings_unavailable", "settings_unsynced", "editor_unavailable", "launch_failed", "launch_unconfirmed"]).optional(),
    errorApp: z.enum(FILE_OPEN_APPS).optional(),
  }),
});
