import { afterEach, describe, expect, it, vi } from "vitest";
import {
  freeServiceLanguage,
  restorePlaceholders,
  splitMarkdown,
  translateFree,
  translateWithFreeService,
  unescapeHtml,
} from "../../shared/free-translation";
// The selection view imports the client graph; the store and services do not need it.
vi.mock("react-native", () => import("./helpers/rn-mock"));

import { createTranslationStore, resetTranslationStoreForTests } from "../../client/translation/store";
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
    if (url.includes("api.browser.yandex.com")) {
      const form = new URLSearchParams(String(init.body));
      return Response.json([{ to: form.get("locale"), text: form.get("text")!.split("\n").map(answer).join("\n") }]);
    }
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
      expect(result).toBe("T:Run `npm test` now.\n\n```\ncode\n```");
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
    expect(result).toBe("a < b & c");
  });

  it("keeps a line's original text when the service drops a placeholder", async () => {
    const { fetch } = fakeServices({ answer: (text) => (text.includes("{0}") ? "lost it" : `T:${text}`) });
    const result = await translateFree({ service: "microsoft", text: "Run `x` now.\nHello", targetCode: "en", fetch });
    expect(result).toBe("Run `x` now.\nT:Hello");
  });

  it("splits long text into batches", async () => {
    const { fetch, calls } = fakeServices();
    const lines = Array.from({ length: 120 }, (_, index) => `Line number ${index}`);
    const result = await translateFree({ service: "microsoft", text: lines.join("\n"), targetCode: "en", fetch });
    expect(calls.length).toBeGreaterThan(1);
    expect(result.split("\n")).toEqual(lines.map((line) => `T:${line}`));
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

describe("free translation: chosen service", () => {
  it("starts on the first service, and reads an old automatic choice as it", () => {
    expect(timelineTranslationSettingsSchema.parse({}).freeService).toBe("automatic");
    expect(timelineTranslationSettingsSchema.parse({ freeService: "auto" }).freeService).toBe("microsoft");
    expect(timelineTranslationSettingsSchema.parse({ freeService: "google" }).freeService).toBe("google");
  });

  it("uses only the service the user picked, without falling back to another", async () => {
    const { fetch, calls } = fakeServices({ down: ["edge.microsoft.com"] });
    await expect(translateFree({ service: "microsoft", text: "Hello", targetCode: "en", fetch }))
      .rejects.toThrow("Could not reach Microsoft Translator.");
    expect(calls).toHaveLength(1);
  });

  it("refuses a target language the service lacks before sending anything", async () => {
    const { fetch, calls } = fakeServices();
    await expect(translateFree({ service: "tencent", text: "Hello", targetCode: "sw", fetch }))
      .rejects.toThrow("Tencent TranSmart cannot translate into sw.");
    expect(calls).toHaveLength(0);
  });
});

describe("free translation: Automatic", () => {
  const request = { service: "automatic", text: "Hello", targetCode: "en", yandexAvailable: true } as const;
  const hosts = (calls: Call[]) => calls.map((call) => new URL(call.url).host);

  it("stops after the first successful provider", async () => {
    const { fetch, calls } = fakeServices();
    await expect(translateWithFreeService({ ...request, fetch })).resolves.toEqual({ translation: "T:Hello", service: "microsoft" });
    expect(hosts(calls)).toEqual(["edge.microsoft.com"]);
  });

  it("moves to Google after Microsoft times out", async () => {
    const { fetch, calls } = fakeServices();
    const send: typeof fetch = (url, init) => String(url).includes("edge.microsoft.com")
      ? new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))))
      : fetch(url, init);
    await expect(translateWithFreeService({ ...request, fetch: send, timeoutMs: 5 })).resolves.toEqual({
      service: "google", translation: "T:Hello",
    });
    expect(hosts(calls)).toEqual(["translate-pa.googleapis.com"]);
  });

  it("reaches Yandex last and preserves protected Markdown in the form request", async () => {
    const { fetch, calls } = fakeServices({ down: ["edge.microsoft.com", "translate-pa.googleapis.com", "transmart.qq.com"] });
    const text = "Use `npm test`.\nHello & goodbye.\n\n```\ncode\n```";
    await expect(translateWithFreeService({ ...request, text, targetCode: "zh-CN", fetch })).resolves.toEqual({
      service: "yandex", translation: "T:Use `npm test`.\nT:Hello & goodbye.\n\n```\ncode\n```",
    });
    expect(hosts(calls)).toEqual(["edge.microsoft.com", "translate-pa.googleapis.com", "transmart.qq.com", "api.browser.yandex.com"]);
    expect(calls[3]).toMatchObject({ url: "https://api.browser.yandex.com/instaserp/translate", init: { method: "POST", credentials: "omit" } });
    const form = new URLSearchParams(String(calls[3]!.init.body));
    expect(form.get("text")).toBe("Use {0}.\nHello & goodbye.");
    expect(form.get("locale")).toBe("zh");
  });

  it("reports each attempted failure and skips Yandex on web", async () => {
    const { fetch, calls } = fakeServices({ down: ["edge.microsoft.com", "translate-pa.googleapis.com", "transmart.qq.com"] });
    await expect(translateWithFreeService({ ...request, yandexAvailable: false, fetch })).rejects.toThrow(
      /Could not reach Microsoft Translator\..*Could not reach Google Translate\..*Could not reach Tencent TranSmart\./,
    );
    expect(hosts(calls)).toEqual(["edge.microsoft.com", "translate-pa.googleapis.com", "transmart.qq.com"]);
  });

  it("does not substitute another provider for a saved Yandex choice on web", async () => {
    const { fetch, calls } = fakeServices();
    await expect(translateWithFreeService({ ...request, service: "yandex", yandexAvailable: false, fetch }))
      .rejects.toThrow("Yandex Translate is only available in native clients.");
    expect(calls).toHaveLength(0);
  });

  it("rejects an unexpected Yandex language or line count", async () => {
    const fetch = vi.fn<() => Promise<Response>>();
    const selected = { ...request, service: "yandex", fetch, text: "Hello\nGood morning" } as const;
    fetch.mockResolvedValueOnce(Response.json([{ to: "fr", text: "Bonjour\nBonjour" }]));
    await expect(translateWithFreeService(selected)).rejects.toThrow("unexpected format or language");
    fetch.mockResolvedValueOnce(Response.json([{ to: "en", text: "Hello" }]));
    await expect(translateWithFreeService(selected)).rejects.toThrow("unexpected format or language");
  });
});

