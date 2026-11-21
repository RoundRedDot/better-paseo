/**
 * TEST ONLY: the provider the lane integration tests drive
 * (`test/integration/lanes-live.test.ts`). It calls no model. A prompt is a
 * list of steps the turn takes, in order:
 *
 * - `hold:<ms>`  stay running this long
 * - `ask`        request a tool permission and wait for the answer
 * - `wait`       stay running until stopped
 * - `fail`       end the turn failed
 * - `translation-test-echo`  echo the test prompt in the reply
 *
 * Anything else (or nothing) ends the turn at once. Only type imports, so the
 * plugin installs from its directory with no build.
 */
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ProviderConnection, ProviderEvent, ProviderInput, ProviderPermissionResponse, ProviderRegistration } from "@getpaseo/plugin/server/provider";

const SUPPORTED = ["prompt.message", "session.persistence", "permission"];

interface Session {
  turn: number;
  abort: AbortController | null;
  answers: Map<string, (response: ProviderPermissionResponse) => void>;
}

type Emit = (event: ProviderEvent) => void;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function prompt(input: Extract<ProviderInput, { type: "session.prompt" }>, session: Session, emit: Emit) {
  const sessionId = input.sessionId;
  const clientMessageId = input.prompt.clientMessageId;
  if (input.prompt.input.type !== "message") {
    emit({ type: "session.prompt_result", sessionId, clientMessageId, result: { type: "failed", error: { message: "Only messages" } } });
    return;
  }
  const text = input.prompt.input.content.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join("\n");
  session.turn += 1;
  const turnId = `turn-${session.turn}`;
  const abort = new AbortController();
  session.abort = abort;
  emit({ type: "session.prompt_result", sessionId, clientMessageId, result: { type: "turn", turnId } });
  emit({ type: "session.turn", sessionId, turnId, state: "started" });
  emit({ type: "timeline.item", sessionId, item: { type: "user_message", id: `${turnId}-user`, text, clientMessageId } });
  let failed: string | null = null;
  for (const step of text.trim().split(/\s+/)) {
    if (abort.signal.aborted) break;
    if (step.startsWith("hold:")) await sleep(Number(step.slice(5)) || 0, abort.signal);
    else if (step === "wait") await sleep(24 * 60 * 60 * 1000, abort.signal);
    else if (step === "fail") failed = "bp-lanes: failed on request";
    else if (step === "ask") {
      const id = `${turnId}-ask`;
      const answered = new Promise<ProviderPermissionResponse>((resolve) => session.answers.set(id, resolve));
      emit({ type: "session.permission", sessionId, request: { id, name: "Bash", kind: "tool", title: "Run echo", input: { command: "echo lanes" } } });
      await Promise.race([answered, sleep(24 * 60 * 60 * 1000, abort.signal)]);
      session.answers.delete(id);
      emit({ type: "session.permission_resolved", sessionId, permissionId: id });
    }
  }
  const reply = text.includes("translation-test-echo") ? text : "done";
  if (!abort.signal.aborted) emit({ type: "timeline.item", sessionId, item: { type: "assistant_message", id: `${turnId}-reply`, text: failed ? "failing" : reply } });
  const state = abort.signal.aborted ? "canceled" : failed ? "failed" : "completed";
  emit({ type: "session.turn", sessionId, turnId, state, ...(failed ? { error: { message: failed } } : null) });
  if (session.abort === abort) session.abort = null;
}

function connection(capabilities: readonly string[]): ProviderConnection {
  const listeners = new Set<Emit>();
  const sessions = new Map<string, Session>();
  const emit: Emit = (event) => {
    for (const listener of listeners) listener(event);
  };
  const handle = async (input: ProviderInput) => {
    switch (input.type) {
      case "catalog":
        emit({ type: "catalog", requestId: input.requestId, catalog: { models: [{ id: "lanes", label: "Lanes", isDefault: true }], modes: [{ id: "default", label: "Default" }], defaultModel: "lanes", defaultMode: "default" } });
        return;
      case "sessions":
        emit({ type: "sessions", requestId: input.requestId, sessions: [] });
        return;
      case "session.open": {
        const persistence = input.persistence ?? { version: 1, data: { lanes: input.sessionId } };
        sessions.set(input.sessionId, { turn: 0, abort: null, answers: new Map() });
        emit({ type: "session.opened", requestId: input.requestId, sessionId: input.sessionId, capabilities, restoration: "core", persistence, title: input.config.title, cwd: input.config.cwd });
        emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
        return;
      }
      case "session.prompt": {
        const session = sessions.get(input.sessionId);
        if (session) await prompt(input, session, emit);
        return;
      }
      case "session.permission":
        sessions.get(input.sessionId)?.answers.get(input.permissionId)?.(input.response);
        return;
      case "session.interrupt":
        sessions.get(input.sessionId)?.abort?.abort();
        emit({ type: "request.completed", requestId: input.requestId });
        return;
      case "session.close":
        sessions.get(input.sessionId)?.abort?.abort();
        sessions.delete(input.sessionId);
        emit({ type: "session.closed", sessionId: input.sessionId });
        emit({ type: "request.completed", requestId: input.requestId });
        return;
      default:
        if ("requestId" in input) emit({ type: "request.failed", requestId: input.requestId, error: { message: `Unsupported: ${input.type}` } });
    }
  };
  return {
    version: 1,
    capabilities,
    async send(input) {
      queueMicrotask(() => {
        handle(input).catch((error) => {
          if ("requestId" in input) emit({ type: "request.failed", requestId: input.requestId, error: { message: String(error) } });
        });
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      for (const session of sessions.values()) session.abort?.abort();
      sessions.clear();
      listeners.clear();
    },
  };
}

const provider: ProviderRegistration = {
  id: "bp-lanes",
  label: "BP Lanes (test)",
  description: "TEST ONLY: turns that run, ask, fail or wait on command. Prompt: hold:<ms> ask wait fail",
  async connect(request) {
    if (!request.versions.includes(1)) throw new Error("Provider protocol version 1 is required");
    return connection(SUPPORTED.filter((capability) => request.capabilities.includes(capability as never)));
  },
};

export default function contribute(server: PluginServerContext) {
  server.registerProvider(provider);
  return () => {};
}
