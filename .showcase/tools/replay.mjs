// Runs the offline replay headless in the locally installed Chrome.
//
//   node .showcase/tools/replay.mjs [--fixtures dir] [--only name] [--speed 1]
//        [--host current|cached] [--out dir] [--dev] [--headed]
//
// No browser is downloaded: playwright-core drives the Chrome at CHROME_PATH
// (default: the macOS application bundle).
import { build } from "esbuild";
import { chromium } from "playwright-core";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const showcase = path.join(root, ".showcase");

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}
const flag = (name) => args.includes(`--${name}`);

const fixturesDir = path.resolve(option("fixtures", path.join(showcase, "fixtures-smoke")));
const outDir = path.resolve(option("out", path.join(showcase, "out")));
const speed = option("speed", "1");
const hostMode = option("host", "current");
const only = option("only", null);
const dev = flag("dev");
const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}; set CHROME_PATH`);

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(showcase, "replay.tsx")],
  outfile: path.join(showcase, "replay.js"),
  absWorkingDir: root,
  bundle: true,
  jsx: "automatic",
  format: "iife",
  minify: !dev,
  define: {
    global: "globalThis",
    "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"), __DEV__: String(dev) },
  alias: {
    "react-native": path.join(showcase, "node_modules/react-native-web"),
    "@getpaseo/plugin/client/react-native": path.join(showcase, "shims/plugin-react-native.tsx"),
    "@getpaseo/plugin/client": path.join(showcase, "shims/plugin-client.tsx"),
  },
  logLevel: "warning",
});

const names = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".jsonl"))
  .map((file) => file.replace(/\.jsonl$/, ""))
  .filter((name) => !only || name === only);
if (names.length === 0) throw new Error(`no fixtures in ${fixturesDir}`);

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/favicon.ico") {
    response.statusCode = 204;
    response.end();
    return;
  }
  const file = url.pathname.startsWith("/fixtures/")
    ? path.join(fixturesDir, path.basename(url.pathname))
    : path.join(showcase, path.basename(url.pathname === "/" ? "replay.html" : url.pathname));
  try {
    const body = readFileSync(file);
    response.setHeader(
      "content-type",
      file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : "text/plain",
    );
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: chromePath, headless: !flag("headed") });
let failed = false;
try {
  for (const name of names) {
    const context = await browser.newContext({ viewport: { width: 760, height: 900 } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(`${origin}/replay.html?fixture=${name}&speed=${speed}&host=${hostMode}`);
    await page.waitForFunction("window.__replayDone === true", null, { timeout: 15 * 60 * 1000 });
    const result = await page.evaluate("window.__replayResult");
    result.consoleErrors = consoleErrors;
    result.chrome = browser.version();
    writeFileSync(path.join(outDir, `${name}.snapshot.json`), JSON.stringify(result, null, 2));
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
    await context.close();
    if (result.error || result.errors?.length) failed = true;
    const s = result.streaming;
    console.log(
      `${name}: ${result.error ? "ERROR " + result.error : `${result.events} events, ${result.streamMs}ms, ` +
        `renders=${JSON.stringify(s.renders.byKind)} parses=${s.markdown.parses} flips=${s.markdown.formatFlips} ` +
        `hl=${s.highlightRpc.count} dropped=${s.frames.droppedRatio} idleAnim=${result.idle.animations.mounted}`}`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
