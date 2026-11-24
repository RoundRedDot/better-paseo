/**
 * Synthetic OpenAI-compatible gateways on loopback, reached through the real
 * `fetch` and the registered RPC handlers. No real service, model or key is
 * involved; this proves the wire behavior, not any provider's.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  translateTimelineItemRpc,
  translationApiKeyRpc,
  translationConfigSignature,
  translationEndpointStatusRpc,
  translationTestRpc,
  type TimelineTranslationSettings,
} from "../../shared/timeline-translation";
import { registerTimelineTranslation } from "../../server/translation/service";
import { createCredentialStore } from "../../server/translation/credential";
import { removeTranslationDirs, settingsHandle, translationSettings, translationTempDir } from "./helpers/translation-env";

const KEY = "sk-gateway-SECRET-abcdef0123";
const SOURCE = "Paragraph one mentions a private codename.\n\nParagraph two:\n\n```sh\nnpm test\n```";
const REPLY = "第一段提到一个私有代号。\n\n第二段：\n\n```sh\nnpm test\n```";

interface Received { method: string; url: string; headers: IncomingMessage["headers"]; body: string }

interface Gateway {
  server: Server;
  base: string;
  received: Received[];
  respond: (request: Received, response: ServerResponse) => void;
}

async function gateway(): Promise<Gateway> {
  const state = { received: [] as Received[], respond: (_request: Received, response: ServerResponse) => sendJson(response, 200, completion(REPLY)) };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const received = { method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks).toString("utf8") };
      state.received.push(received);
      state.respond(received, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(state, { server, base: `http://127.0.0.1:${port}` }) as Gateway;
}

function completion(content: unknown, extra: Record<string, unknown> = {}) {
  return { id: "c", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content, ...extra }, finish_reason: "stop" }] };
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

let primary: Gateway;
let other: Gateway;
const logged: string[] = [];

beforeAll(async () => {
  primary = await gateway();
  other = await gateway();
});

afterAll(async () => {
  await Promise.all([primary, other].map((entry) => new Promise((resolve) => entry.server.close(resolve))));
});

afterEach(() => {
  removeTranslationDirs();
  vi.restoreAllMocks();
  for (const entry of [primary, other]) {
    entry.received.length = 0;
    entry.respond = (_request, response) => sendJson(response, 200, completion(REPLY));
  }
  logged.length = 0;
});

/** The plugin as the host runs it: RPCs registered on a server context, inputs and outputs through their schemas. */
function plugin(initial: Partial<TimelineTranslationSettings>) {
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  }
  const dir = translationTempDir();
  const credentialPath = join(dir, "plugin-data", "translation-credential.json");
  let values = translationSettings(initial);
  const handlers = new Map<string, (input: unknown) => unknown>();
  const contracts = [translateTimelineItemRpc, translationEndpointStatusRpc, translationApiKeyRpc, translationTestRpc] as const;
  const server = {
    registerSettings: () => settingsHandle(() => values),
    handle: (contract: { name: string }, handler: (input: unknown) => unknown) => { handlers.set(contract.name, handler); },
  };
  registerTimelineTranslation(server as never, createCredentialStore(credentialPath));
  const call = async <C extends (typeof contracts)[number]>(contract: C, input: unknown) => {
    const output = await handlers.get(contract.name)!(contract.input.parse(input));
    return contract.output.parse(output) as ReturnType<C["output"]["parse"]>;
  };
  let jobs = 0;
  return {
    credentialPath,
    setSettings(patch: Partial<TimelineTranslationSettings>) {
      values = translationSettings({ ...values, ...patch });
    },
    status: () => call(translationEndpointStatusRpc, { endpoint: values.endpoint }),
    saveKey: (apiKey: string) => call(translationApiKeyRpc, { action: "save", endpoint: values.endpoint, apiKey }),
    clearKey: () => call(translationApiKeyRpc, { action: "clear", endpoint: values.endpoint }),
    test: (endpoint: string, model: string, apiKey?: string) => call(translationTestRpc, { endpoint, model, apiKey }),
    async translate(text: string) {
      const jobId = `gw-${++jobs}`;
      await call(translateTimelineItemRpc, {
        action: "start", jobId, agentId: "agent-1", text, sourceKind: "assistant_message", interfaceLanguage: "en",
        configSignature: translationConfigSignature(values, "en"),
      });
      for (let i = 0; i < 400; i += 1) {
        const state = await call(translateTimelineItemRpc, { action: "status", jobId });
        if (state.state !== "running") return state;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Timed out waiting for the gateway translation");
    },
  };
}

function noLeak(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  expect(text).not.toContain(KEY);
  expect(text).not.toContain("private codename");
}

