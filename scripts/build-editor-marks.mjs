// Rasterises colour marks into server/mark-bitmaps.ts:
//   assets/editor-marks/*.{svg,png}  as `editor:<file name>`  (file-open choices)
//   assets/service-marks/*.{svg,png} as `service:<file name>` (free translation services)
// An editor .png source is the editor's own macOS app icon, taken from its
// official app bundle; a .svg source is drawn for marks that have no app icon.
// Service marks are the translator product icons (Google Translate, Microsoft
// logo, Tencent TranSmart site icon).
//
//   node scripts/build-editor-marks.mjs
//
// Needs `resvg`, ImageMagick's `magick` and `oxipng` on PATH. These are the file-open
// choices' colour logos. Unlike assets/tool-marks, the vendor colours stay:
// nothing is flattened to white or tinted at render time.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SOURCES = [
  { dir: path.join(root, "assets", "editor-marks"), prefix: "editor" },
  { dir: path.join(root, "assets", "service-marks"), prefix: "service" },
];
const target = path.join(root, "server", "mark-bitmaps.ts");
// The menu draws a mark at 20pt (LOGO in client/settings-file-open.tsx); 60px covers a three-times display.
// Service marks sit in a settings segment at 16pt, which 60px covers too.
const SIZE = 60;

const work = mkdtempSync(path.join(tmpdir(), "editor-marks-"));
let text = readFileSync(target, "utf8");
const built = [];
try {
  for (const { dir, prefix } of SOURCES) for (const file of readdirSync(dir).filter((name) => /\.(svg|png)$/.test(name)).sort()) {
    const id = `${prefix}:${file.slice(0, -4)}`;
    const source = path.join(dir, file);
    let raw = source;
    const png = path.join(work, `${file}.out.png`);
    if (file.endsWith(".svg")) {
      raw = path.join(work, `${file}.png`);
      execFileSync("resvg", ["-w", String(SIZE), "-h", String(SIZE), source, raw]);
    }
    execFileSync("magick", [raw, "-resize", `${SIZE}x${SIZE}`, "-strip", "-define", "png:compression-level=9", `PNG32:${png}`]);
    execFileSync("oxipng", ["-q", "-o", "max", "--strip", "all", png]);
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
