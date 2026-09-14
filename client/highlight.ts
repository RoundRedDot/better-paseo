import { useEffect, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { highlightRpc, type HighlightLine, type HighlightToken } from "../shared/highlight-rpc";

export interface HighlightRequest {
  code: string;
  language?: string;
  filename?: string;
  dark: boolean;
}

/**
 * Grammars live on the daemon, so every block pays one round trip. The cache
 * makes that trip once per distinct block: ten mounts of the same snippet in a
 * transcript share one answer, and a remount reads it back without a flash of
 * unhighlighted text.
 */
const CACHE_LIMIT = 200;

/** A null entry marks a key the daemon could not answer, so it is not retried. */
const cache = new Map<string, HighlightLine[] | null>();
const inFlight = new Map<string, Promise<void>>();

/**
 * Hints the daemon answers unhighlighted on purpose. The author asked for plain
 * text, so an unhighlighted answer to one of these is the right answer and the
 * component must not colour it with the tokeniser instead.
 */
const PLAIN_HINTS: Record<string, true> = { plaintext: true, text: true, txt: true };

function isPlainHint(language: string | undefined): boolean {
  return language !== undefined && PLAIN_HINTS[language.trim().toLowerCase()] === true;
}

/**
 * The theme picks the colours and the language picks the grammar, so both
 * belong in the key beside the code itself. `\u0000` cannot occur in a language
 * id or in a path, which keeps the parts from running together.
 */
function cacheKey(request: HighlightRequest): string {
  return [
    request.dark ? "dark" : "light",
    request.language ?? "",
    request.filename ?? "",
    request.code,
  ].join("\u0000");
}

function remember(key: string, lines: HighlightLine[] | null): void {
  cache.set(key, lines);
  // Insertion order is the eviction order, so the oldest key is the first one.
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * A daemon without this handler, or one older than this contract, answers with
 * something else entirely. Reject that answer rather than render from it.
 */
function readLines(answer: unknown, allowPlain: boolean): HighlightLine[] | null {
  if (typeof answer !== "object" || answer === null || !("lines" in answer)) return null;
  const rawLines: unknown = answer.lines;
  if (!Array.isArray(rawLines)) return null;

  // A null language means the daemon sent the text back unhighlighted: no
  // grammar matched, or a size guard tripped on a huge or minified block. The
  // tokeniser in the component still colours that text, so treat that as no
  // answer and keep the fallback. A plain-text hint is the exception: plain is
  // what was asked for. Either way the key is cached, so nothing is retried.
  const language: unknown = "language" in answer ? answer.language : undefined;
  if (language !== null && typeof language !== "string") return null;
  if (language === null && !allowPlain) return null;

  const lines: HighlightLine[] = [];
  for (const rawLine of rawLines) {
    const candidateLine: unknown = rawLine;
    if (!Array.isArray(candidateLine)) return null;
    const line: HighlightToken[] = [];
    for (const rawToken of candidateLine) {
      const token: unknown = rawToken;
      if (typeof token !== "object" || token === null) return null;
      if (!("text" in token) || typeof token.text !== "string") return null;
      const rawColor: unknown = "color" in token ? token.color : null;
      const color = typeof rawColor === "string" ? rawColor : rawColor === null ? null : undefined;
      if (color === undefined) return null;
      line.push({
        text: token.text,
        color,
        bold: "bold" in token && token.bold === true,
        italic: "italic" in token && token.italic === true,
      });
    }
    lines.push(line);
  }
  return lines;
}

type HighlightCall = (input: {
  code: string;
  language?: string;
  filename?: string;
  dark: boolean;
}) => Promise<unknown>;

/**
 * One call per key. A second mount of the same block joins the promise already
 * in flight instead of asking the daemon to tokenise the same text again.
 */
function fetchLines(key: string, call: HighlightCall, request: HighlightRequest): Promise<void> {
  const pending = inFlight.get(key);
  if (pending) return pending;

  const started = call({
    code: request.code,
    language: request.language,
    filename: request.filename,
    dark: request.dark,
  })
    .then((answer) => {
      remember(key, readLines(answer, isPlainHint(request.language)));
    })
    .catch(() => {
      remember(key, null);
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, started);
  return started;
}

/**
 * The daemon's tokens for this block, or null while none are available. Null is
 * the caller's cue to keep drawing its own fallback: it covers the first paint,
 * a language the daemon cannot highlight, and a call that failed.
 */
export function useHighlightedLines(request: HighlightRequest): HighlightLine[] | null {
  const call: HighlightCall = useRpc(highlightRpc);
  const { code, language, filename, dark } = request;
  const key = code.length > 0 ? cacheKey(request) : null;
  // Reading the cache during render, not in an effect, is what removes the
  // unhighlighted frame on a block that was tokenised once already.
  const cached = key !== null ? (cache.get(key) ?? null) : null;
  const [, bumpRevision] = useState(0);

  useEffect(() => {
    if (key === null || cache.has(key)) return;
    let mounted = true;
    void fetchLines(key, call, { code, language, filename, dark }).then(() => {
      if (mounted) bumpRevision((revision) => revision + 1);
    });
    return () => {
      mounted = false;
    };
  }, [key, call, code, language, filename, dark]);

  return cached;
}
