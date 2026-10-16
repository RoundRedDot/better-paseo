// Real layout and pointer regression for footer spacing and interactive details.
// Run from the repository root: node .showcase/tools/check-footer-hover.mjs
import { build } from "esbuild";
import { chromium } from "playwright-core";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "../..");
const show = path.join(root, ".showcase");
const out = mkdtempSync(path.join(tmpdir(), "footer-hover-"));
let browser;
let server;

async function checkSpacing(page) {
  const items = await page.getByTestId("footer-toolbar").evaluate((toolbar) =>
    [...toolbar.querySelectorAll('[role="button"], [role="img"]')].map((button) => {
      const icon = button.children[0].getBoundingClientRect();
      const text = button.children[1].getBoundingClientRect();
      return { left: icon.left, top: icon.top, iconWidth: icon.width,
        gap: text.left - icon.right, right: text.right };
    }));
  assert.equal(items.length, 4);
  for (const [index, item] of items.entries()) {
    assert.equal(item.iconWidth, 14);
    assert.equal(item.gap, 4, "icon-to-text spacing");
    const previous = items[index - 1];
    if (previous && previous.top === item.top) {
      assert.equal(item.left - previous.right, 8, "spacing between visible items");
    } else {
      assert.equal(item.left, items[0].left, "wrapped rows align with the text column");
    }
  }
}

