/**
 * One OpenAI-compatible chat completions request, sent from the daemon to the
 * endpoint the user configured. The body carries a system and a user message
 * only: no `tools`, `tool_choice` or functions, and nothing in the reply is
 * ever run. Errors name the failure and the HTTP status, never the request
 * text, the key, or any field of the reply: an untrusted service could echo
 * either in a field that looks harmless.
 */

export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface DirectTranslationRequest {
  requestUrl: string;
  model: string;
  system: string;
  user: string;
  /** Sent as `Authorization: Bearer`; only for the origin the key was saved for. */
  apiKey?: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("The translation endpoint's reply is too large.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("The translation endpoint's reply is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function textContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  // Some compatible servers answer with content parts; only plain text parts count.
  if (Array.isArray(content) && content.length > 0 && content.every((part) =>
    part && typeof part === "object" && (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string")) {
    return content.map((part) => (part as { text: string }).text).join("");
  }
  return null;
}

/** Reads the translation out of a chat completions reply; anything but plain text is refused. */
export function readCompletionText(body: unknown): string {
  const choices = (body as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("The translation endpoint's reply has no choices.");
  }
  const choice = choices[0] as { message?: unknown; finish_reason?: unknown } | null;
  const message = choice?.message as { content?: unknown; tool_calls?: unknown; function_call?: unknown; refusal?: unknown } | undefined;
  if (!message || typeof message !== "object") {
    throw new Error("The translation endpoint's reply has no message.");
  }
  if (message.refusal !== undefined && message.refusal !== null && message.refusal !== "") {
    // A refusal beside content means the content is not a translation to trust.
    throw new Error("The model refused to translate this text.");
  }
  if ((Array.isArray(message.tool_calls) && message.tool_calls.length > 0) || message.function_call ||
    choice?.finish_reason === "tool_calls" || choice?.finish_reason === "function_call") {
    throw new Error("The translation endpoint answered with a tool call instead of text. Tool calls are never run.");
  }
  const text = textContent(message.content);
  if (text === null) throw new Error("The translation endpoint did not answer with text.");
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The model returned an empty translation.");
  return trimmed;
}

export async function requestDirectTranslation(request: DirectTranslationRequest): Promise<string> {
  const send = request.fetch ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (request.apiKey) headers.Authorization = `Bearer ${request.apiKey}`;
  const body = JSON.stringify({
    model: request.model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    stream: false,
  });

  let response: Response;
  try {
    response = await send(request.requestUrl, {
      method: "POST",
      headers,
      body,
      // A redirect would carry the key and the text to a URL nobody chose.
      redirect: "manual",
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error("The translation endpoint did not answer in time.");
    }
    const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
    throw new Error(`Could not reach the translation endpoint${typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? ` (${code})` : ""}.`);
  }

  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`The translation endpoint answered with a redirect (HTTP ${response.status}). Redirects are not followed; set the final URL in settings.`);
  }

  if (!response.ok) {
    // The body of a failed reply is never read or shown: only the status this client saw.
    await response.body?.cancel().catch(() => {});
    throw new Error(`The translation endpoint returned HTTP ${response.status}.`);
  }

  let raw: string;
  try {
    raw = await readBounded(response);
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error("The translation endpoint did not answer in time.");
    }
    if (error instanceof Error && error.message.startsWith("The translation endpoint")) throw error;
    throw new Error("Could not read the translation endpoint's reply.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The translation endpoint did not answer with JSON.");
  }
  return readCompletionText(parsed);
}
