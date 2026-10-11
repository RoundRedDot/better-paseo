// Measures the vertical gap between consecutive tool rows of a finished reads-20 agent in the web build.
//   node .showcase/tools/web-h0.mjs <agentId> <label>
import { chromium } from "playwright-core";
const [agentId, label] = process.argv.slice(2);
const SERVER_ID = process.env.BC_SERVER_ID;
if (!SERVER_ID) throw new Error("Set BC_SERVER_ID to the isolated bench daemon server ID");
const ctx = await chromium.launchPersistentContext("/tmp/bc-web-profile", {
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, viewport: { width: 1280, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.routeWebSocket(/:6767\//, (ws) => ws.close());
await page.goto(`http://127.0.0.1:8090/h/${SERVER_ID}/agent/${agentId}`);
await page.waitForTimeout(7000);
const rows = await page.evaluate(() => {
  const els = [...document.querySelectorAll("[data-history-row-id]")];
  return els.map((el) => {
    const r = el.getBoundingClientRect();
    const c = el.firstElementChild?.getBoundingClientRect();
    return { top: r.top, h: r.height, childTop: c?.top ?? null, childH: c?.height ?? null, text: (el.textContent || "").slice(0, 40) };
  });
});
// Scroll so a run of consecutive tool rows is visible, then re-measure and capture.
await page.evaluate(() => {
  const els = [...document.querySelectorAll("[data-history-row-id]")];
  const target = els.find((e) => /^(Read|read)/.test((e.textContent || "").trim())) ?? els[2];
  target?.scrollIntoView({ block: "start" });
});
await page.waitForTimeout(1200);
const visible = await page.evaluate(() =>
  [...document.querySelectorAll("[data-history-row-id]")].map((el) => {
    const r = el.getBoundingClientRect();
    const c = el.firstElementChild?.getBoundingClientRect();
    return { top: Math.round(r.top * 10) / 10, h: Math.round(r.height * 10) / 10, cardTop: c ? Math.round(c.top * 10) / 10 : null, cardH: c ? Math.round(c.height * 10) / 10 : null, text: (el.textContent || "").slice(0, 36) };
  }).filter((r) => r.top > 60 && r.top < 880),
);
console.log(JSON.stringify(visible, null, 1));
const pitches = visible.slice(1).map((r, i) => Math.round((r.top - visible[i].top) * 10) / 10);
const gaps = visible.slice(1).map((r, i) => Math.round((r.cardTop - (visible[i].cardTop + visible[i].cardH)) * 10) / 10);
console.log("row pitch (css px):", JSON.stringify(pitches));
console.log("visible gap between consecutive first-child boxes (css px):", JSON.stringify(gaps));
await page.screenshot({ path: `/tmp/bc-web-shots/h0-web-${label}.png` });
await ctx.close();
