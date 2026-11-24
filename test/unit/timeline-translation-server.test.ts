import { chmodSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRANSLATION_PROMPT,
  PREVIOUS_DEFAULT_TRANSLATION_PROMPTS,
  timelineTranslationSettingsSchema,
  translateTimelineItemRpc,
  translationApiKeyRpc,
  translationRevealKeyRpc,
  translationConfigSignature,
  translationEndpointStatusRpc,
  translationTestRpc,
  translationJobStateSchema,
} from "../../shared/timeline-translation";
import { buildTranslationPrompt, createTranslationEndpointHandlers, registerTimelineTranslation } from "../../server/translation/service";
import { isLoopbackHost, resolveTranslationEndpoint } from "../../server/translation/endpoint";
import { createCredentialStore } from "../../server/translation/credential";
import { MAX_RESPONSE_BYTES, readCompletionText } from "../../server/translation/direct";
import { createTranslationEnv, removeTranslationDirs, translationTempDir } from "./helpers/translation-env";

const KEY = "sk-test-SECRET-0123456789";
const SOURCE = "First paragraph with a secret phrase.\n\nSecond paragraph:\n- item one\n- item two";

afterEach(() => {
  removeTranslationDirs();
  vi.restoreAllMocks();
});

type Captured = { url: string; init: RequestInit & { headers: Record<string, string> } };

function completion(content: unknown, extra: Record<string, unknown> = {}) {
  return { id: "c1", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content, ...extra }, finish_reason: "stop" }] };
}

/** A fake `fetch` that records each request and answers with `respond`. */
function fakeFetch(respond: (request: Captured) => Response | Promise<Response> = () => Response.json(completion("译文"))) {
  const calls: Captured[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const request = { url: String(url), init: init as Captured["init"] };
    calls.push(request);
    return respond(request);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

function bodyOf(call: Captured) {
  return JSON.parse(String(call.init.body)) as Record<string, unknown> & { messages: Array<{ role: string; content: string }> };
}

function expectNoLeak(value: unknown, ...secrets: string[]) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) expect(text).not.toContain(secret);
}

