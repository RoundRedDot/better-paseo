// Builds the screenshot showcase for a plugin checkout and captures every
// `#shot-*` element headless, once per theme, so two checkouts can be compared
// pixel for pixel.
//   node .showcase/tools/shots.mjs <pluginDir> <outDir> [dark|light ...]
// Writes <outDir>/<theme>/shot-*.png in en-US, or
// <outDir>/<locale>/<theme>/shot-*.png in another locale (default: both themes).
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
const locale = process.env.SHOT_LOCALE ?? "en-US";
const only = new Set((process.env.SHOT_ONLY ?? "").split(",").filter(Boolean));
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
  locale,
  reducedMotion: "reduce",
});
const HOVER = {
  "shot-hero-devices": { text: "L150\u2013157", preferences: { previewLineNumbers: true } },
};
const INTERACTIONS = {
  "shot-checklist-window": async (scene) => {
    await scene.getByLabel("Open tasks in a window").click();
    const panel = page.getByTestId("hover-preview").last();
    await panel.waitFor();
    await page.waitForTimeout(250);
    const toolbar = panel.getByTestId("hover-preview-toolbar");
    const toolbarBox = await toolbar.boundingBox();
    if (!toolbarBox) {
      const state = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="hover-preview"]')).map((panel) => ({
        rect: panel.getBoundingClientRect().toJSON(), display: getComputedStyle(panel).display,
        visibility: getComputedStyle(panel).visibility, popover: panel.matches(":popover-open"),
        parent: panel.parentElement?.tagName,
        descendants: Array.from(panel.querySelectorAll("[data-testid]")).map((child) => ({ id: child.getAttribute("data-testid"), rect: child.getBoundingClientRect().toJSON() })),
      })));
      throw new Error(`checklist preview toolbar is not on screen: ${JSON.stringify(state)}`);
    }
    await drag(toolbarBox.x + toolbarBox.width * 0.62, toolbarBox.y + toolbarBox.height / 2, 48, 24);
    const panelBox = await panel.boundingBox();
    if (panelBox) await drag(panelBox.x + panelBox.width - 2, panelBox.y + panelBox.height / 2, 44, 0);
  },
  "shot-markdown-preview-window": async (scene) => {
    await scene.getByLabel("Open Markdown in a window").first().click();
    const panel = page.getByTestId("hover-preview").last();
    await panel.getByLabel("Show raw text").waitFor();
    await panel.getByLabel("Show raw text").click();
    await panel.getByLabel("Render Markdown").waitFor();
    await page.waitForTimeout(250);
  },
  "shot-table-copy-menu": async (scene) => {
    await scene.getByTestId("table-native-copy-slot").hover();
    await scene.getByText("Copy as image", { exact: true }).waitFor();
  },
  "shot-table-selection": async (scene) => {
    await scene.getByTestId("markdown-table-cell").nth(4).dblclick();
    await page.getByLabel("Copy selected cell").waitFor();
  },
  "shot-selection-actions": async (scene) => {
    const text = scene.getByText("Selecting text in a card shows Copy and Add to chat.");
    await text.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.waitForFunction(() => Boolean(document.querySelector("[data-bcselectionbar]")?.shadowRoot?.querySelector(".bar.shown")));
  },
};

async function drag(x, y, dx, dy) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 4; step += 1) {
    await page.mouse.move(x + dx * step / 4, y + dy * step / 4);
  }
  await page.mouse.up();
}

async function isolate(scene) {
  await scene.evaluate((target) => {
    const root = document.querySelector("[data-showcase-scenes]");
    if (!root) return;
    const background = getComputedStyle(target).backgroundColor;
    for (const element of [document.documentElement, document.body, root]) {
      element.dataset.showcasePreviousBackground = element.style.backgroundColor || "__empty__";
      element.style.backgroundColor = background;
    }
    let top = target;
    while (top.parentElement && top.parentElement !== root) top = top.parentElement;
    for (const child of Array.from(root.children)) {
      if (child !== top && child instanceof HTMLElement) {
        child.dataset.showcasePreviousDisplay = child.style.display || "__empty__";
        child.style.display = "none";
      }
    }
  });
  await scene.scrollIntoViewIfNeeded();
}

