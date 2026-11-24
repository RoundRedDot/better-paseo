/**
 * Free machine translation, sent from the client straight to a public
 * translation service (the endpoints browser translators use). No key, no
 * daemon round trip, no prompt.
 *
 * Markdown is kept by translating line by line: fenced code blocks, table
 * separators and lines without letters are never sent, list/heading/quote
 * markers stay in place, and inline code, URLs, link targets and HTML tags are
 * swapped for `{n}` placeholders that every supported service leaves alone. A
 * line whose placeholders do not all come back keeps its original text.
 *
 * Keep comments and regexes strictly ASCII for Hermes bundle compilation.
 */
import { FREE_TRANSLATION_SERVICES, type FreeServiceChoice, type FreeTranslationService } from "./timeline-translation";

export interface FreeServiceInfo {
  /** Shown as the "model" of a translation. */
  name: string;
  /** Where the text goes, shown with the result. */
  origin: string;
}

export const FREE_SERVICE_INFO: Record<FreeTranslationService, FreeServiceInfo> = {
  microsoft: { name: "Microsoft Translator", origin: "https://edge.microsoft.com" },
  google: { name: "Google Translate", origin: "https://translate-pa.googleapis.com" },
  tencent: { name: "Tencent TranSmart", origin: "https://transmart.qq.com" },
};

export const FREE_TRANSLATION_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 4 * 1024 * 1024;
/** Per request; each service caps a request well above this. */
const MAX_BATCH_CHARS = 4500;
const MAX_BATCH_ITEMS = 50;

// ---------------------------------------------------------------- languages

const MICROSOFT_CODES: Record<string, string> = {
  "zh-CN": "zh-Hans",
  "zh-TW": "zh-Hant",
  no: "nb",
  mn: "mn-Cyrl",
  sr: "sr-Cyrl",
  tlh: "tlh-Latn",
  "tlh-Qaak": "tlh-Piqd",
};

const GOOGLE_CODES: Record<string, string> = {
  fil: "tl",
  "sr-Cyrl": "sr",
  "sr-Latn": "sr",
};

/** TranSmart covers fewer languages; anything else is refused before sending. */
const TENCENT_CODES: Record<string, string> = {
  "zh-CN": "zh", "zh-TW": "zh-TW", en: "en", ja: "ja", ko: "ko", fr: "fr", es: "es", it: "it",
  de: "de", tr: "tr", ru: "ru", pt: "pt", vi: "vi", id: "id", th: "th", ms: "ms", ar: "ar", hi: "hi",
};

/**
 * `unavailable`: the service could not be used from here. `unsupported`: it
 * has no such target language. `auto` tries the next service on either.
 * Plain tagged errors: legacy Hermes cannot compile `class extends Error`.
 */
type FreeErrorKind = "unavailable" | "unsupported" | "failed";

const FREE_ERROR_KIND = "freeTranslationErrorKind";

function freeError(message: string, kind: FreeErrorKind = "failed"): Error {
  return Object.assign(new Error(message), { [FREE_ERROR_KIND]: kind });
}

function freeErrorKind(error: unknown): FreeErrorKind | null {
  const kind = (error as Record<string, unknown> | null)?.[FREE_ERROR_KIND];
  return kind === "unavailable" || kind === "unsupported" || kind === "failed" ? kind : null;
}

export function freeServiceLanguage(service: FreeTranslationService, code: string): string {
  if (service === "microsoft") return MICROSOFT_CODES[code] ?? code;
  if (service === "google") return GOOGLE_CODES[code] ?? code;
  const mapped = TENCENT_CODES[code];
  if (!mapped) {
    throw freeError(`${FREE_SERVICE_INFO.tencent.name} cannot translate into ${code}. Pick another service or target language.`, "unsupported");
  }
  return mapped;
}

// ---------------------------------------------------------------- markdown

/** One piece of the source: kept as is, or sent for translation. */
export type Piece = { keep: string } | { send: string; tokens: string[] };

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LINE_PREFIX = /^(\s*(?:#{1,6}\s+|>\s*)*(?:(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?)/;
// Inline code, the brackets of a link around its text, emphasis markers,
// autolinks, bare URLs, HTML tags, and text that already looks like a
// placeholder.
const PROTECTED = /(`+)[^`]*?\1|\[(?=[^\]\n]*\]\()|\*\*|__|~~|<https?:\/\/[^>\s]+>|\]\([^)\s]*(?:\s+"[^"]*")?\)|https?:\/\/[^\s<>()\]]*[^\s<>()\].,;:!?'"]|<\/?[A-Za-z][^<>]*>|\{\d+\}/g;
const HAS_LETTER = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u06FF\u0900-\u0DFF\u0E00-\u0EFF\u1100-\u11FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;