describe("translation endpoint", () => {
  it.each([
    ["https://api.example.com/v1", "https://api.example.com/v1/chat/completions", "https://api.example.com", false],
    ["https://api.example.com/v1/", "https://api.example.com/v1/chat/completions", "https://api.example.com", false],
    ["https://api.example.com/v1/chat/completions", "https://api.example.com/v1/chat/completions", "https://api.example.com", false],
    ["https://api.example.com", "https://api.example.com/chat/completions", "https://api.example.com", false],
    ["  https://API.Example.com:8443/openai/v1  ", "https://api.example.com:8443/openai/v1/chat/completions", "https://api.example.com:8443", false],
    ["http://localhost:11434/v1", "http://localhost:11434/v1/chat/completions", "http://localhost:11434", true],
    ["http://127.0.0.1:8080/v1", "http://127.0.0.1:8080/v1/chat/completions", "http://127.0.0.1:8080", true],
    ["http://127.9.8.7/v1", "http://127.9.8.7/v1/chat/completions", "http://127.9.8.7", true],
    ["http://[::1]:1234/v1", "http://[::1]:1234/v1/chat/completions", "http://[::1]:1234", true],
  ])("accepts %s", (raw, requestUrl, origin, loopback) => {
    expect(resolveTranslationEndpoint(raw)).toEqual({ status: "ok", requestUrl, origin, loopback });
  });

  it.each([
    ["http://api.example.com/v1", "insecure_remote"],
    ["http://192.168.1.20:8080/v1", "insecure_remote"],
    ["http://0.0.0.0:8080/v1", "insecure_remote"],
    ["http://10.0.0.1/v1", "insecure_remote"],
    ["http://localhost.example.com/v1", "insecure_remote"],
    ["http://127.0.0.1.nip.io/v1", "insecure_remote"],
    ["ftp://api.example.com/v1", "unsupported_protocol"],
    ["file:///etc/passwd", "unsupported_protocol"],
    ["https://user:pass@api.example.com/v1", "embedded_credentials"],
    ["https://sk-abc@api.example.com/v1", "embedded_credentials"],
    ["https://api.example.com/v1?key=sk-abc", "query_or_fragment"],
    ["https://api.example.com/v1#frag", "query_or_fragment"],
    ["https://api.example.com/v1?", "query_or_fragment"],
    ["api.example.com/v1", "invalid_url"],
    ["not a url", "invalid_url"],
  ])("refuses %s (%s)", (raw, problem) => {
    expect(resolveTranslationEndpoint(raw)).toEqual({ status: "invalid", problem });
  });

  it("treats an empty endpoint as unset", () => {
    expect(resolveTranslationEndpoint("")).toEqual({ status: "empty" });
    expect(resolveTranslationEndpoint("   ")).toEqual({ status: "empty" });
  });

  it("counts only this machine as loopback", () => {
    for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.255.0.1", "[::1]", "::1"]) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ["0.0.0.0", "128.0.0.1", "::", "[::ffff:127.0.0.1]", "localhost.localdomain", "example.com", "169.254.169.254"]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe("translation settings migration", () => {
  it("keeps every earlier setting and sends nowhere until an endpoint and model are set", () => {
    const earlier = {
      enabled: true, customModel: true, disableThinking: false, provider: "codex", model: "gpt-5",
      thinkingOptionId: "high", targetLanguage: "ja", prompt: "Keep it terse.",
    };
    const parsed = timelineTranslationSettingsSchema.parse(earlier);
    expect(parsed).toEqual({ ...earlier, endpoint: "", endpointModel: "" });
    // The old provider and model never become an endpoint or model.
    expect(JSON.parse(translationConfigSignature(parsed, "en"))).toEqual({
      enabled: true, targetCode: "ja", endpoint: "", endpointModel: "", prompt: "Keep it terse.",
    });
  });

  it("binds a translation to the endpoint, model, target and prompt, not the legacy fields", () => {
    const base = timelineTranslationSettingsSchema.parse({ enabled: true, endpoint: "https://a.test/v1", endpointModel: "m" });
    const sig = (patch: object) => translationConfigSignature({ ...base, ...patch }, "en");
    expect(sig({ provider: "claude", model: "x", customModel: true, thinkingOptionId: "off", disableThinking: false })).toBe(sig({}));
    for (const patch of [{ endpoint: "https://b.test/v1" }, { endpointModel: "n" }, { targetLanguage: "ja" }, { prompt: "Other" }, { enabled: false }]) {
      expect(sig(patch)).not.toBe(sig({}));
    }
  });

  it("drops an endpoint or model longer than the schema allows instead of failing the record", () => {
    const parsed = timelineTranslationSettingsSchema.parse({ endpoint: `https://a.test/${"x".repeat(3000)}`, endpointModel: "m".repeat(300) });
    expect(parsed.endpoint).toBe("");
    expect(parsed.endpointModel).toBe("");
  });
});

describe("direct translation request", () => {
  it("sends one chat completions request with the text and no tools", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(completion("第一段。\n\n第二段：\n- 第一项\n- 第二项")));
    const env = createTranslationEnv({ fetch });
    const state = await env.translate(SOURCE, "tool_output");
    expect(state).toEqual({
      state: "done", translation: "第一段。\n\n第二段：\n- 第一项\n- 第二项", targetLanguageCode: "zh-CN",
      origin: "https://api.example.test", model: "test-model",
    });
    expect(translationJobStateSchema.parse(state)).toEqual(state);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe("https://api.example.test/v1/chat/completions");
    expect(call!.init.method).toBe("POST");
    expect(call!.init.redirect).toBe("manual");
    expect(call!.init.headers).toEqual({ "Content-Type": "application/json", Accept: "application/json" });
    const body = bodyOf(call!);
    expect(Object.keys(body).sort()).toEqual(["messages", "model", "stream"]);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("functions");
    expect(body.model).toBe("test-model");
    expect(body.stream).toBe(false);
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
    const user = body.messages[1]!.content;
    expect(user.startsWith(`${DEFAULT_TRANSLATION_PROMPT}\n\nTarget language:`)).toBe(true);
    expect(user).toContain("Source kind: tool output");
    // Paragraph breaks and list lines reach the model exactly as selected.
    expect(user.endsWith(`Text to translate:\n${SOURCE}`)).toBe(true);
  });

  it("sends a saved key only to the origin it was saved for", async () => {
    const { fetch, calls } = fakeFetch();
    const env = createTranslationEnv({ fetch });
    await env.credentials.save({ origin: "https://api.example.test", apiKey: KEY });
    expect(await env.translate("Hello")).toMatchObject({ state: "done" });
    expect(calls[0]!.init.headers.Authorization).toBe(`Bearer ${KEY}`);

    // Another path on the same origin keeps the key.
    env.setSettings({ endpoint: "https://api.example.test/other/v1" });
    expect(await env.translate("Hello")).toMatchObject({ state: "done" });
    expect(calls[1]!.url).toBe("https://api.example.test/other/v1/chat/completions");
    expect(calls[1]!.init.headers.Authorization).toBe(`Bearer ${KEY}`);

    // A different origin (host, port or scheme) gets neither the key nor the text.
    for (const endpoint of ["https://evil.example/v1", "https://api.example.test:8443/v1", "http://127.0.0.1:9/v1"]) {
      env.setSettings({ endpoint });
      const state = await env.translate("Hello secret phrase");
      expect(state).toMatchObject({ state: "error" });
      expect((state as { error: string }).error).toContain("The saved API key belongs to https://api.example.test");
      expectNoLeak(state, KEY, "secret phrase");
    }
    expect(calls).toHaveLength(2);

    await env.credentials.clear();
    expect(await env.translate("Hello")).toMatchObject({ state: "done", origin: "http://127.0.0.1:9" });
    expect(calls[2]!.init.headers).not.toHaveProperty("Authorization");
  });

  it.each([
    ["translation off", { enabled: false }, "disabled in settings"],
    ["no endpoint", { endpoint: "" }, "Set an OpenAI-compatible translation endpoint"],
    ["no model", { endpointModel: "" }, "Set the translation model"],
    ["remote http", { endpoint: "http://api.example.test/v1" }, "must use https://"],
    ["credentials in the URL", { endpoint: `https://${KEY}@api.example.test/v1` }, "Remove the user name or password"],
    ["key in the query", { endpoint: `https://api.example.test/v1?key=${KEY}` }, "Remove the query string"],
  ])("refuses without sending anything: %s", async (_label, patch, message) => {
    const { fetch, calls } = fakeFetch();
    const env = createTranslationEnv({ fetch, settings: patch });
    const state = await env.translate(SOURCE);
    expect(state).toMatchObject({ state: "error" });
    expect((state as { error: string }).error).toContain(message);
    expectNoLeak(state, KEY, "secret phrase");
    expect(calls).toHaveLength(0);
  });

  it("refuses a job started under other settings without sending it", async () => {
    const { fetch, calls } = fakeFetch();
    const env = createTranslationEnv({ fetch });
    const stale = translationConfigSignature({ ...env.settings, endpoint: "https://old.example/v1" }, "en");
    expect(await env.translate("Hello", "assistant_message", stale)).toEqual({ state: "error", error: "Translation configuration changed. Please retry." });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a tool call", completion(null, { tool_calls: [{ id: "t", type: "function", function: { name: "run", arguments: "{}" } }] }), "tool call"],
    ["a tool call beside text", completion("text", { tool_calls: [{ id: "t", type: "function", function: { name: "run", arguments: "{}" } }] }), "tool call"],
    ["a legacy function call", completion(null, { function_call: { name: "run", arguments: "{}" } }), "tool call"],
    ["a tool_calls finish", { choices: [{ message: { content: "" }, finish_reason: "tool_calls" }] }, "tool call"],
    ["no choices", { choices: [] }, "no choices"],
    ["no message", { choices: [{}] }, "no message"],
    ["non-text content", completion({ type: "image" }), "did not answer with text"],
    ["an image part", completion([{ type: "image_url", image_url: { url: "x" } }]), "did not answer with text"],
    ["empty text", completion("  \n "), "empty translation"],
    ["a refusal", completion(null, { refusal: "I can't help with that." }), "refused to translate"],
    ["a refusal beside text", completion("Here is some text anyway", { refusal: "I can't help with that." }), "refused to translate"],
  ])("refuses %s", async (_label, reply, message) => {
    const { fetch } = fakeFetch(() => Response.json(reply));
    const env = createTranslationEnv({ fetch });
    const state = await env.translate("Hello");
    expect(state).toMatchObject({ state: "error" });
    expect((state as { error: string }).error).toContain(message);
  });

  it("accepts text whose refusal field is empty", () => {
    expect(readCompletionText(completion("译文", { refusal: null }))).toBe("译文");
    expect(readCompletionText(completion("译文", { refusal: "" }))).toBe("译文");
  });

  it("joins plain text content parts", () => {
    expect(readCompletionText(completion([{ type: "text", text: "一\n\n" }, { type: "text", text: "二" }]))).toBe("一\n\n二");
  });

  it("names only the HTTP status, never a field of the reply, the text or the key", async () => {
    const replies = [
      // A service can echo the key, or a word of the text, in fields that look like identifiers.
      { error: { message: `Incorrect API key provided: ${KEY}. Input: ${SOURCE}`, type: "invalid_request_error", code: "invalid_api_key" } },
      { error: { code: KEY, type: KEY } },
      { error: { code: "secret", type: "paragraph" } },
    ];
    for (const reply of replies) {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { fetch } = fakeFetch(() => Response.json(reply, { status: 401 }));
      const env = createTranslationEnv({ fetch });
      await env.credentials.save({ origin: "https://api.example.test", apiKey: KEY });
      const state = await env.translate(SOURCE);
      expect(state).toEqual({ state: "error", error: "The translation endpoint returned HTTP 401." });
      expectNoLeak(state, KEY, "secret", "paragraph", "invalid_api_key");
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    }
    const { fetch: html } = fakeFetch(() => new Response(`<html>${SOURCE}</html>`, { status: 502 }));
    expect(await createTranslationEnv({ fetch: html }).translate(SOURCE)).toEqual({ state: "error", error: "The translation endpoint returned HTTP 502." });
    const { fetch: text } = fakeFetch(() => new Response(`not json ${SOURCE}`));
    expect(await createTranslationEnv({ fetch: text }).translate(SOURCE)).toEqual({ state: "error", error: "The translation endpoint did not answer with JSON." });
  });

  it("does not follow a redirect", async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 307, headers: { Location: "https://evil.example/collect" } }));
    const env = createTranslationEnv({ fetch });
    const state = await env.translate("Hello");
    expect(state).toMatchObject({ state: "error" });
    expect((state as { error: string }).error).toContain("redirect (HTTP 307)");
    expect(calls).toHaveLength(1);
  });

  it("reports an unreachable endpoint without the request", async () => {
    const failing = vi.fn(async () => {
      throw Object.assign(new TypeError(`fetch failed ${KEY} ${SOURCE}`), { cause: Object.assign(new Error(`connect ECONNREFUSED ${KEY}`), { code: "ECONNREFUSED" }) });
    }) as unknown as typeof fetch;
    const env = createTranslationEnv({ fetch: failing });
    await env.credentials.save({ origin: "https://api.example.test", apiKey: KEY });
    expect(await env.translate(SOURCE)).toEqual({ state: "error", error: "Could not reach the translation endpoint (ECONNREFUSED)." });
  });

  it("gives up on an endpoint that does not answer in time", async () => {
    const hanging = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })) as unknown as typeof fetch;
    const env = createTranslationEnv({ fetch: hanging, timeoutMs: 20 });
    expect(await env.translate("Hello")).toEqual({ state: "error", error: "The translation endpoint did not answer in time." });
  });

  it("refuses a reply larger than the limit", async () => {
    const big = "x".repeat(MAX_RESPONSE_BYTES + 1);
    const { fetch } = fakeFetch(() => new Response(big));
    expect(await createTranslationEnv({ fetch }).translate("Hello")).toEqual({ state: "error", error: "The translation endpoint's reply is too large." });
  });

  it("names the target language once in the prompt it sends", () => {
    const prompt = buildTranslationPrompt("Translate", "Japanese / 日本語 (ja)", "reasoning", "Step 1\n\nStep 2");
    expect(prompt).toContain("Target language: Japanese / 日本語 (ja)\n");
    expect(prompt.match(/\(ja\)/g)).toHaveLength(1);
    expect(prompt).toContain("Source kind: assistant reasoning");
    expect(prompt.endsWith("Text to translate:\nStep 1\n\nStep 2")).toBe(true);
  });
});

