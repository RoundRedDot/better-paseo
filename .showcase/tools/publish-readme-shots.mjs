// Publish matching light/dark captures without changing historical benchmark evidence.
// node .showcase/tools/publish-readme-shots.mjs <captures1x> <hero2x>
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const [captures, hero] = process.argv.slice(2);
if (!captures || !hero) throw new Error("capture and hero directories required");
const repo = resolve(import.meta.dirname, "../..");
const themes = ["light", "dark"];
const scenes = ["thread", "questions", "tool-bash", "tool-read", "tool-edit", "hub",
  "tool-mcp", "paseo", "tool-thinking", "tool-image", "syntax", "reasoning", "tasks",
  "checklist-window", "table-copy-menu", "table-selection", "markdown-styles",
  "markdown-preview-window", "shared-image-cards", "selection-actions", "user"];
const assets = themes.flatMap(theme => [
  { input: join(hero, theme, "shot-hero-devices.png"), path: `images/hero-devices-${theme}.png`,
    scene: "shot-hero-devices", theme, locale: "en-US", scale: 2 },
  ...scenes.map(name => ({ input: join(captures, theme, `shot-${name}.png`),
    path: `${name === "thread" ? "images" : "docs/images"}/${name}-${theme}.png`,
    scene: `shot-${name}`, theme, locale: "en-US", scale: 1 })),
  ...["en-US", "zh-CN"].flatMap(locale => [
    ["settings-wide", "settings"], ["settings-block-size", "settings-tools"],
  ].map(([scene, name]) => ({
    input: join(captures, ...(locale === "en-US" ? [] : [locale]), theme, `shot-${scene}.png`),
    path: `docs/images/${name}${locale === "en-US" ? "" : "-zh"}-${theme}.png`,
    scene: `shot-${scene}`, theme, locale, scale: 1,
  }))),
]);

// Read and validate every input before replacing any published capture.
const validated = assets.map(({ input, ...asset }) => {
  const bytes = readFileSync(resolve(input));
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`invalid PNG: ${input}`);
  }
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 100 || height < 50) throw new Error(`empty capture: ${input}`);
  return { input, ...asset, width, height, sha256: createHash("sha256").update(bytes).digest("hex") };
});
const git = args => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const sourcePaths = ["client", "server", "shared", "index.client.tsx", "index.server.ts"];
const sourceTrackedChanges = git(["diff", "HEAD", "--name-only", "--", ...sourcePaths]);
if (sourceTrackedChanges) throw new Error(`capture source has tracked changes: ${sourceTrackedChanges}`);
for (const asset of validated) copyFileSync(resolve(asset.input), join(repo, asset.path));
writeFileSync(join(repo, "docs/images/screenshots.json"), JSON.stringify({
  capturedAt: new Date().toISOString().slice(0, 10),
  sourceSha: git(["rev-parse", "HEAD"]),
  surface: "Offline React Native Web showcase with fixture data; not native device acceptance",
  defaultTheme: "light",
  darkMedia: "(prefers-color-scheme: dark)",
  productionSourcePaths: sourcePaths,
  sourceTrackedChanges: [],
  showcaseDiff: git(["diff", "HEAD", "--", ".showcase/showcase.tsx"]),
  captureSources: [".showcase/showcase.tsx", ".showcase/tools/shots.mjs"].map(path => ({
    path, sha256: createHash("sha256").update(readFileSync(join(repo, path))).digest("hex"),
  })),
  assets: validated.map(({ input, ...asset }) => asset),
}, null, 2) + "\n");
console.log(`Published ${validated.length} themed README captures`);
