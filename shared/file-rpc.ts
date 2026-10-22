import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Opens a path on the daemon's machine: on macOS a file in its default app
 * and a folder in Finder, while anything that would launch (an app, a script,
 * an executable) is only revealed; other platforms show it in the file manager.
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
  }),
  output: z.object({
    revealed: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
