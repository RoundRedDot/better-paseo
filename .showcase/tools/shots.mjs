// Builds the screenshot showcase for a plugin checkout and captures every
// `#shot-*` element headless, so two checkouts can be compared pixel for pixel.
//   node .showcase/tools/shots.mjs <pluginDir> <outDir>
// <pluginDir>/.showcase/node_modules must resolve (symlink it for old checkouts).
import { build } from "esbuild";
import { chromium } from "playwright-core";
import http from "node:http";
import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";

const dir = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
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
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
// Freeze rAF so looping animations rest on their first frame; otherwise two
// captures of the same build differ in a pulsing dot.
await page.addInitScript(() => {
  window.requestAnimationFrame = () => 0;
});
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForTimeout(1500);
const ids = await page.$$eval("[id^=shot-]", (els) => els.map((el) => el.id));
for (const id of ids) {
  await page.locator(`#${id}`).screenshot({ path: path.join(out, `${id}.png`), animations: "disabled" });
}
console.log(`${ids.length} shots -> ${out}`);
await browser.close();
server.close();