try {
  await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "${show}/node_modules/react-dom/client.js";
      import { AssistantFooter } from "${root}/client/components/turn-footer";
      import { buildThemeTokens } from "${root}/client/components/theme-tokens";
      const tokens = buildThemeTokens({surface0:"#fff", surface1:"#eee", surface2:"#ddd", border:"#ccc",
        foreground:"#111", foregroundMuted:"#666", accent:"#00f", accentForeground:"#fff",
        statusSuccess:"#198754", statusWarning:"#a36a00", statusDanger:"#d92d20"});
      createRoot(document.getElementById("root")).render(
        <div style={{ marginLeft: 80, marginTop: location.search.includes("below") ? 20 : 500,
          position: "relative", isolation: "isolate" }}>
          <div style={{ position: "relative", zIndex: 0 }}>
          <div style={{ transform: "translateY(0px)" }}>
          <AssistantFooter text="Reply" at={new Date(2026,9,15,21,3,25)} tokens={tokens} compact={location.search.includes("compact")}
            agentName="claude" modelName="Opus 5.5" thinkingLabel="High" startedAt={new Date(2026,9,15,21,2,3).getTime()} durationMs={82000}
            usage={{ inputTokens: 123456, cachedInputTokens: 0, outputTokens: 6789 }}/>
          </div></div>
          <div data-testid="later-message" style={{ position: "absolute", zIndex: 1,
            top: location.search.includes("below") ? 150 : -150, width: 700, height: 80,
            background: "white" }}>Later message must stay behind the details</div>
        </div>);`, resolveDir: root, loader: "tsx" },
    outfile: path.join(out, "app.js"), bundle: true, jsx: "automatic", format: "iife",
    define: { global: "globalThis", "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    alias: {
      "react-native": path.join(show, "node_modules/react-native-web"),
      "@getpaseo/plugin/client/react-native": path.join(show, "shims/plugin-react-native.tsx"),
      "@getpaseo/plugin/client": path.join(show, "shims/plugin-client.tsx"),
    }, logLevel: "warning",
  });
  server = http.createServer((request, response) => {
    const js = request.url === "/app.js";
    response.setHeader("content-type", js ? "text/javascript" : "text/html");
    response.end(js ? readFileSync(path.join(out, "app.js"))
      : '<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4"],
  });
  for (const side of ["above", "below"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 844 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/?${side}`);
    await page.waitForLoadState("networkidle");
    await checkSpacing(page);
    const trigger = page.getByRole("button", { name: "Copy model name", exact: true });
    await trigger.hover();
    const table = page.getByTestId("footer-details-table");
    await table.waitFor({ state: "visible" });
    assert.match(await page.getByTestId("footer-detail-Input").textContent(), /123,456/);
    assert.match(await page.getByTestId("footer-detail-Cached").textContent(), /0/);
    assert.match(await page.getByTestId("footer-detail-Output").textContent(), /6,789/);
    assert.match(await page.getByTestId("footer-detail-Start time").textContent(), /2026-10-15 21:02:03/);
    assert.match(await page.getByTestId("footer-detail-End time").textContent(), /2026-10-15 21:03:25/);
    const button = await trigger.first().boundingBox();
    const panel = await page.getByTestId("toolbar-details-frame").boundingBox();
    assert(side === "above" ? panel.y + panel.height < button.y : panel.y > button.y + button.height);
    const overlap = await page.getByTestId("later-message").boundingBox();
    const hitX = panel.x + 20;
    const hitY = overlap.y + 20;
    assert(hitY > panel.y && hitY < panel.y + panel.height, "fixture must overlap the panel");
    assert(await page.getByTestId("toolbar-details-frame").evaluate((frame, point) =>
      frame.contains(document.elementFromPoint(point.x, point.y)), { x: hitX, y: hitY }),
      `${side}: later message paints over the details panel`);
    assert(await page.getByTestId("toolbar-details-frame").evaluate((frame) =>
      [...frame.querySelectorAll("*")].every((node) =>
        node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1)),
      `${side}: details must expand fully without internal scrolling`);
    const x = button.x + button.width / 2;
    await page.mouse.move(x, side === "above" ? button.y - 2 : button.y + button.height + 2);
    await page.waitForTimeout(250);
    assert(await table.isVisible(), `${side}: details closed while crossing the hover gap`);
    await page.mouse.move(x, side === "above" ? panel.y + panel.height - 12 : panel.y + 8);
    await page.waitForTimeout(800);
    assert(await table.isVisible(), `${side}: details closed while the pointer was inside`);
    const copyStart = table.getByRole("button", { name: "Copy start time", exact: true });
    await copyStart.hover();
    await page.waitForTimeout(800);
    assert(await table.isVisible(), `${side}: details closed while hovering a nested copy button`);
    await copyStart.click();
    assert.equal(await table.getByRole("button", { name: "Copied", exact: true }).count(), 1);
    for (const label of ["Copy model name", "Copy thinking level", "Copy end time"]) {
      const copy = table.getByRole("button", { name: label, exact: true });
      await copy.hover();
      await page.waitForTimeout(800);
      assert(await table.isVisible(), `${side}: details closed while hovering ${label}`);
      const button = await copy.elementHandle();
      await copy.click();
      await page.waitForFunction((element) => element.getAttribute("aria-label") === "Copied", button);
    }
    await page.getByTestId("footer-detail-Output").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    assert(await table.isVisible(), `${side}: scrolling the details dismissed the panel`);
    await page.mouse.move(1100, 100);
    await table.waitFor({ state: "hidden" });
    await checkSpacing(page);
    await page.close();
    console.log(`${side}: slow gap crossing, nested copy dwell, clicks, inner scroll and leave OK`);
  }
  for (const width of [390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true });
    await page.goto(`http://127.0.0.1:${server.address().port}/?below&compact`);
    await page.waitForLoadState("networkidle");
    await checkSpacing(page);
    await page.getByRole("button", { name: "Copy reply", exact: true }).click();
    await page.getByRole("button", { name: "Copy model name", exact: true }).click();
    await checkSpacing(page);
    const row = await page.getByTestId("footer-toolbar").boundingBox();
    await page.mouse.move(row.x + 8, row.y + 8);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    const center = page.getByTestId("footer-details-center");
    await center.waitFor({ state: "visible" });
    const frame = await page.getByTestId("toolbar-details-frame").boundingBox();
    assert(Math.abs(frame.x + frame.width / 2 - width / 2) < 1);
    assert(Math.abs(frame.y + frame.height / 2 - 844 / 2) < 1);
    assert.equal(await page.getByRole("button", { name: "Previous reply", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Next reply", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await center.waitFor({ state: "hidden" });
    await page.close();
    console.log(`${width}px compact: 14px icons, 4px label gaps, 8px item gaps and wrapped alignment OK`);
  }
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(out, { recursive: true, force: true });
}
