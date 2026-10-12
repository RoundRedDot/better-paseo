import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * PNG rasters of the brand marks, read from the daemon by id.
 *
 * The host sends every plugin's client bundle again on each reconnect, and on a
 * phone behind the relay each byte of it is decrypted in JavaScript. The marks
 * are 133 KB of which a chat draws a handful, so they stay on the daemon and
 * travel only when a row draws one. `bitmaps` maps each known id asked for to
 * its `data:` URI; an unknown id is left out.
 */
export const markBitmapsRpc = defineRpc({
  // The host accepts lower-case, dotted RPC names only.
  name: "marks.bitmaps",
  input: z.object({ ids: z.array(z.string()) }),
  output: z.object({ bitmaps: z.record(z.string(), z.string()) }),
});
