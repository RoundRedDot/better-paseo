// Drives a production web build of Paseo (served on :8090) in local Chrome against the
// isolated bench daemon, and runs fixtures through the /bc-perf slash command.
//   node .showcase/tools/web-bench.mjs <fixture>:<speed> ...   (e.g. mixed-turn:1 history-100:max)
// The web app probes ws://localhost:6767 on start; that socket is blocked here so the
// user's main daemon is never contacted.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const HOME = `${process.env.HOME}/.paseo-bench`;
const SERVER_ID = process.env.BC_SERVER_ID;
if (!SERVER_ID) throw new Error("Set BC_SERVER_ID to the isolated bench daemon server ID");
const ORIGIN = "http://127.0.0.1:8090";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = "/tmp/bc-web-profile";
const OUT = process.env.OUT ?? "/tmp/bc-web-shots";
const paseo = (...args) => execFileSync("paseo", ["--home", HOME, ...args], { encoding: "utf8" });
const dumps = () => readdirSync("/tmp/bc-perf").filter((f) => f.startsWith("web-"));

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] ?? (await context.newPage());
await page.routeWebSocket(/:6767\//, (ws) => ws.close());
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));

async function ensureHost() {
  if (await page.getByText("直接连接").first().isVisible().catch(() => false)) {
    await page.getByText("直接连接").first().click();
    await page.waitForTimeout(800);
    const inputs = page.locator("input");
    await inputs.nth(0).fill("127.0.0.1");
    await inputs.nth(1).fill("6868");
    await page.getByText("连接", { exact: true }).last().click();
    await page.waitForTimeout(5000);
  }
}
async function open(url) {
  await page.goto(url);
  await page.waitForTimeout(4000);
  await ensureHost();
  if (!page.url().includes("/agent/") && url.includes("/agent/")) {
    await page.goto(url);
    await page.waitForTimeout(4000);
  }
}

async function command(text) {
  // The composer is a custom field: click its placeholder area near the bottom.
  await page.mouse.click(800, 800);
  await page.waitForTimeout(300);
  await page.keyboard.type(text, { delay: 15 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
}

async function run(fixture, speed) {
  const id = paseo("run", "-d", "-q", "--provider", "bc-bench", "--cwd", "/tmp/bc-orchestrate/s0d-project", "--title", `perf-web-${fixture}`, "list").trim().split("\n").pop();
  try { paseo("wait", id, "--timeout", "60"); } catch {}
  await open(`${ORIGIN}/h/${SERVER_ID}/agent/${id}`);
  await command("/bc-perf on");
  await command("/bc-perf reset");
  paseo("send", id, `fixture:${fixture} speed:${speed}`);
  try { paseo("wait", id, "--timeout", "900"); } catch (e) { console.log("wait failed", String(e).slice(0, 120)); }
  await page.waitForTimeout(4000);
  const before = dumps().length;
  await command(`/bc-perf dump ${fixture}`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/web-${fixture}.png` });
  console.log(`${fixture} [speed ${speed}] agent ${id}: ${dumps().length > before ? "dumped" : "NO DUMP"}`);
}

import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });
console.log("chrome", context.browser()?.version());
for (const spec of process.argv.slice(2)) {
  const [fixture, speed] = spec.split(":");
  await run(fixture, speed ?? "1");
}
await context.close();