describe("translation API key storage", () => {
  it("writes the key 0600 through a temporary file and reads it back", async () => {
    const env = createTranslationEnv();
    await env.credentials.save({ origin: "https://api.example.test", apiKey: KEY });
    if (process.platform !== "win32") expect(statSync(env.credentialPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(dirname(env.credentialPath))).toEqual(["translation-credential.json"]);
    expect(JSON.parse(readFileSync(env.credentialPath, "utf8"))).toEqual({ version: 1, origin: "https://api.example.test", apiKey: KEY });
    expect(await env.credentials.read()).toEqual({ origin: "https://api.example.test", apiKey: KEY });
    await env.credentials.save({ origin: "https://other.test", apiKey: "sk-second" });
    expect(await env.credentials.read()).toEqual({ origin: "https://other.test", apiKey: "sk-second" });
    expect(readdirSync(dirname(env.credentialPath))).toEqual(["translation-credential.json"]);
    await env.credentials.clear();
    expect(await env.credentials.read()).toBeNull();
    expect(readdirSync(dirname(env.credentialPath))).toEqual([]);
  });

  it.runIf(process.platform !== "win32")("refuses a key file others can read", async () => {
    const { fetch, calls } = fakeFetch();
    const env = createTranslationEnv({ fetch });
    await env.credentials.save({ origin: "https://api.example.test", apiKey: KEY });
    chmodSync(env.credentialPath, 0o644);
    await expect(createCredentialStore(env.credentialPath).read()).rejects.toThrow("readable by other users");
    const state = await env.translate("Hello");
    expect(state).toEqual({ state: "error", error: "The translation API key file is readable by other users. Clear the key and save it again." });
    expect(calls).toHaveLength(0);
  });

  it("says a damaged file is damaged without quoting it", async () => {
    const path = `${translationTempDir()}/translation-credential.json`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `{"version":1,"origin":"https://a.test","apiKey":"${KEY} with space"}`, { mode: 0o600 });
    const store = createCredentialStore(path);
    const error = await store.read().then(() => null, (reason: Error) => reason);
    expect(error?.message).toBe("The translation API key file is damaged. Clear the key and save it again.");
    expectNoLeak(error?.message, KEY);
  });

  it("answers status and saves without ever returning the key", async () => {
    const env = createTranslationEnv();
    const handlers = createTranslationEndpointHandlers(env.credentials, env.handle);
    expect(await handlers.status({ endpoint: "https://api.example.test/v1" })).toEqual({
      endpoint: { status: "ok", requestUrl: "https://api.example.test/v1/chat/completions", origin: "https://api.example.test", loopback: false },
      key: { status: "none" },
    });
    const saved = await handlers.apiKey({ action: "save", endpoint: "https://api.example.test/v1", apiKey: `  ${KEY}\n` });
    expect(saved.key).toEqual({ status: "saved", origin: "https://api.example.test", matches: true, masked: "sk-t********6789" });
    expect(await handlers.revealKey()).toEqual({ origin: "https://api.example.test", apiKey: KEY });
    expectNoLeak(saved, KEY);
    expect(await env.credentials.read()).toEqual({ origin: "https://api.example.test", apiKey: KEY });
    const moved = await handlers.status({ endpoint: "https://elsewhere.test/v1" });
    expect(moved.key).toEqual({ status: "saved", origin: "https://api.example.test", matches: false, masked: "sk-t********6789" });
    expectNoLeak(moved, KEY);
    expect(translationEndpointStatusRpc.output.parse(moved)).toEqual(moved);

    env.setSettings({ endpoint: "" });
    await expect(handlers.apiKey({ action: "save", endpoint: "", apiKey: KEY })).rejects.toThrow("Set the translation endpoint");
    env.setSettings({ endpoint: "http://api.example.test/v1" });
    await expect(handlers.apiKey({ action: "save", endpoint: "http://api.example.test/v1", apiKey: KEY })).rejects.toThrow("must use https://");
    env.setSettings({ endpoint: "https://api.example.test/v1" });
    for (const bad of ["", "has space", "line\nbreak", "ключ"]) {
      const error = await handlers.apiKey({ action: "save", endpoint: "https://api.example.test/v1", apiKey: bad }).then(() => null, (reason: Error) => reason);
      expect(error?.message).toBe("The API key must be printable ASCII without spaces.");
    }
    // A refused save keeps the earlier key.
    expect(await env.credentials.read()).toEqual({ origin: "https://api.example.test", apiKey: KEY });

    const cleared = await handlers.apiKey({ action: "clear", endpoint: "https://api.example.test/v1" });
    expect(cleared.key).toEqual({ status: "none" });
    expect(await handlers.revealKey()).toBeNull();
  });

  it.each(["a", "12345678", "123456789"]) ("masks key %s without overlapping visible parts", async (key) => {
    const env = createTranslationEnv();
    await env.credentials.save({ origin: "https://api.example.test", apiKey: key });
    const status = await createTranslationEndpointHandlers(env.credentials, env.handle).status({ endpoint: "https://api.example.test/v1" });
    expect(status.key).toMatchObject({ masked: key.length <= 8 ? "*".repeat(key.length) : "1234********6789" });
  });

  it("binds a key only to the endpoint saved in settings, never an unsaved or outdated one", async () => {
    const env = createTranslationEnv();
    const handlers = createTranslationEndpointHandlers(env.credentials, env.handle);
    // The client still shows (or sends) an address the settings do not hold.
    for (const endpoint of ["https://draft.example.test/v1", "https://api.example.test/v2", ""]) {
      const error = await handlers.apiKey({ action: "save", endpoint, apiKey: KEY }).then(() => null, (reason: Error) => reason);
      expect(error?.message).toBe("The translation endpoint in settings changed. Check it, then save the key again.");
    }
    expect(await env.credentials.read()).toBeNull();
    expect(() => statSync(env.credentialPath)).toThrow();
    // Surrounding spaces are not a different address; the schema trims the saved one too.
    await handlers.apiKey({ action: "save", endpoint: " https://api.example.test/v1 ", apiKey: KEY });
    expect(await env.credentials.read()).toEqual({ origin: "https://api.example.test", apiKey: KEY });
  });

  it("creates no key file for an endpoint used without a key", async () => {
    const { fetch } = fakeFetch();
    const env = createTranslationEnv({ fetch, settings: { endpoint: "http://127.0.0.1:11434/v1" } });
    const handlers = createTranslationEndpointHandlers(env.credentials, env.handle);
    expect((await handlers.status({ endpoint: env.settings.endpoint })).key).toEqual({ status: "none" });
    expect(await env.translate("Hello")).toMatchObject({ state: "done", origin: "http://127.0.0.1:11434" });
    expect(() => statSync(env.credentialPath)).toThrow();
  });
});

