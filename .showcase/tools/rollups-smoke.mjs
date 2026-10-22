// Offline geometry + real-card smoke. Does not connect to a daemon or install a plugin.
// npm ci --prefix .showcase && node .showcase/tools/rollups-smoke.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const show = path.join(root, ".showcase");
const out = path.join(show, "out/rollups");
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [path.join(show, "showcase.tsx")], outfile: path.join(show, "showcase.js"),
  absWorkingDir: root, bundle: true, jsx: "automatic", format: "iife",
  define: { global: "globalThis", "process.env.NODE_ENV": '"production"', __DEV__: "false" },
  alias: {
    "react-native": path.join(show, "node_modules/react-native-web"),
    "@getpaseo/plugin/client/react-native": path.join(show, "shims/plugin-react-native.tsx"),
    "@getpaseo/plugin/client": path.join(show, "shims/plugin-client.tsx"),
    "@getpaseo/plugin/client/ui": path.join(show, "shims/plugin-ui.tsx"),
  }, logLevel: "warning",
});
const server = http.createServer((req, res) => {
  const file = path.basename(new URL(req.url, "http://localhost").pathname) || "index.html";
  try {
    res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : "text/html");
    res.end(readFileSync(path.join(show, file)));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  for (const theme of ["dark", "light"]) for (const compact of [false, true]) {
    const page = await browser.newPage({ viewport: { width: compact ? 440 : 1200, height: 1100 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?theme=${theme}${compact ? "&layout=compact" : ""}`);
    const scene = page.locator("#shot-s7-rollups");
    await scene.waitFor();
    // Hide other showcase scenes only in this test page, keeping it small for captures.
    await scene.evaluate((element, compact) => {
      for (const sibling of element.parentElement.children) if (sibling !== element) sibling.style.display = "none";
      element.style.boxSizing = "border-box";
      element.style.width = compact ? "440px" : "940px";
    }, compact);
    const summary = scene.getByRole("button", { name: "Called 7 tools · 1 running · 1 failed", exact: true });
    await summary.waitFor();
    assert.equal(await summary.getAttribute("aria-expanded"), "false");
    const heights = await scene.locator('[data-testid^="rollup-source-"]').evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    assert.equal(heights.length, 7);
    assert.deepEqual(heights.slice(1), [0, 0, 0, 0, 0, 0], "collapsed source wrappers must leave no blank gaps");
    const stem = `${theme}-${compact ? "compact" : "desktop"}`;
    await scene.screenshot({ path: path.join(out, `${stem}-collapsed.png`) });
    await summary.click();
    assert.equal(await summary.getAttribute("aria-expanded"), "true");
    assert.equal(await scene.locator('[data-testid^="rollup-source-"]').evaluateAll((rows) =>
      rows.filter((row) => row.getBoundingClientRect().height > 0).length), 7);
    assert.ok(await scene.getByRole("button").count() > 1, "existing rich card controls are mounted");
    await scene.getByText("npm run check:hermes", { exact: true }).first().waitFor();
    await scene.screenshot({ path: path.join(out, `${stem}-expanded.png`) });
    await summary.click();
    assert.equal(await summary.getAttribute("aria-expanded"), "false");
    await scene.getByTestId("rollup-next-update").waitFor();
    assert.equal(await scene.getByText("npm run check:hermes", { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${stem}: hidden wrapper heights=${heights.slice(1).join(",")}; expansion reveals every card; running/failure counts stay visible`);
    await page.close();
  }
  console.log(`Screenshots: ${out}`);
} finally {
  await browser?.close();
  server.close();
}