describe("direct translation against a synthetic loopback gateway", () => {
  it("tests draft configuration through the registered RPC and a real loopback request", async () => {
    const app = plugin({ endpoint: "" });
    expect(await app.test(`${primary.base}/v1`, "draft-model", KEY)).toEqual({ ok: true });
    expect(primary.received).toHaveLength(1);
    const request = primary.received[0]!;
    expect(request.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(request.body)).toEqual({ model: "draft-model", messages: [
      { role: "system", content: "Reply with the word OK." },
      { role: "user", content: "Connection test." },
    ], stream: false });
    expect(() => statSync(app.credentialPath)).toThrow();
    noLeak(logged);
  });

  it("posts one tool-free chat completion and keeps the reply's paragraphs", async () => {
    const app = plugin({ endpoint: `${primary.base}/v1` });
    expect((await app.status()).key).toEqual({ status: "none" });
    const state = await app.translate(SOURCE);
    expect(state).toEqual({ state: "done", translation: REPLY, targetLanguageCode: "zh-CN", origin: primary.base, model: "test-model" });
    expect(primary.received).toHaveLength(1);
    const [request] = primary.received;
    expect(request!.method).toBe("POST");
    expect(request!.url).toBe("/v1/chat/completions");
    expect(request!.headers.authorization).toBeUndefined();
    expect(request!.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(request!.body);
    expect(Object.keys(body).sort()).toEqual(["messages", "model", "stream"]);
    expect(request!.body).not.toMatch(/"tools"|"tool_choice"|"functions"|"function_call"/);
    expect(body.messages[1].content.endsWith(`Text to translate:\n${SOURCE}`)).toBe(true);
    // No key, so no key file.
    expect(() => statSync(app.credentialPath)).toThrow();
    noLeak(logged);
  });

  it("sends the saved key to its own origin only, and never back to a client", async () => {
    const app = plugin({ endpoint: `${primary.base}/v1` });
    const saved = await app.saveKey(KEY);
    expect(saved.key).toEqual({ status: "saved", origin: primary.base, matches: true });
    noLeak(saved);
    noLeak(await app.status());
    if (process.platform !== "win32") expect(statSync(app.credentialPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(app.credentialPath, "utf8")).origin).toBe(primary.base);

    expect(await app.translate(SOURCE)).toMatchObject({ state: "done" });
    expect(primary.received[0]!.headers.authorization).toBe(`Bearer ${KEY}`);

    // The endpoint moves to another port: another origin. Nothing reaches it.
    app.setSettings({ endpoint: `${other.base}/v1` });
    const status = await app.status();
    expect(status.key).toEqual({ status: "saved", origin: primary.base, matches: false });
    noLeak(status);
    const refused = await app.translate(SOURCE);
    expect(refused).toMatchObject({ state: "error" });
    noLeak(refused);
    expect(other.received).toHaveLength(0);

    // Clearing the key lets the new origin be used without one.
    expect((await app.clearKey()).key).toEqual({ status: "none" });
    expect(await app.translate(SOURCE)).toMatchObject({ state: "done", origin: other.base });
    expect(other.received[0]!.headers.authorization).toBeUndefined();
    noLeak(logged);
  });

  it.each([301, 302, 303, 307, 308])("does not follow a %i redirect with the key or the text", async (status) => {
    primary.respond = (_request, response) => {
      response.writeHead(status, { Location: `${other.base}/collect` });
      response.end();
    };
    const app = plugin({ endpoint: `${primary.base}/v1` });
    await app.saveKey(KEY);
    const state = await app.translate(SOURCE);
    expect(state).toEqual({ state: "error", error: `The translation endpoint answered with a redirect (HTTP ${status}). Redirects are not followed; set the final URL in settings.` });
    expect(primary.received).toHaveLength(1);
    expect(other.received).toHaveLength(0);
    noLeak(logged);
  });

  it("refuses a refusal even when the gateway also sends text", async () => {
    primary.respond = (_request, response) => sendJson(response, 200, completion("Partial text", { refusal: "I won't translate this." }));
    const app = plugin({ endpoint: `${primary.base}/v1` });
    expect(await app.translate(SOURCE)).toEqual({ state: "error", error: "The model refused to translate this text." });
  });

  it("refuses a gateway that answers with tool calls, and runs nothing", async () => {
    primary.respond = (_request, response) => sendJson(response, 200, {
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "shell", arguments: "{\"cmd\":\"curl evil\"}" } }] } }],
    });
    const app = plugin({ endpoint: `${primary.base}/v1` });
    const state = await app.translate(SOURCE);
    expect(state).toEqual({ state: "error", error: "The translation endpoint answered with a tool call instead of text. Tool calls are never run." });
    expect(primary.received).toHaveLength(1);
  });

  it("reports an error reply without the gateway's echo of the key or text", async () => {
    // The gateway echoes the bearer key as a well-formed `code` and the text in `type`.
    primary.respond = (request, response) => sendJson(response, 401, {
      error: { message: `Bad key ${request.headers.authorization}; input ${request.body}`, type: "private codename",
        code: String(request.headers.authorization).replace("Bearer ", "") },
    });
    const app = plugin({ endpoint: `${primary.base}/v1` });
    await app.saveKey(KEY);
    const state = await app.translate(SOURCE);
    expect(primary.received[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(state).toEqual({ state: "error", error: "The translation endpoint returned HTTP 401." });
    noLeak(state);
    noLeak(logged);
  });

  it("reports a closed port without the text", async () => {
    const closed = await gateway();
    const base = closed.base;
    await new Promise((resolve) => closed.server.close(resolve));
    const app = plugin({ endpoint: `${base}/v1` });
    const state = await app.translate(SOURCE);
    expect(state).toEqual({ state: "error", error: "Could not reach the translation endpoint (ECONNREFUSED)." });
  });

  it("sends nothing while translation is unconfigured", async () => {
    const app = plugin({ endpoint: "", customModel: true, provider: "codex", model: "gpt-5" });
    const state = await app.translate(SOURCE);
    expect(state).toEqual({ state: "error", error: "Set an OpenAI-compatible translation endpoint in Better Paseo settings first." });
    expect(primary.received).toHaveLength(0);
    expect(other.received).toHaveLength(0);
  });
});