describe("connection testing", () => {
  it("uses draft settings and sends only a fixed prompt without tools", async () => {
    const env = createTranslationEnv({ fetch: vi.fn(), settings: { endpoint: "https://old.example.test/v1" } });
    const fetch = vi.fn(async () => new Response(JSON.stringify(completion("OK")), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      const handlers = createTranslationEndpointHandlers(env.credentials, env.handle);
      await expect(handlers.test({ endpoint: "https://api.example.test/v1", model: "test-model", apiKey: KEY })).resolves.toEqual({ ok: true });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.example.test/v1/chat/completions");
      expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
      expect(JSON.parse(String(init.body))).toEqual({ model: "test-model", messages: [
        { role: "system", content: "Reply with the word OK." },
        { role: "user", content: "Connection test." },
      ], stream: false });
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not send a saved key to another origin", async () => {
    const env = createTranslationEnv({ fetch: vi.fn() });
    await env.credentials.save({ origin: "https://old.example.test", apiKey: KEY });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const handlers = createTranslationEndpointHandlers(env.credentials, env.handle);
      await expect(handlers.test({ endpoint: "https://new.example.test/v1", model: "model" })).rejects.toThrow("another endpoint");
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("translation registration", () => {
  it("serves translate, endpoint status and the write-only key RPC, and nothing that reads models", async () => {
    const names: string[] = [];
    const server = {
      registerSettings: () => ({ read: async () => ({ status: "invalid", revision: "r", error: "unused" }) }),
      handle: (contract: { name: string }) => { names.push(contract.name); },
    };
    registerTimelineTranslation(server as never, createCredentialStore(`${translationTempDir()}/k.json`));
    expect(names.sort()).toEqual([translateTimelineItemRpc.name, translationApiKeyRpc.name, translationRevealKeyRpc.name, translationEndpointStatusRpc.name, translationTestRpc.name].sort());
  });
});

describe("default timeline translation prompt", () => {
  const legacyDefault =
    "Translate the supplied text into the target language. Preserve Markdown, code blocks, inline code, commands, paths, links, and technical identifiers. Return only the translation, without explanations.";

  it("reads an untouched earlier default as the current default and keeps every other prompt", () => {
    expect(PREVIOUS_DEFAULT_TRANSLATION_PROMPTS).toEqual([legacyDefault]);
    const promptOf = (values: unknown) => timelineTranslationSettingsSchema.parse(values).prompt;
    expect(promptOf({})).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(promptOf({ prompt: "   " })).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(promptOf({ prompt: legacyDefault })).toBe(DEFAULT_TRANSLATION_PROMPT);
    // The schema already trims every prompt, so surrounding whitespace is not an edit.
    expect(promptOf({ prompt: `\n${legacyDefault}  ` })).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(promptOf({ prompt: DEFAULT_TRANSLATION_PROMPT })).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(promptOf({ prompt: "Keep it terse." })).toBe("Keep it terse.");
    const extended = `${legacyDefault} Use a formal register.`;
    expect(promptOf({ prompt: extended })).toBe(extended);
  });

  it("binds translations to the mapped prompt on both client and server", async () => {
    const mapped = timelineTranslationSettingsSchema.parse({ prompt: legacyDefault });
    const fresh = timelineTranslationSettingsSchema.parse({});
    expect(translationConfigSignature(mapped, "en")).toBe(translationConfigSignature(fresh, "en"));
    expect(translationConfigSignature({ ...mapped, prompt: legacyDefault }, "en")).not.toBe(translationConfigSignature(mapped, "en"));

    const { fetch, calls } = fakeFetch();
    const env = createTranslationEnv({ fetch, settings: { prompt: legacyDefault } });
    expect((await env.translate("Run `npm test`.")).state).toBe("done");
    const user = bodyOf(calls[0]!).messages[1]!.content;
    expect(user.startsWith(`${DEFAULT_TRANSLATION_PROMPT}\n\nTarget language:`)).toBe(true);
    expect(user).not.toContain("Translate the supplied text");
  });
});
