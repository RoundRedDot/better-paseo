import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { toolbarLabel } from "../../client/i18n/toolbar-strings";

// Every label the block details code shows through `toolbarLabel` (directly,
// or as a ToolbarButton's or menu item's `label`) has a Chinese string.

const ROOT = join(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** String literals in the label positions: `label="…"`, `label={a ? "…" : "…"}`, `label: "…"`, `toolbarLabel(…, `, `translate("…")`, `label("…")`. */
function labelsIn(source: string): string[] {
  const found: string[] = [];
  const literals = (text: string) => Array.from(text.matchAll(/"([^"\n]+)"/g), (match) => match[1]!);
  for (const match of source.matchAll(/\blabel=("[^"\n]+"|\{[^}\n]*\})/g)) found.push(...literals(match[1]!));
  for (const match of source.matchAll(/\blabel: ("[^"\n]+")/g)) found.push(...literals(match[1]!));
  for (const match of source.matchAll(/toolbarLabel\(([^,\n]+),/g)) found.push(...literals(match[1]!));
  for (const match of source.matchAll(/\b(?:translate|label)\(("[^"\n]+")\)/g)) found.push(...literals(match[1]!));
  return found;
}

describe("block details labels", () => {
  const files = [...sources(join(ROOT, "client/details")), join(ROOT, "client/ui/hover-preview.tsx")];
  const labels = new Map<string, string>();
  files.forEach((file) => labelsIn(readFileSync(file, "utf8")).forEach((label) => labels.set(label, relative(ROOT, file))));

  it("finds the labels", () => {
    expect([...labels.keys()]).toEqual(expect.arrayContaining([
      "Close details", "Expand details", "Shrink details", "Resize details panel", "Previous block", "Next block",
      "Widen panel", "Restore panel width", "Full screen", "Exit full screen", "Wrap lines", "Do not wrap lines",
      "More", "Open in panel", "Back to latest", "1 new line", "{count} new lines",
    ]));
  });

  it("has a zh string for each", () => {
    const missing = [...labels].filter(([label]) => toolbarLabel(label, "zh") === label).map(([label, file]) => `${label} (${file})`);
    expect(missing).toEqual([]);
  });
});
