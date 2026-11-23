import type { TokenizerThis } from "../../vendor/marked";
import { localPath } from "./render/local-path";

export interface CodexToken {
  type: "codex";
  raw: string;
  kind: "browser" | "review" | "template" | "citation" | "memory";
  attrs: Record<string, string>;
  body?: string;
  entries?: Array<{ source: string; note: string }>;
}

// Attribute strings may contain braces and escaped quotes. Unknown or malformed
// directives stay as source text, as do incomplete streaming prefixes.
function directive(src: string, prefix: string): { raw: string; attrs: Record<string, string> } | undefined {
  if (!src.startsWith(prefix + "{")) return undefined;
  let pos = prefix.length + 1;
  const attrs: Record<string, string> = {};
  while (pos < src.length) {
    while (src[pos] === " " || src[pos] === "\t" || src[pos] === "\n") pos++;
    if (src[pos] === "}") return { raw: src.slice(0, pos + 1), attrs };
    const key = /^[\w-]+/.exec(src.slice(pos))?.[0];
    if (!key || attrs[key] !== undefined) return undefined;
    pos += key.length;
    if (src[pos++] !== "=") return undefined;
    let value = "";
    if (src[pos] === '"') {
      pos++;
      let closed = false;
      while (pos < src.length) {
        const ch = src[pos++]!;
        if (ch === '"') { closed = true; break; }
        if (ch === "\\" && (src[pos] === '"' || src[pos] === "\\")) value += src[pos++]!;
        else value += ch;
      }
      if (!closed) return undefined;
    } else {
      const bare = /^[^\s}]+/.exec(src.slice(pos))?.[0];
      if (!bare) return undefined;
      value = bare;
      pos += bare.length;
    }
    attrs[key] = value;
    if (src[pos] !== "}" && !/\s/.test(src[pos] ?? "")) return undefined;
  }
  return undefined;
}

