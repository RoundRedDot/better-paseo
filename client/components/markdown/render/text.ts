/**
 * Pure text helpers for the renderer. No React.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};
const ENTITY_RE = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,6});/g;

/**
 * marked keeps character references in text as written (an HTML renderer
 * would pass them through); a native `Text` would show `&amp;` literally.
 * Only numeric references and the few names an assistant actually writes are
 * decoded; anything else stays as typed.
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY_RE, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/**
 * A soft line break inside a paragraph is a space (CommonMark), so hard-wrapped
 * prose reflows to the card instead of keeping the author's column. Explicit
 * breaks arrive as their own `br` token.
 */
export function softBreaks(text: string): string {
  return text.includes("\n") ? text.replace(/[ \t]*\n[ \t]*/g, " ") : text;
}

// Extensions that name a file rather than a property access: `item.data` and
// `console.log` must stay plain inline code.
const FILE_EXTENSIONS: Record<string, true> = {
  ts: true, tsx: true, mts: true, cts: true, js: true, jsx: true, mjs: true, cjs: true,
  json: true, jsonc: true, json5: true, md: true, mdx: true, txt: true, yaml: true, yml: true,
  toml: true, ini: true, cfg: true, conf: true, env: true, lock: true, xml: true, plist: true,
  html: true, htm: true, css: true, scss: true, sass: true, less: true, vue: true, svelte: true,
  py: true, pyi: true, rb: true, rs: true, go: true, java: true, kt: true, kts: true, swift: true,
  c: true, h: true, cc: true, cpp: true, hpp: true, m: true, mm: true, cs: true, php: true,
  sh: true, bash: true, zsh: true, fish: true, ps1: true, sql: true, proto: true, graphql: true,
  gradle: true, dockerfile: true, png: true, jpg: true, jpeg: true, gif: true, svg: true, webp: true,
  pdf: true, csv: true, tsv: true, wasm: true, patch: true, diff: true,
};

const PATH_CHARS_RE = /^[\w.@+~\-/]+$/;
const LOCATION_RE = /(?::\d+){1,2}$/;

/**
 * Whether inline code reads as a file path, so it can be drawn as `PathText`
 * (plan §3.1 item 5, BC-13). A path either has a directory separator and no
 * spaces (`src/a.ts`, `./x`, `~/notes/`), or is a bare file name with a known
 * extension (`package.json`, `index.ts:12`). URLs, commands and member
 * accesses are not paths.
 */
export function isPathLike(text: string): boolean {
  if (text.length < 3 || text.length > 300) return false;
  if (text.includes("://")) return false;
  const bare = text.replace(LOCATION_RE, "");
  if (!PATH_CHARS_RE.test(bare)) return false;
  if (bare.includes("/")) {
    // `/` alone, `//`, `a/b/c` of single letters read as notation, not paths.
    if (bare.includes("//")) return false;
    return /[A-Za-z0-9_]{2,}/.test(bare);
  }
  const dot = bare.lastIndexOf(".");
  if (dot <= 0) return false;
  return FILE_EXTENSIONS[bare.slice(dot + 1).toLowerCase()] === true;
}

/** The fence's info string up to its first space: `ts title="x"` is `ts`. */
export function codeLanguage(lang: string | undefined): string {
  const first = (lang ?? "").trim().split(/\s+/)[0] ?? "";
  return first;
}

/**
 * Whether a fenced code token has its closing fence. marked lexes an unclosed
 * fence as code to the end of the input (CommonMark), so the token alone does
 * not say; its raw source does.
 */
export function fenceClosed(raw: string): boolean {
  const body = raw.replace(/\n+$/, "");
  const open = /^ {0,3}(`{3,}|~{3,})/.exec(body);
  if (open === null) return true; // indented code: complete as written
  const marker = open[1] ?? "```";
  const lastBreak = body.lastIndexOf("\n");
  if (lastBreak < 0) return false;
  const last = body.slice(lastBreak + 1).trim();
  return last.length >= marker.length && last[0] === marker[0] && /^(`+|~+)$/.test(last);
}