async function restoreIsolation() {
  await page.evaluate(() => {
    const root = document.querySelector("[data-showcase-scenes]");
    if (!root) return;
    for (const child of Array.from(root.children)) {
      if (!(child instanceof HTMLElement) || !child.dataset.showcasePreviousDisplay) continue;
      child.style.display = child.dataset.showcasePreviousDisplay === "__empty__" ? "" : child.dataset.showcasePreviousDisplay;
      delete child.dataset.showcasePreviousDisplay;
    }
    for (const element of [document.documentElement, document.body, root]) {
      if (!element.dataset.showcasePreviousBackground) continue;
      element.style.backgroundColor = element.dataset.showcasePreviousBackground === "__empty__" ? "" : element.dataset.showcasePreviousBackground;
      delete element.dataset.showcasePreviousBackground;
    }
  });
}

async function captureLayer(scene, destination) {
  const boxes = [];
  const sceneBox = await scene.boundingBox();
  if (sceneBox) boxes.push(sceneBox);
  const panelBoxes = await page.getByTestId("hover-preview").evaluateAll((panels) =>
    panels.map((panel) => panel.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })),
  );
  boxes.push(...panelBoxes);
  const barBox = await page.evaluate(() => {
    const bar = document.querySelector("[data-bcselectionbar]")?.shadowRoot?.querySelector(".bar.shown");
    if (!bar) return null;
    const rect = bar.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  if (barBox) boxes.push(barBox);
  const viewport = page.viewportSize();
  if (!viewport || boxes.length === 0) throw new Error("no visible area to capture");
  const x = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.x))));
  const y = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.y))));
  const right = Math.min(viewport.width, Math.ceil(Math.max(...boxes.map((box) => box.x + box.width))));
  const bottom = Math.min(viewport.height, Math.ceil(Math.max(...boxes.map((box) => box.y + box.height))));
  await page.screenshot({ path: destination, clip: { x, y, width: right - x, height: bottom - y }, animations: "disabled" });
}

let ids = [];
for (const theme of themes) {
  const themeDir = locale === "en-US" ? path.join(out, theme) : path.join(out, locale, theme);
  mkdirSync(themeDir, { recursive: true });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?theme=${theme}`);
  await page.waitForTimeout(1500);
  const allIds = await page.$$eval("[id^=shot-]", (els) => els.map((el) => el.id));
  ids = only.size > 0 ? allIds.filter((id) => only.has(id)) : allIds;
  for (const id of ids) {
    await restoreIsolation();
    console.log(`Capturing ${id} (${theme}, ${locale})`);
    const scene = page.locator(`#${id}`);
    const interaction = INTERACTIONS[id];
    if (interaction) {
      await isolate(scene);
      await interaction(scene);
      await captureLayer(scene, path.join(themeDir, `${id}.png`));
      // A clicked toolbar may leave a top-layer popover; remount before the next shot.
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?theme=${theme}`);
      await page.waitForTimeout(1500);
      continue;
    }
    if (id === "shot-settings-block-size") {
      await scene.evaluate((scroller) => {
        const label = /zh/i.test(navigator.language) ? "块字号" : "Block text size";
        const title = Array.from(scroller.querySelectorAll("*")).find((node) =>
          node.children.length === 0 && node.textContent?.trim() === label,
        );
        if (!title) throw new Error(`settings row not found: ${label}`);
        const rowTop = title.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        scroller.scrollTop = rowTop - 120;
      });
      await page.waitForTimeout(250);
    }
    // The hero rests a real pointer on a collapsed row, so its hover state and
    // preview panel are captured as a reader would see them.
    const hover = HOVER[id];
    if (hover) {
      await page.evaluate((p) => globalThis.setShowcasePreferences(p), hover.preferences);
      await page.locator(`#${id}`).getByText(hover.text, { exact: true }).first().hover();
      await page.waitForTimeout(2000);
    }
    await scene.screenshot({ path: path.join(themeDir, `${id}.png`), animations: "disabled" });
    if (hover) {
      await page.mouse.move(0, 0);
      const off = Object.fromEntries(Object.keys(hover.preferences).map((key) => [key, false]));
      await page.evaluate((p) => globalThis.setShowcasePreferences(p), off);
    }
  }
}
console.log(`${ids.length} shots x ${themes.join("+")} locale=${locale} -> ${out}`);
await browser.close();
server.close();
