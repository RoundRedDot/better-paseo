// Rasterises assets/editor-marks/*.svg into server/mark-bitmaps.ts as `editor:<file name>`.
//
//   node scripts/build-editor-marks.mjs
//
// Needs `resvg` and ImageMagick's `magick` on PATH. These are the file-open
// choices' colour logos. Unlike assets/tool-marks, the vendor colours stay:
// nothing is flattened to white or tinted at render time.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sources = path.join(root, "assets", "editor-marks");
const target = path.join(root, "server", "mark-bitmaps.ts");
const SIZE = 96;

const work = mkdtempSync(path.join(tmpdir(), "editor-marks-"));
let text = readFileSync(target, "utf8");
const built = [];
try {
  for (const file of readdirSync(sources).filter((name) => name.endsWith(".svg")).sort()) {
    const id = `editor:${file.slice(0, -4)}`;
    const svg = path.join(sources, file);
    const raw = path.join(work, `${file}.png`);
    const png = path.join(work, `${file}.out.png`);
    execFileSync("resvg", ["-w", String(SIZE), "-h", String(SIZE), svg, raw]);
    execFileSync("magick", [raw, "-strip", "-define", "png:compression-level=9", `PNG32:${png}`]);
    const uri = `data:image/png;base64,${readFileSync(png).toString("base64")}`;
    const entry = new RegExp(`(  "${id}":\\n    ")[^"]*(")`);
    if (entry.test(text)) text = text.replace(entry, `$1${uri}$2`);
    else text = text.replace('  "mark:file":\n', `  "${id}":\n    "${uri}",\n  "mark:file":\n`);
    built.push(id);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(target, text);
console.log(`rebuilt ${built.join(", ")}`);