describe("free translation: client store", () => {
  it("translates on the client without starting a daemon job", async () => {
    const free = vi.fn(async () => "Bonjour");
    const call = vi.fn();
    const store = createTranslationStore({ translateFree: free });
    const settings = timelineTranslationSettingsSchema.parse({ enabled: true, targetLanguage: "fr", freeService: "google" });
    expect(settings.mode).toBe("free");
    store.startTranslation({ sourceKey: "k", sourceKind: "assistant_message", agentId: "a", text: "Hello", interfaceLanguage: "en", settings }, call);
    await vi.waitFor(() => expect(store.read("k")?.state.state).toBe("done"));
    expect(call).not.toHaveBeenCalled();
    expect(free).toHaveBeenCalledWith({ service: "google", text: "Hello", targetCode: "fr" });
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

  it("reports the actual provider when Automatic switches services", async () => {
    const { fetch } = fakeServices({ down: ["edge.microsoft.com", "translate-pa.googleapis.com", "transmart.qq.com"] });
    const store = createTranslationStore({ translateFree: (request) => translateFree({ ...request, fetch }) });
    const settings = timelineTranslationSettingsSchema.parse({ enabled: true, mode: "free", targetLanguage: "en" });
    store.startTranslation({ sourceKey: "k", sourceKind: "reasoning", agentId: "a", text: "Hello", interfaceLanguage: "en", settings }, vi.fn());
    await vi.waitFor(() => expect(store.read("k")?.state).toMatchObject({
      state: "done", origin: "https://api.browser.yandex.com", model: "Yandex Translate",
    }));
  });
});

describe("free translation: footer mark", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTranslationStoreForTests();
  });

  it("names the free service with its greyscale mark while running and when done; an endpoint gets none", async () => {
    const { createSelectionTranslation } = await import("../../client/translation/selection");
    const { fetch } = fakeServices();
    vi.stubGlobal("fetch", fetch);
    const sourceFor = (values: object) => {
      const snapshot = { status: "ready" as const, values: timelineTranslationSettingsSchema.parse(values), error: null, revision: "r" };
      return { snapshot: () => snapshot, subscribe: () => () => {} };
    };
    const translator = { call: vi.fn(async () => ({ state: "running" as const })) };
    const free = createSelectionTranslation({
      agentId: "a", kind: "assistant_message", text: "Hello there", streaming: false, translator,
      settings: sourceFor({ enabled: true, mode: "free", freeService: "google" }), interfaceLanguage: () => "en",
    });
    free.start();
    expect(free.view()).toMatchObject({ status: "running", modelInfo: { model: "Google Translate", mark: "service-gray:google" } });
    await vi.waitFor(() => expect(free.view()?.status).toBe("done"));
    expect(free.view()?.modelInfo).toEqual({ provider: "https://translate-pa.googleapis.com", model: "Google Translate", mode: "free", mark: "service-gray:google" });
    free.dispose();

    const endpoint = createSelectionTranslation({
      agentId: "a", kind: "assistant_message", text: "Other text", streaming: false, translator,
      settings: sourceFor({ enabled: true, mode: "openai", endpoint: "https://api.example.test/v1", endpointModel: "m" }), interfaceLanguage: () => "en",
    });
    endpoint.start();
    expect(endpoint.view()?.modelInfo).toEqual({ provider: "https://api.example.test/v1", model: "m", mode: "openai" });
    endpoint.dispose();
  });
});
