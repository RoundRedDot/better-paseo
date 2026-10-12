/**
 * The embedded faces (Iosevka, Inter) are installed only when a reader picks
 * one: "Follow Paseo" draws with the host's own stacks and must not parse
 * 75 KB of font data or register `@font-face` rules it never uses. The bytes
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

const IOSEVKA = { monoFont: "iosevka", uiFont: "host" } as const;

describe("embedded fonts", () => {
  it("are needed on web only for an explicit Iosevka or Inter choice", () => {
    expect(needsEmbeddedFonts(DEFAULT_PREFERENCES, "web")).toBe(false);
    expect(needsEmbeddedFonts({ monoFont: "custom", uiFont: "system" }, "web")).toBe(false);
    expect(needsEmbeddedFonts({ monoFont: "iosevka", uiFont: "host" }, "web")).toBe(true);
    expect(needsEmbeddedFonts({ monoFont: "host", uiFont: "inter" }, "web")).toBe(true);
    expect(needsEmbeddedFonts({ monoFont: "iosevka", uiFont: "inter" }, "ios")).toBe(false);
    expect(needsEmbeddedFonts({ monoFont: "iosevka", uiFont: "inter" }, "android")).toBe(false);
  });

  it("are not installed for Follow Paseo, and read once from the daemon when Iosevka is picked", async () => {
    const doc = fakeDocument();
    globals.document = doc;
    const load = vi.fn(async () => EMBEDDED_FONTS);
    setEmbeddedFontLoader(load);

    ensureEmbeddedFonts(DEFAULT_PREFERENCES, "web");
    await vi.waitFor(() => Promise.resolve());
    expect(load).not.toHaveBeenCalled();
    expect(doc.elements.size).toBe(0);

    ensureEmbeddedFonts(IOSEVKA, "web");
    ensureEmbeddedFonts(IOSEVKA, "web");
    await vi.waitFor(() => expect(doc.elements.size).toBe(1));
    expect(load).toHaveBeenCalledTimes(1);
    const style = [...doc.elements.values()][0]!;
    expect(style.textContent).toContain('font-family: "OMP Iosevka"');

    removeEmbeddedFonts();
    expect(doc.elements.size).toBe(0);
  });

  it("are installed at once after a reconnect re-evaluates the bundle", async () => {
    const doc = fakeDocument();
    globals.document = doc;
    setEmbeddedFontLoader(async () => EMBEDDED_FONTS);
    ensureEmbeddedFonts(IOSEVKA, "web");
    await vi.waitFor(() => expect(doc.elements.size).toBe(1));

    // Unload, then a fresh evaluation whose loader would never answer.
    setEmbeddedFontLoader(null);
    removeEmbeddedFonts();
    const load = vi.fn(() => new Promise<never>(() => {}));
    setEmbeddedFontLoader(load);
    ensureEmbeddedFonts(IOSEVKA, "web");
    expect(doc.elements.size).toBe(1);
    expect(load).not.toHaveBeenCalled();
  });

  it("are never read on iOS or Android, and a failed read is retried later", async () => {
    globals.document = fakeDocument();
    const load = vi.fn(async (): Promise<typeof EMBEDDED_FONTS> => {
      throw new Error("offline");
    });
    setEmbeddedFontLoader(load);
    ensureEmbeddedFonts({ monoFont: "iosevka", uiFont: "inter" }, "ios");
    ensureEmbeddedFonts({ monoFont: "iosevka", uiFont: "inter" }, "android");
    expect(load).not.toHaveBeenCalled();

    ensureEmbeddedFonts(IOSEVKA, "web");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    ensureEmbeddedFonts(IOSEVKA, "web");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
});
