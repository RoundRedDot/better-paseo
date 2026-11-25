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

/**
 * Results a web search printed as text, one numbered title over its address:
 *
 *     [1] View - React Native
 *         https://reactnative.dev/docs/view
 *
 * Oh My Pi reports its searches this way. A placeholder title (`N/A`) or a
 * missing one gives way to the address; each address is listed once.
 */
export function parseListedLinks(text: string | undefined): Array<{ title: string; url: string }> {
  if (!text) return [];
  const links: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  LISTED_LINK.lastIndex = 0;
  for (let match = LISTED_LINK.exec(text); match; match = LISTED_LINK.exec(text)) {
    const url = match[2]!;
    if (seen.has(url) || !parseWebLink(url)) continue;
    seen.add(url);
    const title = (match[1] ?? "").trim();
    links.push({ title: title && title !== "N/A" ? title : url, url });
  }
  return links;
}
