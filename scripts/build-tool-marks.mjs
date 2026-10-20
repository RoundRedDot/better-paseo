// Rasterises assets/tool-marks/*.svg into server/mark-bitmaps.ts as `brand:<file name>`.
//
//   node scripts/build-tool-marks.mjs
//
// Needs `resvg` and ImageMagick's `magick` on PATH (dev only; `brew install resvg imagemagick`).
// The sources are drawn white on Lucide's 24 grid with the host's 1.5 stroke
// (Paseo wraps the app in `<LucideProvider strokeWidth={1.5}>`), so a mark
// sits beside the host's own icons at the same weight. A filled vendor glyph
// with no stroke to set carries `data-erode="1"`: its outline is pulled in by
// one pixel of the 96px raster, a quarter of a grid unit on each side, which
// takes its strokes from about 2 to the same 1.5. A solid vendor glyph (a
// filled disc, a face) carries `data-outline="1"` instead and is drawn as its
// own contour: the band 1.5 units wide just inside its edges, holes included.
//
// See docs/design.md for which source a new mark should come from.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sources = path.join(root, "assets", "tool-marks");
const target = path.join(root, "server", "mark-bitmaps.ts");
const SIZE = 96;
/** 1.5 grid units at 96px for a 24-unit grid. */
const OUTLINE_PX = (1.5 * SIZE) / 24;

const work = mkdtempSync(path.join(tmpdir(), "tool-marks-"));
let text = readFileSync(target, "utf8");
const built = [];
try {
  for (const file of readdirSync(sources).filter((name) => name.endsWith(".svg")).sort()) {
    const id = `brand:${file.slice(0, -4)}`;
    const svg = path.join(sources, file);
    const raw = path.join(work, "raw.png");
    const png = path.join(work, "mark.png");
    execFileSync("resvg", ["-w", String(SIZE), "-h", String(SIZE), svg, raw]);
    const source = readFileSync(svg, "utf8");
    if (source.includes('data-outline="1"')) {
      const mask = path.join(work, "mask.png");
      const inner = path.join(work, "inner.png");
      execFileSync("magick", [raw, "-alpha", "extract", mask]);
      execFileSync("magick", [mask, "-morphology", "Erode", `Disk:${OUTLINE_PX}`, inner]);
      execFileSync("magick", [mask, inner, "-compose", "minus_src", "-composite", mask]);
      execFileSync("magick", [
        "-size", `${SIZE}x${SIZE}`, "xc:white", mask, "-alpha", "off", "-compose", "copy_opacity", "-composite",
        "-strip", "-define", "png:compression-level=9", `PNG32:${png}`,
      ]);
    } else {
      const erode = source.includes('data-erode="1"');
      execFileSync("magick", [
        raw,
        ...(erode ? ["-channel", "A", "-morphology", "Erode", "Disk:1", "+channel"] : []),
        "-strip", "-define", "png:compression-level=9", `PNG32:${png}`,
      ]);
    }
    const uri = `data:image/png;base64,${readFileSync(png).toString("base64")}`;
    const entry = new RegExp(`(  "${id}":\\n    ")[^"]*(")`);
    // A new mark goes in before the file marks; client/components/marks.ts must list it too
    // (test/unit/marks.test.ts fails while the two sets differ).
    if (entry.test(text)) text = text.replace(entry, `$1${uri}$2`);
    else text = text.replace('  "mark:file":\n', `  "${id}":\n    "${uri}",\n  "mark:file":\n`);
    built.push(id);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(target, text);
console.log(`rebuilt ${built.length} marks`);
