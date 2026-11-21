// Build assets into the daemon bundle. Paseo evaluates it without the plugin's filesystem path.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const generated = new URL("./generated/", import.meta.url);
const cjk = await readFile(new URL("../../third-party/math/fonts/NotoSansCJKsc-Regular.otf", import.meta.url));
const sha256 = createHash("sha256").update(cjk).digest("hex");
if (sha256 !== "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b")
  throw new Error("Unexpected Noto Sans CJK SC font checksum");

const fontRoot = dirname(require.resolve("@mathjax/mathjax-newcm-font/package.json"));
const ranges = (await readdir(fontRoot + "/mjs/svg/dynamic"))
  .filter(name => name.endsWith(".js"))
  .sort();
if (ranges.length === 0) throw new Error("No MathJax SVG font ranges found");
const imports = ranges.map(name => {
  const specifier = JSON.stringify("@mathjax/mathjax-newcm-font/js/svg/dynamic/" + name);
  return `  [${specifier}, () => import(${specifier})],`;
});

await mkdir(generated, { recursive: true });
await writeFile(new URL("font-ranges.ts", generated),
  "export const fontRanges = new Map<string, () => Promise<unknown>>([\n" + imports.join("\n") + "\n]);\n");
await writeFile(new URL("cjk.ts", generated),
  "export const cjkBase64 = " + JSON.stringify(gzipSync(cjk, { level: 9 }).toString("base64")) + ";\n");
console.log("Prepared", ranges.length, "local SVG font ranges and the embedded Chinese font");
