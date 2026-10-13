import type { EmbeddedFontFace } from "../../shared/font-rpc";
import { EMBEDDED_FAMILY, type TypographyPlatform } from "../ui/tokens/typography";
import type { EnhancerPreferences } from "../preferences";

const STYLE_ELEMENT_ID = "better-paseo-fonts";

/**
 * Host faces to try if the embedded bytes ever fail to decode. These belong in
 * the `src` chain rather than in `fontFamily`, because a comma-separated
 * family list is not a valid React Native style value.
 */
const LOCAL_FALLBACKS: Record<string, readonly string[]> = {
  "OMP Inter": ["Inter", "Segoe UI", "Roboto", "Helvetica Neue"],
};
/**
 * Installs the given Inter faces.
 *
 * The plugin sandbox exposes no font loader, so on web and Electron the faces
 * are declared with `@font-face` against embedded woff2 data and the browser
 * takes it from there. React Native has no `document`, so on iOS and Android
 * this is a no-op and the font stacks fall through to the platform default —
 * embedding native assets needs a build step a directory plugin does not have.
 *
 * Injection is idempotent: a second client mounting reuses the existing style
 * element rather than parsing the font data again.
 *
 * The plugin calls it only through `ensureEmbeddedFonts`, once a reader has
 * picked a face that needs it: "Follow Paseo" draws with the host's own
 * stacks and never references an embedded family.
 */
export function embedFonts(faces: readonly EmbeddedFontFace[]): () => void {
  if (typeof document === "undefined") return () => {};
  if (document.getElementById(STYLE_ELEMENT_ID)) return () => {};

  const rules = faces.map(({ family, weight, woff2Base64 }) => {
    const sources = [
      `url(data:font/woff2;base64,${woff2Base64}) format("woff2")`,
      ...(LOCAL_FALLBACKS[family] ?? []).map((name) => `local("${name}")`),
    ].join(",\n    ");
    return `@font-face {
  font-family: "${family}";
  font-style: normal;
  font-weight: ${weight};
  font-display: block;
  src: ${sources};
}`;
  }).join("\n");

  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = rules;
  document.head.appendChild(style);

  return () => {
    style.remove();
  };
}

/**
 * Whether these preferences draw an embedded face: Inter for the interface.
 * Web only; native never loads it.
 */
export function needsEmbeddedFonts(
  preferences: Pick<EnhancerPreferences, "uiFont">,
  platform: TypographyPlatform,
): boolean {
  return platform === "web" && preferences.uiFont === "inter";
}

export type EmbeddedFontLoader = () => Promise<readonly EmbeddedFontFace[]>;

/**
 * The faces live on the daemon (`fonts.embedded`), not in the client bundle.
 * `contribute` sets the loader, since only the plugin context can call RPCs
 * outside a component.
 */
let loader: EmbeddedFontLoader | null = null;
let loading: Promise<void> | null = null;

export function setEmbeddedFontLoader(next: EmbeddedFontLoader | null): void {
  loader = next;
  loading = null;
}

/**
 * The host disposes and re-evaluates the bundle on every reconnect, which
 * drops module state. Keeping the fetched faces on the global object lets the
 * new evaluation install them at once instead of drawing a frame in the
 * fallback face while it asks the daemon again.
 */
const FACES_KEY = "__beautifulChatEmbeddedFonts";
type FacesHolder = { [FACES_KEY]?: readonly EmbeddedFontFace[] };

/** Installs the embedded faces the first time a reader's choice needs them. */
export function ensureEmbeddedFonts(
  preferences: Pick<EnhancerPreferences, "uiFont">,
  platform: TypographyPlatform,
): void {
  if (!needsEmbeddedFonts(preferences, platform) || typeof document === "undefined") return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const cached = (globalThis as FacesHolder)[FACES_KEY];
  if (cached) {
    embedFonts(cached);
    return;
  }
  if (!loader || loading) return;
  const from = loader;
  loading = Promise.resolve()
    .then(from)
    .then((faces) => {
      if (from !== loader || !faces?.length) return;
      (globalThis as FacesHolder)[FACES_KEY] = faces;
      embedFonts(faces);
    })
    .catch(() => {})
    .finally(() => {
      // A failed read may be retried by the next change of preferences or theme.
      if (from === loader) loading = null;
    });
}

/** Removes the embedded faces, if anything installed them (plugin unload). */
export function removeEmbeddedFonts(): void {
  if (typeof document === "undefined") return;
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
}

/**
 * Loads the embedded faces and reports what happened, in one line fit for the
 * surface header. Written as a probe rather than a boolean because the useful
 * information is *why* a face did not resolve: a missing style element, a
 * rejected `data:` URL, or a face that loads but is never applied.
 */
export async function probeFonts(): Promise<string> {
  if (typeof document === "undefined") return "Fonts: native, system default";
  if (!document.getElementById(STYLE_ELEMENT_ID)) {
    return "Fonts: style element missing — embedFonts did not run";
  }

  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return "Fonts: FontFaceSet unavailable on this host";

  const parts: string[] = [];
  for (const family of [EMBEDDED_FAMILY.ui]) {
    try {
      const faces = await fonts.load(`400 14px "${family}"`);
      parts.push(`${family}: ${faces.length > 0 ? "loaded" : "no match"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parts.push(`${family}: ${message.slice(0, 48)}`);
    }
  }

  // The host forces its own font over every plugin class, so report whether
  // that rule is live. Without the data-pmono escape it wins regardless of
  // what loaded.
  const hostRule = document.getElementById("paseo-ui-font") !== null;
  parts.push(`host rule ${hostRule ? "present" : "absent"}`);

  return `Fonts: ${parts.join(" · ")}`;
}
