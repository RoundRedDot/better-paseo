import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const embeddedFontFace = z.object({
  family: z.string(),
  weight: z.string(),
  woff2Base64: z.string(),
});

export type EmbeddedFontFace = z.infer<typeof embeddedFontFace>;

/**
 * The embedded Inter faces, read from the daemon.
 *
 * The host sends every plugin's client bundle again on each reconnect, and on a
 * phone behind the relay each byte of it is decrypted in JavaScript. The faces
 * are 65 KB that only a web reader who picks Inter ever draws, so they stay on
 * the daemon and travel only when one does.
 */
export const embeddedFontsRpc = defineRpc({
  // The host accepts lower-case, dotted RPC names only.
  name: "fonts.embedded",
  input: z.object({}),
  output: z.object({ faces: z.array(embeddedFontFace) }),
});
