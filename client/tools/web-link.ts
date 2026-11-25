/**
 * The parts a web link row draws: the site first (its favicon and domain),
 * then the rest of the address, so a long URL clipped by the row still says
 * which site it is.
 */

export interface WebLink {
  /** The address to open, as the tool reported it. */
  href: string;
  /** Lower-cased host without `www.` or a port: `docs.expo.dev`. */
  host: string;
  /** Path, query and fragment; empty for a site's root. */
  path: string;
}

const HTTP_URL = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

/** A single http(s) URL, optionally in quotes; anything else is not a link. */
export function parseWebLink(text: string | undefined): WebLink | null {
  if (!text) return null;
  const trimmed = text.trim().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, "");
  if (!HTTP_URL.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host) return null;
  const rest = `${url.pathname}${url.search}${url.hash}`;
  return { href: trimmed, host, path: rest === "/" ? "" : rest };
}

/** The site's own favicon: the device asks the site, no third-party service. */
export function faviconUrl(host: string): string {
  return `https://${host}/favicon.ico`;
}

/** Distinct hosts in order of first appearance. */
export function distinctHosts(urls: readonly string[]): string[] {
  const hosts: string[] = [];
  for (const url of urls) {
    const host = parseWebLink(url)?.host;
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

const LISTED_LINK = /^\s*\[\d+\]\s+(.*?)\s*\n\s+(https?:\/\/\S+)\s*$/gm;
const LINKS_LINE = /^Links:\s*(\[.*\])\s*$/gm;
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

type FoundLink = { title: string; url: string };

/**
 * Results a web search printed as text instead of reporting them, in the
 * shapes agents print them:
 *
 * - a numbered title over its address (Oh My Pi):
 *       [1] View - React Native
 *           https://reactnative.dev/docs/view
 * - a `Links: [{"title": ..., "url": ...}]` line (Claude Code's WebSearch text)
 * - Markdown links, `[View](https://reactnative.dev/docs/view)`
 *
 * The first shape found wins. A placeholder title (`N/A`) or a missing one
 * gives way to the address; each address is listed once.
 */
export function parseListedLinks(text: string | undefined): FoundLink[] {
  if (!text) return [];
  for (const read of [numberedLinks, linksLines, markdownLinks]) {
    const found = read(text);
    if (found.length > 0) return dedupe(found);
  }
  return [];
}

function numberedLinks(text: string): FoundLink[] {
  const found: FoundLink[] = [];
  LISTED_LINK.lastIndex = 0;
  for (let match = LISTED_LINK.exec(text); match; match = LISTED_LINK.exec(text)) {
    found.push({ title: match[1] ?? "", url: match[2]! });
  }
  return found;
}

function linksLines(text: string): FoundLink[] {
  const found: FoundLink[] = [];
  LINKS_LINE.lastIndex = 0;
  for (let match = LINKS_LINE.exec(text); match; match = LINKS_LINE.exec(text)) {
    let rows: unknown;
    try {
      rows = JSON.parse(match[1]!);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const entry = row as { title?: unknown; url?: unknown } | null;
      if (entry && typeof entry.url === "string") {
        found.push({ title: typeof entry.title === "string" ? entry.title : "", url: entry.url });
      }
    }
  }
  return found;
}

function markdownLinks(text: string): FoundLink[] {
  const found: FoundLink[] = [];
  MARKDOWN_LINK.lastIndex = 0;
  for (let match = MARKDOWN_LINK.exec(text); match; match = MARKDOWN_LINK.exec(text)) {
    found.push({ title: match[1] ?? "", url: match[2]! });
  }
  return found;
}

function dedupe(found: readonly FoundLink[]): FoundLink[] {
  const links: FoundLink[] = [];
  const seen = new Set<string>();
  for (const { title, url } of found) {
    if (seen.has(url) || !parseWebLink(url)) continue;
    seen.add(url);
    const shown = title.trim();
    links.push({ title: shown && shown !== "N/A" ? shown : url, url });
  }
  return links;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * A page title as the page wrote it: search providers pass HTML titles on
 * with their character references (`React Native&#39;s`).
 */
export function decodeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}
