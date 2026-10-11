/**
 * The embedded faces (Iosevka, Inter) are installed only when a reader picks
 * one: "Follow Paseo" draws with the host's own stacks and must not parse
 * 75 KB of font data or register `@font-face` rules it never uses.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureEmbeddedFonts,
  needsEmbeddedFonts,
  removeEmbeddedFonts,
} from "../../client/components/embed-fonts";
import { DEFAULT_PREFERENCES } from "../../client/preferences";

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

const globals = globalThis as { document?: unknown };

afterEach(() => {
  delete globals.document;
});

describe("embedded fonts", () => {
  it("are needed on web only for an explicit Iosevka or Inter choice", () => {
    expect(needsEmbeddedFonts(DEFAULT_PREFERENCES, "web")).toBe(false);
    expect(needsEmbeddedFonts({ monoFont: "custom", uiFont: "system" }, "web")).toBe(false);
    expect(needsEmbeddedFonts({ monoFont: "iosevka", uiFont: "host" }, "web")).toBe(true);
    expect(needsEmbeddedFonts({ monoFont: "host", uiFont: "inter" }, "web")).toBe(true);
    expect(needsEmbeddedFonts({ monoFont: "iosevka", uiFont: "inter" }, "ios")).toBe(false);
    expect(needsEmbeddedFonts({ monoFont: "iosevka", uiFont: "inter" }, "android")).toBe(false);
  });

  it("are not installed for Follow Paseo, and installed once when Iosevka is picked", () => {
    const doc = fakeDocument();
    globals.document = doc;
    ensureEmbeddedFonts(DEFAULT_PREFERENCES, "web");
    expect(doc.elements.size).toBe(0);

    ensureEmbeddedFonts({ monoFont: "iosevka", uiFont: "host" }, "web");
    ensureEmbeddedFonts({ monoFont: "iosevka", uiFont: "host" }, "web");
    expect(doc.elements.size).toBe(1);
    const style = [...doc.elements.values()][0]!;
    expect(style.textContent).toContain('font-family: "OMP Iosevka"');

    removeEmbeddedFonts();
    expect(doc.elements.size).toBe(0);
  });
});
