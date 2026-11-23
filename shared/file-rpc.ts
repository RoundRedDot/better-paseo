import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { FILE_OPEN_APPS, FILE_OPEN_EDITOR_IDS } from "./file-open-apps";

const FILE_OPEN_ERROR_KINDS = ["settings_unavailable", "settings_unsynced", "editor_unavailable", "system_opener_unavailable", "launch_failed", "launch_unconfirmed"] as const;
export type FileOpenErrorKind = (typeof FILE_OPEN_ERROR_KINDS)[number];

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
export const homeDirectoryRpc = defineRpc({
  name: "file.home",
  input: z.object({}),
  output: z.object({ home: z.string() }),
});

/** Editors this daemon host can launch. `system` is always offered by the client. */
export const installedEditorsRpc = defineRpc({
  name: "file.editors",
  input: z.object({}),
  output: z.object({
    apps: z.array(z.enum(FILE_OPEN_EDITOR_IDS)),
  }),
});

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
    errorKind: z.enum(FILE_OPEN_ERROR_KINDS).optional(),
    errorApp: z.enum(FILE_OPEN_APPS).optional(),
  }),
});
