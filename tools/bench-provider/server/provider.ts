import {
  negotiateProviderCapabilities,
  requireProviderCapabilities,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderInput,
  type ProviderPersistence,
  type ProviderRegistration,
  type ProviderSessionConfig,
  type ProviderTimelineItem,
} from "@getpaseo/plugin/server/provider";
import { listFixtures, loadFixture, type ReplayFixture } from "./fixtures";

const CAPABILITIES = ["prompt.message", "session.persistence", "session.list"] as const;

export interface BenchPrompt {
  command: "replay" | "list";
  fixture?: string;
  speed: number;
}

/** `fixture:markdown-long speed:2`, a bare fixture name, or `list`. `speed:max` replays instantly. */
export function parseBenchPrompt(text: string): BenchPrompt {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "list") return { command: "list", speed: 1 };
  let fixture: string | undefined;
  let speed = 1;
  for (const token of trimmed.split(/\s+/)) {
    const [key, value] = token.includes(":") ? [token.slice(0, token.indexOf(":")), token.slice(token.indexOf(":") + 1)] : ["fixture", token];
    if (key === "fixture") fixture = value;
    else if (key === "speed") {
      if (value === "max") speed = Number.POSITIVE_INFINITY;
      else if (Number.isFinite(Number(value)) && Number(value) > 0) speed = Number(value);
      else throw new Error(`Invalid speed "${value}" (use a positive number or "max")`);
    } else throw new Error(`Unknown prompt token "${token}". Use: fixture:<name> speed:<n|max> | list`);
  }
  if (!fixture) return { command: "list", speed };
  return { command: "replay", fixture, speed };
}

interface BenchSession {
  config: ProviderSessionConfig;
  persistence: ProviderPersistence;
  turn: number;
  abort: AbortController | null;
}

export function createBenchProvider(): ProviderRegistration {
  return {
    id: "bc-bench",
    label: "BC Bench Replay",
    description: "DEV ONLY: replays recorded stream fixtures for Better Paseo performance baselines. Prompt: `fixture:<name> speed:<n>` or `list`.",
    async connect(request) {
      if (!request.versions.includes(1)) throw new Error("Provider protocol version 1 is required");
      return createConnection(negotiateProviderCapabilities(request.capabilities, CAPABILITIES));
    },
  };
}

