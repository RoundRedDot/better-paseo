import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoFreeService,
  freeServiceLanguage,
  resetAutoFreeServiceForTests,
  restorePlaceholders,
  splitMarkdown,
  translateFree,
  unescapeHtml,
} from "../../shared/free-translation";
import { createTranslationStore } from "../../client/translation/store";
import { timelineTranslationSettingsSchema } from "../../shared/timeline-translation";

interface Call { url: string; init: RequestInit }

/** A fake service: answers each text with `<TO>` + the text, keeping placeholders. */
function fakeServices(options: { down?: string[]; answer?: (text: string) => string } = {}) {
  const calls: Call[] = [];
  const answer = options.answer ?? ((text: string) => `T:${text}`);
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (options.down?.some((host) => url.includes(host))) throw new TypeError("Network request failed");
    const body = JSON.parse(String(init.body));
    if (url.includes("edge.microsoft.com")) {
      return Response.json((body as string[]).map((text) => ({ translations: [{ text: answer(text), to: "x" }] })));
    }
    if (url.includes("translate-pa.googleapis.com")) {
      return Response.json([(body[0][0] as string[]).map(answer), ["en"]]);
    }
    if (url.includes("transmart.qq.com")) {
      return Response.json({ header: { ret_code: "succ" }, auto_translation: (body.source.text_list as string[]).map(answer) });
    }
    return new Response("", { status: 404 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

afterEach(() => resetAutoFreeServiceForTests());

describe("free translation: Markdown", () => {
  it("never sends code blocks, table separators or markers, and protects inline code and links", () => {
    const pieces = splitMarkdown([
      "## Summary",
      "- [ ] Run `npm test` and read [the guide](https://a.test/x \"t\") or https://b.test/y.",
      "```ts",
      "const x = 1; // comment",
      "```",
      "| Name | Status |",
      "| --- | :-: |",
      "> **Note** with {0} literal",
      "1234",
    ].join("\n"));
    const sent = pieces.filter((piece) => "send" in piece) as { send: string; tokens: string[] }[];
    expect(sent.map((piece) => piece.send)).toEqual([
      "Summary",
      "Run {0} and read {1}the guide{2} or {3}.",
      "Name",
      "Status",
      "{0}Note{1} with {2} literal",
    ]);
    expect(sent[1]!.tokens).toEqual(["`npm test`", "[", "](https://a.test/x \"t\")", "https://b.test/y"]);
    const kept = pieces.filter((piece) => "keep" in piece).map((piece) => (piece as { keep: string }).keep).join("");
    expect(kept).toContain("```ts\nconst x = 1; // comment\n```\n");
    expect(kept).toContain("| --- | :-: |\n");
    expect(kept).toContain("- [ ] ");
    expect(kept).toContain("1234");
  });

  it("restores placeholders only when each comes back exactly once", () => {
    expect(restorePlaceholders("B {1} A { 0 }", ["x", "y"])).toBe("B y A x");
    expect(restorePlaceholders("A {0}", ["x", "y"])).toBeNull();
    expect(restorePlaceholders("A {0} {0} {1}", ["x", "y"])).toBeNull();
    expect(restorePlaceholders("A {2}", ["x"])).toBeNull();
  });

  it("decodes the entities Google's HTML endpoint returns", () => {
    expect(unescapeHtml("a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39; &#x4e2d;")).toBe("a <b> & \"c\" 'd' 中");
  });
});

describe("free translation: services", () => {
  it("maps target languages to each service's codes", () => {
    expect(freeServiceLanguage("microsoft", "zh-CN")).toBe("zh-Hans");
    expect(freeServiceLanguage("microsoft", "zh-TW")).toBe("zh-Hant");
    expect(freeServiceLanguage("google", "zh-CN")).toBe("zh-CN");
    expect(freeServiceLanguage("google", "fil")).toBe("tl");
    expect(freeServiceLanguage("tencent", "zh-CN")).toBe("zh");
    expect(() => freeServiceLanguage("tencent", "sw")).toThrow("cannot translate into sw");
  });

  it("sends each service its own request shape, without a key or the conversation", async () => {
    const { fetch, calls } = fakeServices();
    const text = "Run `npm test` now.\n\n```\ncode\n```";
    for (const service of ["microsoft", "google", "tencent"] as const) {
      const result = await translateFree({ service, text, targetCode: "zh-CN", fetch });
      expect(result).toEqual({ service, translation: "T:Run `npm test` now.\n\n```\ncode\n```" });
    }
    expect(calls.map((call) => call.url)).toEqual([
      "https://edge.microsoft.com/translate/translatetext?from=&to=zh-Hans&isEnterpriseClient=false",
      "https://translate-pa.googleapis.com/v1/translateHtml",
      "https://transmart.qq.com/api/imt",
    ]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(["Run {0} now."]);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual([[["Run {0} now."], "auto", "zh-CN"], "wt_lib"]);
    expect(JSON.parse(String(calls[2]!.init.body)).target).toEqual({ lang: "zh" });
    for (const call of calls) {
      expect(String(call.init.body)).not.toContain("code");
      expect(call.init.headers).not.toHaveProperty("Authorization");
    }
  });

  it("escapes text for Google's HTML endpoint and decodes the answer", async () => {
    const { fetch, calls } = fakeServices({ answer: (text) => text });
    const result = await translateFree({ service: "google", text: "a < b & c", targetCode: "en", fetch });
    expect(JSON.parse(String(calls[0]!.init.body))[0][0]).toEqual(["a &lt; b &amp; c"]);
    expect(result.translation).toBe("a < b & c");
  });

  it("keeps a line's original text when the service drops a placeholder", async () => {
    const { fetch } = fakeServices({ answer: (text) => (text.includes("{0}") ? "lost it" : `T:${text}`) });
    const result = await translateFree({ service: "microsoft", text: "Run `x` now.\nHello", targetCode: "en", fetch });
    expect(result.translation).toBe("Run `x` now.\nT:Hello");
  });

  it("splits long text into batches", async () => {
    const { fetch, calls } = fakeServices();
    const lines = Array.from({ length: 120 }, (_, index) => `Line number ${index}`);
    const result = await translateFree({ service: "microsoft", text: lines.join("\n"), targetCode: "en", fetch });
    expect(calls.length).toBeGreaterThan(1);
    expect(result.translation.split("\n")).toEqual(lines.map((line) => `T:${line}`));
  });

  it("reports HTTP failures and timeouts by name, never the text", async () => {
    const failing = vi.fn(async () => new Response("secret echo", { status: 429 })) as unknown as typeof fetch;
    await expect(translateFree({ service: "microsoft", text: "secret", targetCode: "en", fetch: failing }))
      .rejects.toThrow("Microsoft Translator returned HTTP 429.");
    const hanging = vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as unknown as typeof fetch;
    await expect(translateFree({ service: "google", text: "secret", targetCode: "en", fetch: hanging, timeoutMs: 5 }))
      .rejects.toThrow("Google Translate did not answer in time.");
  });
});

describe("free translation: automatic service", () => {
  it("uses the first reachable service in order and keeps it for the session", async () => {
    const { fetch, calls } = fakeServices({ down: ["edge.microsoft.com"] });
    const first = await translateFree({ service: "auto", text: "Hello", targetCode: "en", fetch });
    expect(first.service).toBe("google");
    expect(autoFreeService()).toBe("google");
    expect(calls.map((call) => new URL(call.url).host)).toEqual(["edge.microsoft.com", "translate-pa.googleapis.com"]);

    calls.length = 0;
    await translateFree({ service: "auto", text: "Again", targetCode: "en", fetch });
    expect(calls.map((call) => new URL(call.url).host)).toEqual(["translate-pa.googleapis.com"]);
  });

  it("skips a service without the target language", async () => {
    const { fetch, calls } = fakeServices({ down: ["edge.microsoft.com", "googleapis.com"] });
    await expect(translateFree({ service: "auto", text: "Hello", targetCode: "sw", fetch }))
      .rejects.toThrow("No free translation service is reachable from this device.");
    // Tencent has no Swahili, so nothing is sent there.
    expect(calls.map((call) => new URL(call.url).host)).toEqual(["edge.microsoft.com", "translate-pa.googleapis.com"]);
  });

  it("does not fall back from a service the user picked", async () => {
    const { fetch, calls } = fakeServices({ down: ["edge.microsoft.com"] });
    await expect(translateFree({ service: "microsoft", text: "Hello", targetCode: "en", fetch }))
      .rejects.toThrow("Could not reach Microsoft Translator.");
    expect(calls).toHaveLength(1);
  });
});

describe("free translation: client store", () => {
  it("translates on the client without starting a daemon job", async () => {
    const free = vi.fn(async () => ({ translation: "Bonjour", service: "google" as const }));
    const call = vi.fn();
    const store = createTranslationStore({ translateFree: free });
    const settings = timelineTranslationSettingsSchema.parse({ enabled: true, targetLanguage: "fr" });
    expect(settings.mode).toBe("free");
    store.startTranslation({ sourceKey: "k", sourceKind: "assistant_message", agentId: "a", text: "Hello", interfaceLanguage: "en", settings }, call);
    await vi.waitFor(() => expect(store.read("k")?.state.state).toBe("done"));
    expect(call).not.toHaveBeenCalled();
    expect(free).toHaveBeenCalledWith({ service: "auto", text: "Hello", targetCode: "fr" });
    expect(store.read("k")?.state).toEqual({
      state: "done", translation: "Bonjour", targetLanguageCode: "fr",
      origin: "https://translate-pa.googleapis.com", model: "Google Translate",
    });
  });

  it("shows a free service's failure as the entry's error", async () => {
    const store = createTranslationStore({ translateFree: vi.fn(async () => { throw new Error("Could not reach Google Translate."); }) });
    const settings = timelineTranslationSettingsSchema.parse({ enabled: true, mode: "free", freeService: "google" });
    store.startTranslation({ sourceKey: "k", sourceKind: "reasoning", agentId: "a", text: "Hello", interfaceLanguage: "zh", settings }, vi.fn());
    await vi.waitFor(() => expect(store.read("k")?.state).toEqual({ state: "error", error: "Could not reach Google Translate." }));
  });
});
