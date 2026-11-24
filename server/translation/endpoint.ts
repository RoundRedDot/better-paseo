import { isIP } from "node:net";
import type { TranslationEndpointCheck } from "../../shared/timeline-translation";

const CHAT_COMPLETIONS_PATH = "/chat/completions";

/**
 * Only this machine counts as loopback: `localhost`, `127.0.0.0/8` and `::1`.
 * `0.0.0.0`, private ranges and LAN names are remote and need HTTPS.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") return true;
  if (isIP(host) === 4) return host.split(".")[0] === "127";
  if (isIP(host) === 6) return host === "::1" || host === "0:0:0:0:0:0:0:1";
  return false;
}

/**
 * Resolves a configured endpoint to the URL a translation is POSTed to. A base
 * URL (`https://api.example.com/v1`) gets `/chat/completions` appended; a URL
 * that already ends with it is used as is. Nothing here touches the network.
 */
export function resolveTranslationEndpoint(raw: string): TranslationEndpointCheck {
  const text = raw.trim();
  if (!text) return { status: "empty" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { status: "invalid", problem: "invalid_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { status: "invalid", problem: "unsupported_protocol" };
  }
  if (url.username || url.password) return { status: "invalid", problem: "embedded_credentials" };
  if (url.search || url.hash || text.includes("?") || text.includes("#")) {
    return { status: "invalid", problem: "query_or_fragment" };
  }
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol === "http:" && !loopback) return { status: "invalid", problem: "insecure_remote" };
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith(CHAT_COMPLETIONS_PATH) ? path : `${path}${CHAT_COMPLETIONS_PATH}`;
  return { status: "ok", requestUrl: url.toString(), origin: url.origin, loopback };
}
