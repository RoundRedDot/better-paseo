// Verify the published files and real browser media selection for both READMEs.
// node --test .showcase/tools/readme-shots.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import http from "node:http";
import { chromium } from "playwright-core";

const repo = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(join(repo, "docs/images/screenshots.json")));
const published = new Map(manifest.assets.map(asset => [asset.path, asset]));
const readmes = ["README.md", "README-zh.md"].map(file => ({
  file, text: readFileSync(join(repo, file), "utf8"),
}));

test("every README screenshot has matching, verified light and dark assets", () => {
  assert.equal(manifest.assets.length, 52);
  assert.equal(published.size, 52);
  assert.equal(manifest.defaultTheme, "light");
  const referenced = new Set();
  for (const { file, text } of readmes) {
    assert.doesNotMatch(text, /!\[[^\]]*\]\([^)]*\.png\)/, file);
    const pictures = [...text.matchAll(/<picture>[\s\S]*?<\/picture>/g)];
    assert.equal(pictures.length, 24, file);
    for (const [picture] of pictures) {
      assert.match(picture, /media="\(prefers-color-scheme: dark\)"/);
      const dark = picture.match(/srcset="([^"]+)"/)?.[1];
      const light = picture.match(/\bsrc="([^"]+)"/)?.[1];
      assert.ok(light?.endsWith("-light.png"), picture);
      assert.equal(dark, light.replace(/-light\.png$/, "-dark.png"));
      for (const path of [light, dark]) {
        assert.ok(published.has(path), path);
        referenced.add(path);
      }
      const a = published.get(light), b = published.get(dark);
      assert.equal(a.width, b.width, light);
      assert.equal(a.height, b.height, light);
      assert.notEqual(a.sha256, b.sha256, light);
    }
  }
  assert.equal(referenced.size, 52);
  for (const asset of manifest.assets) {
    const bytes = readFileSync(join(repo, asset.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.path);
    assert.equal(bytes.readUInt32BE(16), asset.width);
    assert.equal(bytes.readUInt32BE(20), asset.height);
  }
});

test("both READMEs load light images and switch to dark without reloading", async () => {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname.slice(1);
    if (!published.has(path)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "image/png");
    res.end(readFileSync(join(repo, path)));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath:
      process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
    const page = await browser.newPage({ colorScheme: "light" });
    for (const { file, text } of readmes) {
      const pictures = [...text.matchAll(/<picture>[\s\S]*?<\/picture>/g)].map(([html]) => html);
      await page.emulateMedia({ colorScheme: "light" });
      await page.setContent(`<base href="http://127.0.0.1:${server.address().port}/">${pictures.join("\n")}`);
      for (const theme of ["light", "dark", "light"]) {
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction(theme => [...document.images].every(img =>
          img.complete && img.naturalWidth > 0 && img.currentSrc.endsWith(`-${theme}.png`)), theme);
        assert.equal(await page.locator("picture img").count(), 24, `${file}: ${theme}`);
      }
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