function protect(text: string): { send: string; tokens: string[] } | null {
  const tokens: string[] = [];
  const send = text.replace(PROTECTED, (match) => {
    tokens.push(match);
    return `{${tokens.length - 1}}`;
  });
  return HAS_LETTER.test(send.replace(/\{\d+\}/g, "")) ? { send, tokens } : null;
}

/** Puts the protected parts back; null when the service lost or repeated one. */
export function restorePlaceholders(translated: string, tokens: readonly string[]): string | null {
  const seen = new Set<number>();
  let broken = false;
  const restored = translated.replace(/\{\s*(\d+)\s*\}/g, (match, digits: string) => {
    const index = Number(digits);
    if (index >= tokens.length || seen.has(index)) {
      broken = true;
      return match;
    }
    seen.add(index);
    return tokens[index]!;
  });
  return broken || seen.size !== tokens.length ? null : restored;
}

function pushText(pieces: Piece[], text: string): void {
  const leading = /^\s*/.exec(text)![0];
  const trailing = /\s*$/.exec(text.slice(leading.length))![0];
  const body = text.slice(leading.length, text.length - trailing.length);
  const sent = body ? protect(body) : null;
  if (!sent) {
    pieces.push({ keep: text });
    return;
  }
  if (leading) pieces.push({ keep: leading });
  pieces.push(sent);
  if (trailing) pieces.push({ keep: trailing });
}

export function splitMarkdown(text: string): Piece[] {
  const pieces: Piece[] = [];
  const lines = text.split("\n");
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const newline = index < lines.length - 1 ? "\n" : "";
    const marker = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      pieces.push({ keep: line + newline });
      return;
    }
    if (marker) {
      fence = marker;
      pieces.push({ keep: line + newline });
      return;
    }
    if (TABLE_SEPARATOR.test(line) && line.includes("-")) {
      pieces.push({ keep: line + newline });
      return;
    }
    const prefix = LINE_PREFIX.exec(line)![1]!;
    if (prefix) pieces.push({ keep: prefix });
    const rest = line.slice(prefix.length);
    if (rest.includes("|") && /^\s*\|/.test(line)) {
      // A table row: translate each cell on its own.
      rest.split("|").forEach((cell, cellIndex) => {
        if (cellIndex > 0) pieces.push({ keep: "|" });
        pushText(pieces, cell);
      });
    } else {
      pushText(pieces, rest);
    }
    if (newline) pieces.push({ keep: newline });
  });
  return pieces;
}

// ---------------------------------------------------------------- requests

type Fetch = typeof fetch;

interface ServiceRequest {
  texts: string[];
  from: string;
  to: string;
  fetch: Fetch;
  signal: AbortSignal;
}

async function readJson(response: Response, name: string): Promise<unknown> {
  if (!response.ok) throw freeError(`${name} returned HTTP ${response.status}.`, "unavailable");
  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_CHARS) throw freeError(`${name}'s reply is too large.`, "unavailable");
  try {
    return JSON.parse(raw);
  } catch {
    throw freeError(`${name} did not answer with JSON.`, "unavailable");
  }
}

function stringsOrThrow(value: unknown, count: number, name: string): string[] {
  if (!Array.isArray(value) || value.length !== count || !value.every((item) => typeof item === "string")) {
    throw freeError(`${name} answered in an unexpected format.`, "unavailable");
  }
  return value as string[];
}

async function microsoft({ texts, to, fetch: send, signal }: ServiceRequest): Promise<string[]> {
  const url = `https://edge.microsoft.com/translate/translatetext?from=&to=${encodeURIComponent(to)}&isEnterpriseClient=false`;
  const response = await send(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(texts),
    signal,
  });
  const body = await readJson(response, FREE_SERVICE_INFO.microsoft.name);
  const out = Array.isArray(body)
    ? body.map((item) => (item as { translations?: { text?: unknown }[] } | null)?.translations?.[0]?.text)
    : null;
  return stringsOrThrow(out, texts.length, FREE_SERVICE_INFO.microsoft.name);
}

// The public key Chrome's built-in page translation uses for this endpoint.
const GOOGLE_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);/g, (match, entity: string) => {
    switch (entity) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return "\"";
      case "apos": return "'";
      case "nbsp": return " ";
    }
    const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

async function google({ texts, to, fetch: send, signal }: ServiceRequest): Promise<string[]> {
  // translateHtml reads its input as HTML.
  const response = await send("https://translate-pa.googleapis.com/v1/translateHtml", {
    method: "POST",
    headers: { "Content-Type": "application/json+protobuf", "X-Goog-API-Key": GOOGLE_KEY },
    body: JSON.stringify([[texts.map(escapeHtml), "auto", to], "wt_lib"]),
    signal,
  });
  const body = await readJson(response, FREE_SERVICE_INFO.google.name);
  const out = stringsOrThrow(Array.isArray(body) ? body[0] : null, texts.length, FREE_SERVICE_INFO.google.name);
  return out.map(unescapeHtml);
}

