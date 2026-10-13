/**
 * The embedded Inter faces are installed only when a reader picks Inter:
 * "Follow Paseo" draws with the host's own stacks and must not parse
 * 65 KB of font data or register `@font-face` rules it never uses. The bytes
 * live on the daemon, so the client bundle a phone downloads on every
 * reconnect does not carry them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureEmbeddedFonts,
  needsEmbeddedFonts,
  removeEmbeddedFonts,
  setEmbeddedFontLoader,
} from "../../client/components/embed-fonts";
import { DEFAULT_PREFERENCES } from "../../client/preferences";
import { EMBEDDED_FONTS } from "../../server/font-data";

/** Just enough of `document` for the style element bookkeeping. */
function fakeDocument() {
  const elements = new Map<string, { id: string; textContent: string; remove(): void }>();
  return {
    elements,
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => {
      const element = {
        id: "",
        textContent: "",
        remove() {
          elements.delete(element.id);
        },
      };
      return element;
    },
    head: {
      appendChild(element: { id: string; textContent: string; remove(): void }) {
        elements.set(element.id, element);
      },
    },
  };
}

const globals = globalThis as { document?: unknown; __beautifulChatEmbeddedFonts?: unknown };

afterEach(() => {
  setEmbeddedFontLoader(null);
  delete globals.document;
  delete globals.__beautifulChatEmbeddedFonts;
});

const INTER = { uiFont: "inter" } as const;

describe("embedded fonts", () => {
  it("are needed on web only for an explicit Inter choice", () => {
    expect(needsEmbeddedFonts(DEFAULT_PREFERENCES, "web")).toBe(false);
    expect(needsEmbeddedFonts({ uiFont: "system" }, "web")).toBe(false);
    expect(needsEmbeddedFonts(INTER, "web")).toBe(true);
    expect(needsEmbeddedFonts(INTER, "ios")).toBe(false);
    expect(needsEmbeddedFonts(INTER, "android")).toBe(false);
  });

  it("carry Inter only", () => {
    expect(new Set(EMBEDDED_FONTS.map((face) => face.family))).toEqual(new Set(["OMP Inter"]));
  });

  it("are not installed for Follow Paseo, and read once from the daemon when Inter is picked", async () => {
    const doc = fakeDocument();
    globals.document = doc;
    const load = vi.fn(async () => EMBEDDED_FONTS);
    setEmbeddedFontLoader(load);

    ensureEmbeddedFonts(DEFAULT_PREFERENCES, "web");
    await vi.waitFor(() => Promise.resolve());
    expect(load).not.toHaveBeenCalled();
    expect(doc.elements.size).toBe(0);

    ensureEmbeddedFonts(INTER, "web");
    ensureEmbeddedFonts(INTER, "web");
    await vi.waitFor(() => expect(doc.elements.size).toBe(1));
    expect(load).toHaveBeenCalledTimes(1);
    const style = [...doc.elements.values()][0]!;
    expect(style.textContent).toContain('font-family: "OMP Inter"');

    removeEmbeddedFonts();
    expect(doc.elements.size).toBe(0);
  });

  it("are installed at once after a reconnect re-evaluates the bundle", async () => {
    const doc = fakeDocument();
    globals.document = doc;
    setEmbeddedFontLoader(async () => EMBEDDED_FONTS);
    ensureEmbeddedFonts(INTER, "web");
    await vi.waitFor(() => expect(doc.elements.size).toBe(1));

    // Unload, then a fresh evaluation whose loader would never answer.
    setEmbeddedFontLoader(null);
    removeEmbeddedFonts();
    const load = vi.fn(() => new Promise<never>(() => {}));
    setEmbeddedFontLoader(load);
    ensureEmbeddedFonts(INTER, "web");
    expect(doc.elements.size).toBe(1);
    expect(load).not.toHaveBeenCalled();
  });

  it("are never read on iOS or Android, and a failed read is retried later", async () => {
    globals.document = fakeDocument();
    const load = vi.fn(async (): Promise<typeof EMBEDDED_FONTS> => {
      throw new Error("offline");
    });
    setEmbeddedFontLoader(load);
    ensureEmbeddedFonts(INTER, "ios");
    ensureEmbeddedFonts(INTER, "android");
    expect(load).not.toHaveBeenCalled();

    ensureEmbeddedFonts(INTER, "web");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    ensureEmbeddedFonts(INTER, "web");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
});