function createConnection(capabilities: readonly string[]): ProviderConnection {
  const listeners = new Set<(event: ProviderEvent) => void>();
  const sessions = new Map<string, BenchSession>();
  let closed = false;
  const emit = (event: ProviderEvent) => {
    if (closed) return;
    for (const listener of listeners) listener(event);
  };

  return {
    version: 1,
    capabilities,
    async send(input) {
      if (closed) throw new Error("Provider connection is closed");
      if ("sessionId" in input && input.type !== "session.open" && !sessions.has(input.sessionId)) {
        throw new Error(`Unknown session: ${input.sessionId}`);
      }
      requireProviderCapabilities(capabilities, input);
      queueMicrotask(() => {
        if (!closed) void dispatch(input, { sessions, emit, capabilities });
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const session of sessions.values()) session.abort?.abort();
      sessions.clear();
      listeners.clear();
    },
  };
}

interface State {
  sessions: Map<string, BenchSession>;
  emit(event: ProviderEvent): void;
  capabilities: readonly string[];
}

async function dispatch(input: ProviderInput, state: State): Promise<void> {
  try {
    switch (input.type) {
      case "catalog":
        state.emit({
          type: "catalog",
          requestId: input.requestId,
          catalog: {
            models: [{ id: "replay", label: "Stream replay", isDefault: true }],
            modes: [{ id: "replay", label: "Replay" }],
            defaultModel: "replay",
            defaultMode: "replay",
          },
        });
        return;
      case "sessions":
        state.emit({ type: "sessions", requestId: input.requestId, sessions: [] });
        return;
      case "session.open": {
        const persistence = input.persistence ?? { version: 1, data: { bench: input.sessionId } };
        state.sessions.set(input.sessionId, { config: input.config, persistence, turn: 0, abort: null });
        state.emit({
          type: "session.opened",
          requestId: input.requestId,
          sessionId: input.sessionId,
          capabilities: state.capabilities,
          restoration: "core",
          persistence,
          title: input.config.title,
          cwd: input.config.cwd,
        });
        state.emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
        return;
      }
      case "session.prompt":
        await prompt(input, state);
        return;
      case "session.interrupt":
        state.sessions.get(input.sessionId)?.abort?.abort();
        state.emit({ type: "request.completed", requestId: input.requestId });
        return;
      case "session.close":
        state.sessions.get(input.sessionId)?.abort?.abort();
        state.sessions.delete(input.sessionId);
        state.emit({ type: "session.closed", sessionId: input.sessionId });
        state.emit({ type: "request.completed", requestId: input.requestId });
        return;
      default:
        if ("requestId" in input) {
          state.emit({ type: "request.failed", requestId: input.requestId, error: { message: `Unsupported: ${input.type}` } });
        }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ("requestId" in input) state.emit({ type: "request.failed", requestId: input.requestId, error: { message } });
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function prompt(input: Extract<ProviderInput, { type: "session.prompt" }>, state: State): Promise<void> {
  const session = state.sessions.get(input.sessionId);
  if (!session) throw new Error(`Unknown session: ${input.sessionId}`);
  const sessionId = input.sessionId;
  const clientMessageId = input.prompt.clientMessageId;
  if (input.prompt.input.type !== "message") {
    state.emit({ type: "session.prompt_result", sessionId, clientMessageId, result: { type: "failed", error: { message: "Commands are not supported" } } });
    return;
  }
  const text = input.prompt.input.content
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
    .join("\n");

  session.turn += 1;
  const turnId = `turn-${session.turn}`;
  const abort = new AbortController();
  session.abort = abort;
  const item = (value: ProviderTimelineItem) => state.emit({ type: "timeline.item", sessionId, item: value });

  let plan: BenchPrompt;
  let fixture: ReplayFixture | null = null;
  let failure: string | null = null;
  try {
    plan = parseBenchPrompt(text);
    if (plan.command === "replay") fixture = loadFixture(plan.fixture as string);
  } catch (error) {
    plan = { command: "list", speed: 1 };
    failure = error instanceof Error ? error.message : String(error);
  }

  state.emit({ type: "session.prompt_result", sessionId, clientMessageId, result: { type: "turn", turnId } });
  state.emit({ type: "session.turn", sessionId, turnId, state: "started" });

  try {
    if (!fixture) {
      item({ type: "user_message", id: `${turnId}-user`, text, clientMessageId });
      const body = failure ? `${failure}\n\n` : "";
      let listing: string;
      try {
        listing = listFixtures()
          .map((f) => `- \`${f.name}\` (${f.lines.length} items, ${((f.lines[f.lines.length - 1]?.t ?? 0) / 1000).toFixed(1)}s): ${f.description}`)
          .join("\n");
      } catch (error) {
        listing = error instanceof Error ? error.message : String(error);
      }
      item({
        type: "assistant_message",
        id: `${turnId}-list`,
        text: `${body}Usage: \`fixture:<name> speed:<n|max>\` or \`list\`.\n\nFixtures:\n\n${listing}`,
      });
      state.emit({ type: "session.turn", sessionId, turnId, state: failure ? "failed" : "completed", error: failure ? { message: failure } : undefined });
      return;
    }

    await replay(fixture, plan.speed, { turnId, sessionId, clientMessageId, emitItem: item, signal: abort.signal });
    state.emit({ type: "session.turn", sessionId, turnId, state: abort.signal.aborted ? "canceled" : "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.emit({ type: "session.turn", sessionId, turnId, state: "failed", error: { message } });
  } finally {
    if (session.abort === abort) session.abort = null;
  }
}

interface ReplayContext {
  turnId: string;
  sessionId: string;
  clientMessageId: string;
  emitItem(item: ProviderTimelineItem): void;
  signal: AbortSignal;
}

/**
 * Plays one fixture. Provider timeline items for text are cumulative snapshots keyed by `id`
 * (the host diffs them into deltas), so every `append` re-emits the running text of the
 * current item; a new id starts only after a different item type intervened.
 */
async function replay(fixture: ReplayFixture, speed: number, ctx: ReplayContext): Promise<void> {
  const started = Date.now();
  let streaming: { type: "assistant_message" | "reasoning"; id: string; text: string } | null = null;
  let counter = 0;
  let firstUser = true;

  for (const line of fixture.lines) {
    if (ctx.signal.aborted) return;
    const wait = Number.isFinite(speed) ? line.t / speed - (Date.now() - started) : 0;
    if (wait > 1) await sleep(wait, ctx.signal);
    if (ctx.signal.aborted) return;
    const item = line.item as Record<string, unknown> & { type: string };
    counter += 1;

    if (item.type === "assistant_message" || item.type === "reasoning") {
      const type = item.type;
      const delta = String(item.text ?? "");
      if (!streaming || streaming.type !== type) {
        streaming = { type, id: `${ctx.turnId}-${type === "reasoning" ? "r" : "a"}${counter}`, text: "" };
      }
      streaming.text += delta;
      ctx.emitItem({ type, id: streaming.id, text: streaming.text } as ProviderTimelineItem);
      continue;
    }
    streaming = null;

    if (item.type === "tool_call") {
      ctx.emitItem({ ...item, id: String(item.callId) } as unknown as ProviderTimelineItem);
    } else if (item.type === "user_message") {
      const clientMessageId = firstUser ? ctx.clientMessageId : undefined;
      firstUser = false;
      ctx.emitItem({ type: "user_message", id: `${ctx.turnId}-u${counter}`, text: String(item.text ?? ""), clientMessageId });
    } else {
      ctx.emitItem({ ...item, id: `${ctx.turnId}-${item.type}${counter}` } as unknown as ProviderTimelineItem);
    }
  }
}