let tencentClientKey: string | null = null;

function clientKey(): string {
  if (!tencentClientKey) {
    let id = "";
    for (let i = 0; i < 32; i += 1) id += Math.floor(Math.random() * 16).toString(16);
    tencentClientKey = `browser-chrome-120.0.0-Mac OS-${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}-${Date.now()}`;
  }
  return tencentClientKey;
}

async function tencent({ texts, to, fetch: send, signal }: ServiceRequest): Promise<string[]> {
  const response = await send("https://transmart.qq.com/api/imt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      header: { fn: "auto_translation", client_key: clientKey() },
      type: "plain",
      model_category: "normal",
      source: { text_list: texts, lang: "auto" },
      target: { lang: to },
    }),
    signal,
  });
  const body = await readJson(response, FREE_SERVICE_INFO.tencent.name) as
    { header?: { ret_code?: unknown }; auto_translation?: unknown } | null;
  if (body?.header?.ret_code !== "succ") {
    throw freeError(`${FREE_SERVICE_INFO.tencent.name} refused the request.`, "unavailable");
  }
  return stringsOrThrow(body.auto_translation, texts.length, FREE_SERVICE_INFO.tencent.name);
}

const SERVICES: Record<FreeTranslationService, (request: ServiceRequest) => Promise<string[]>> = {
  microsoft,
  google,
  tencent,
};

function batches(texts: readonly string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (current.length > 0 && (size + text.length > MAX_BATCH_CHARS || current.length >= MAX_BATCH_ITEMS)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length > 0) out.push(current);
  return out;
}

export interface FreeTranslationRequest {
  service: FreeServiceChoice;
  text: string;
  /** A `TRANSLATION_LANGUAGES` code. */
  targetCode: string;
  fetch?: Fetch;
  timeoutMs?: number;
}

export interface FreeTranslationResult {
  translation: string;
  /** The service that answered; with `auto`, the first one that worked. */
  service: FreeTranslationService;
}

/** The service `auto` settled on for this client session. */
let autoService: FreeTranslationService | null = null;

export function autoFreeService(): FreeTranslationService | null {
  return autoService;
}

/** What to name a choice before it answers: `auto` names the service it settled on, if any. */
export function freeServiceInfo(choice: FreeServiceChoice): FreeServiceInfo {
  const service = choice === "auto" ? autoService : choice;
  return service ? FREE_SERVICE_INFO[service] : { name: "Free translation", origin: "" };
}

export function resetAutoFreeServiceForTests(): void {
  autoService = null;
}

async function translateWith(service: FreeTranslationService, request: FreeTranslationRequest): Promise<string> {
  const info = FREE_SERVICE_INFO[service];
  const to = freeServiceLanguage(service, request.targetCode);
  const pieces = splitMarkdown(request.text);
  const sent = pieces.filter((piece): piece is { send: string; tokens: string[] } => "send" in piece);
  if (sent.length === 0) return request.text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? FREE_TRANSLATION_TIMEOUT_MS);
  const send = request.fetch ?? fetch;
  const results: string[] = [];
  try {
    for (const batch of batches(sent.map((piece) => piece.send))) {
      results.push(...await SERVICES[service]({ texts: batch, from: "", to, fetch: send, signal: controller.signal }));
    }
  } catch (error) {
    if (freeErrorKind(error)) throw error;
    if (controller.signal.aborted) throw freeError(`${info.name} did not answer in time.`, "unavailable");
    throw freeError(`Could not reach ${info.name}. Check the network, or pick another service.`, "unavailable");
  } finally {
    clearTimeout(timer);
  }

  let next = 0;
  const out = pieces.map((piece) => {
    if ("keep" in piece) return piece.keep;
    const translated = results[next++]!;
    return restorePlaceholders(translated.trim(), piece.tokens) ?? restorePlaceholders(piece.send, piece.tokens)!;
  }).join("");
  if (!out.trim()) throw freeError(`${info.name} returned an empty translation.`);
  return out;
}

export async function translateFree(request: FreeTranslationRequest): Promise<FreeTranslationResult> {
  if (request.service !== "auto") {
    return { translation: await translateWith(request.service, request), service: request.service };
  }
  const order = autoService ? [autoService, ...FREE_TRANSLATION_SERVICES.filter((service) => service !== autoService)] : FREE_TRANSLATION_SERVICES;
  let last: unknown = null;
  for (const service of order) {
    try {
      const translation = await translateWith(service, request);
      autoService = service;
      return { translation, service };
    } catch (error) {
      // An unreachable service, or one without the target language: try the next.
      last = error;
      if (freeErrorKind(error) !== "unavailable" && freeErrorKind(error) !== "unsupported") throw error;
    }
  }
  throw last instanceof Error ? freeError(`No free translation service is reachable from this device. ${last.message}`) : freeError("No free translation service is reachable from this device.");
}
