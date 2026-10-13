// Builds the screenshot showcase for a plugin checkout and captures every
// `#shot-*` element headless, once per theme, so two checkouts can be compared
// pixel for pixel.
//   node .showcase/tools/shots.mjs <pluginDir> <outDir> [dark|light ...]
// Writes <outDir>/<theme>/shot-*.png (default: both themes).
// <pluginDir>/.showcase/node_modules must resolve (symlink it for old checkouts).
import { build } from "esbuild";
import { chromium } from "playwright-core";
import http from "node:http";
import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";

const dir = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
const themes = process.argv.slice(4).length > 0 ? process.argv.slice(4) : ["dark", "light"];
const show = path.join(dir, ".showcase");
const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(show, "showcase.tsx")],
  outfile: path.join(show, "showcase.js"),
  absWorkingDir: dir,
  bundle: true,
  jsx: "automatic",
  format: "iife",
  define: { global: "globalThis", "process.env.NODE_ENV": '"production"', __DEV__: "false" },
  alias: {
    "react-native": path.join(show, "node_modules/react-native-web"),
    "@getpaseo/plugin/client/react-native": path.join(show, "shims/plugin-react-native.tsx"),
    "@getpaseo/plugin/client": path.join(show, "shims/plugin-client.tsx"),
  },
  logLevel: "warning",
});

const server = http.createServer((req, res) => {
  const name = path.basename(new URL(req.url, "http://x").pathname) || "index.html";
  try {
    res.setHeader("content-type", name.endsWith(".js") ? "text/javascript" : "text/html");
    res.end(readFileSync(path.join(show, name === "" ? "index.html" : name)));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  // Headless reports `(hover: none)`; a desktop mouse turns the hover previews on.
  args: ["--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4"],
});
// Reduced motion rather than a frozen rAF: the plugin's motion honours it, so
// running dots rest on a static frame and an expanded body is drawn at full
// opacity instead of on the first frame of its fade.
const page = await browser.newPage({ viewport: { width: 1900, height: 1400 },
  deviceScaleFactor: Number(process.env.SHOT_SCALE ?? 1),
  reducedMotion: "reduce",
});
const HOVER = {
  "shot-hero-devices": { text: "L150\u2013157", preferences: { previewLineNumbers: true } },
};
let ids = [];
for (const theme of themes) {
  const themeDir = path.join(out, theme);
  mkdirSync(themeDir, { recursive: true });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?theme=${theme}`);
  await page.waitForTimeout(1500);
  ids = await page.$$eval("[id^=shot-]", (els) => els.map((el) => el.id));
  for (const id of ids) {
    // The hero rests a real pointer on a collapsed row, so its hover state and
    // preview panel are captured as a reader would see them.
    const hover = HOVER[id];
    if (hover) {
      await page.evaluate((p) => globalThis.setShowcasePreferences(p), hover.preferences);
      await page.locator(`#${id}`).getByText(hover.text, { exact: true }).first().hover();
      await page.waitForTimeout(2000);
    }
    await page.locator(`#${id}`).screenshot({ path: path.join(themeDir, `${id}.png`), animations: "disabled" });
    if (hover) {
      await page.mouse.move(0, 0);
      const off = Object.fromEntries(Object.keys(hover.preferences).map((key) => [key, false]));
      await page.evaluate((p) => globalThis.setShowcasePreferences(p), off);
    }
  }
}
console.log(`${ids.length} shots x ${themes.join("+")} -> ${out}`);
await browser.close();
server.close();