export function codexPath(path: string): string | null {
  return localPath(/^file:\/\//i.test(path) ? path : path.replace(/%/g, "%25"));
}

type LegacyBody = { state: "open" | "blocked" } | { state: "closed"; body: string; raw: string };

function legacyBody(following: string, allowBlank: boolean): LegacyBody {
  const start = /^[ \t]*\n/.exec(following);
  if (!start) return { state: following.trim() ? "blocked" : "open" };
  let pos = start[0].length;
  const bodyStart = pos;
  let fence: { marker: string; length: number } | undefined;
  while (pos < following.length) {
    const newline = following.indexOf("\n", pos);
    const end = newline < 0 ? following.length : newline;
    const line = following.slice(pos, end);
    if (pos === bodyStart && line.trim() === "" && !allowBlank) return { state: "blocked" };
    if (!fence && /^ {0,3}::code-comment\{/.test(line)) return { state: "blocked" };
    if (!fence && /^::[ \t]*$/.test(line)) {
      const body = following.slice(bodyStart, pos).trim();
      return body ? { state: "closed", body, raw: following.slice(0, end) } : { state: "blocked" };
    }
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) fence = { marker: marker[0]!, length: marker.length };
    else if (marker && fence && marker[0] === fence.marker && marker.length >= fence.length && /^ {0,3}(`+|~+)[ \t]*$/.test(line)) fence = undefined;
    if (newline < 0) break;
    pos = newline + 1;
  }
  return { state: "open" };
}

/** Whether an append completed an earlier directive or its legacy review body. */
export function directiveChanged(before: string, after: string): boolean {
  const prefix = ["::code-comment", "::browser-complete", "::artifact-template", ":codex-file-citation"]
    .find((item) => before.startsWith(item + "{"));
  if (!prefix) return false;
  const old = directive(before, prefix);
  const next = directive(after, prefix);
  if (!old) return next !== undefined;
  if (prefix !== "::code-comment" || old.attrs.body) return false;
  const allowBlank = !old.attrs.title;
  return legacyBody(before.slice(old.raw.length), allowBlank).state === "open" &&
    legacyBody(after.slice(old.raw.length), allowBlank).state === "closed";
}

function citation(src: string): CodexToken | undefined {
  const parsed = directive(src, ":codex-file-citation");
  if (!parsed || !parsed.attrs.path || !["source", "output"].includes(parsed.attrs.purpose ?? "")) return undefined;
  if (parsed.attrs.mode === "live" || codexPath(parsed.attrs.path) === null) return undefined;
  return { type: "codex", kind: "citation", ...parsed };
}

export function codexInlineStart(src: string): number | undefined {
  const index = src.indexOf(":codex-file-citation{");
  return index < 0 ? undefined : index;
}

export function codexInlineTokenizer(src: string): CodexToken | undefined {
  return citation(src);
}

const BLOCK_START = /(?:^|\n) {0,3}(?:::browser-complete\{|::code-comment\{|::artifact-template\{|:codex-file-citation\{|<oai-mem-citation>)/;
export function codexBlockStart(src: string): number | undefined {
  const match = BLOCK_START.exec(src);
  return match ? match.index + (match[0].startsWith("\n") ? 1 : 0) : undefined;
}

export function codexBlockTokenizer(this: TokenizerThis, src: string): CodexToken | undefined {
  const indent = /^ {0,3}/.exec(src)?.[0] ?? "";
  const text = src.slice(indent.length);
  const file = citation(text);
  if (file?.attrs.purpose === "output" && /^[ \t]*(?:\n|$)/.test(text.slice(file.raw.length))) {
    return { ...file, raw: indent + file.raw };
  }
  if (text.startsWith("<oai-mem-citation>")) {
    const end = text.indexOf("</oai-mem-citation>");
    if (end < 0) return undefined;
    const raw = indent + text.slice(0, end + "</oai-mem-citation>".length);
    const rest = src.slice(raw.length);
    if (rest && !/^\s*(?:\n|$)/.test(rest)) return undefined;
    const inner = text.slice("<oai-mem-citation>".length, end);
    const entriesText = /<citation_entries>\s*([\s\S]*?)\s*<\/citation_entries>/.exec(inner)?.[1];
    if (!entriesText) return undefined;
    const entries = entriesText.split("\n").map((line) => {
      const entry = /^(.+?)\|note=\[(.*)\]$/.exec(line.trim());
      return entry ? { source: entry[1]!, note: entry[2]! } : undefined;
    });
    if (entries.some((entry) => !entry)) return undefined;
    return { type: "codex", kind: "memory", attrs: {}, raw, entries: entries as Array<{ source: string; note: string }> };
  }
  for (const [prefix, kind] of [["::browser-complete", "browser"], ["::code-comment", "review"], ["::artifact-template", "template"]] as const) {
    const parsed = directive(text, prefix);
    if (!parsed) continue;
    const attrs = parsed.attrs;
    if (kind === "browser" && !attrs.title) return undefined;
    if (kind === "template" && (!attrs.display_name || !attrs.artifact_kind || !attrs.skill_name)) return undefined;
    if (kind === "review" && !attrs.file) return undefined;
    let raw = indent + parsed.raw;
    let body: string | undefined;
    // Older code-review output puts the explanation between the directive and ::.
    if (kind === "review" && !attrs.body) {
      const following = src.slice(raw.length);
      const match = legacyBody(following, !attrs.title);
      if (match.state === "closed") {
        body = match.body;
        raw += match.raw;
      } else if (!attrs.title) return undefined;
    }
    if (kind === "review" && !attrs.title && !body) return undefined;
    if (!/^[ \t]*(?:\n|$)/.test(src.slice(raw.length))) return undefined;
    return { type: "codex", kind, attrs, raw, body };
  }
  return undefined;
}

export function codexFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function citationLabel(token: CodexToken): string {
  const path = token.attrs.path!;
  const name = codexFileName(/^file:\/\//i.test(path) ? codexPath(path)! : path);
  const location = token.attrs.page_number ? ` · p. ${token.attrs.page_number}` : token.attrs.sheet && token.attrs.range ? ` · ${token.attrs.sheet} ${token.attrs.range}` : "";
  return name + location;
}
