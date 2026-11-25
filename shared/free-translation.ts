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
import { FREE_TRANSLATION_SERVICES, type FreeTranslationChoice, type FreeTranslationService } from "./timeline-translation";

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
  yandex: { name: "Yandex Translate", origin: "https://api.browser.yandex.com" },
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
 * An error this module wrote, whose message is safe to show as is. A plain
 * tagged error: legacy Hermes cannot compile `class extends Error`.
 */
const FREE_ERROR = "freeTranslationError";

function freeError(message: string): Error {
  return Object.assign(new Error(message), { [FREE_ERROR]: true });
}

function isFreeError(error: unknown): boolean {
  return (error as Record<string, unknown> | null)?.[FREE_ERROR] === true;
}

export function freeServiceLanguage(service: FreeTranslationService, code: string): string {
  if (service === "microsoft") return MICROSOFT_CODES[code] ?? code;
  if (service === "google") return GOOGLE_CODES[code] ?? code;
  if (service === "yandex") {
    if (code === "zh-TW") throw freeError("Yandex Translate cannot translate into zh-TW. Pick another service or target language.");
    return code === "zh-CN" ? "zh" : code;
  }
  const mapped = TENCENT_CODES[code];
  if (!mapped) {
    throw freeError(`${FREE_SERVICE_INFO.tencent.name} cannot translate into ${code}. Pick another service or target language.`);
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
  if (!response.ok) throw freeError(`${name} returned HTTP ${response.status}.`);
  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_CHARS) throw freeError(`${name}'s reply is too large.`);
  try {
    return JSON.parse(raw);
  } catch {
    throw freeError(`${name} did not answer with JSON.`);
  }
}

function stringsOrThrow(value: unknown, count: number, name: string): string[] {
  if (!Array.isArray(value) || value.length !== count || !value.every((item) => typeof item === "string")) {
    throw freeError(`${name} answered in an unexpected format.`);
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
    throw freeError(`${FREE_SERVICE_INFO.tencent.name} refused the request.`);
  }
  return stringsOrThrow(body.auto_translation, texts.length, FREE_SERVICE_INFO.tencent.name);
}

async function yandex({ texts, to, fetch: send, signal }: ServiceRequest): Promise<string[]> {
  const info = FREE_SERVICE_INFO.yandex;
  // The browser translator takes one string. Its reply must keep one line per input.
  const text = texts.join("\n");
  if (text.length > 5000) throw freeError(`${info.name} cannot translate a line longer than 5000 characters.`);
  const body = new URLSearchParams({
    text, brandID: "int", statLang: to, targetLang: "auto", locale: to,
    clid: "2270494", disable: "serp", use_llm_srv: "0",
  });
  const response = await send(`${info.origin}/instaserp/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    credentials: "omit",
    signal,
  });
  const reply = await readJson(response, info.name);
  const first = Array.isArray(reply) ? reply[0] as { text?: unknown; to?: unknown } | undefined : undefined;
  const lines = first?.to === to && typeof first.text === "string" ? first.text.split(/\r?\n/) : null;
  if (lines?.length !== texts.length || lines.some((line) => !line.trim())) {
    throw freeError(`${info.name} answered in an unexpected format or language.`);
  }
  return lines;
}

const SERVICES: Record<FreeTranslationService, (request: ServiceRequest) => Promise<string[]>> = {
  microsoft,
  google,
  tencent,
  yandex,
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
  service: FreeTranslationService;
  text: string;
  /** A `TRANSLATION_LANGUAGES` code. */
  targetCode: string;
  fetch?: Fetch;
  timeoutMs?: number;
}

/** The service a finished translation came from, by the origin it recorded. */
export function freeServiceForOrigin(origin: string): FreeTranslationService | null {
  return FREE_TRANSLATION_SERVICES.find((service) => FREE_SERVICE_INFO[service].origin === origin) ?? null;
}

/** Translates with the chosen service; a failure names the service and never the text. */
export async function translateFree(request: FreeTranslationRequest): Promise<string> {
  const { service } = request;
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
    if (isFreeError(error)) throw error;
    if (controller.signal.aborted) throw freeError(`${info.name} did not answer in time.`);
    throw freeError(`Could not reach ${info.name}. Check the network, or pick another service.`);
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

/** Returns the provider that completed the entire translation. */
export async function translateWithFreeService(
  request: Omit<FreeTranslationRequest, "service"> & { service: FreeTranslationChoice; yandexAvailable: boolean },
  translate = translateFree,
): Promise<{ translation: string; service: FreeTranslationService }> {
  const { service, yandexAvailable, ...input } = request;
  if (service === "yandex" && !yandexAvailable) {
    throw freeError("Yandex Translate is only available in native clients. Pick another service.");
  }
  if (service !== "automatic") return { translation: await translate({ ...input, service }), service };

  const failures: string[] = [];
  for (const candidate of FREE_TRANSLATION_SERVICES) {
    if (candidate === "yandex" && !yandexAvailable) continue;
    try {
      return { translation: await translate({ ...input, service: candidate }), service: candidate };
    } catch (error) {
      if (!(error instanceof Error) || !isFreeError(error)) throw error;
      failures.push(error.message);
    }
  }
  throw freeError(failures.join(" "));
}
