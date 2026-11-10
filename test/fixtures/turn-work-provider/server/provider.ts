import { negotiateProviderCapabilities, type ProviderEvent, type ProviderRegistration, type ProviderTimelineItem } from "@getpaseo/plugin/server/provider";

/** Synthetic history for a disposable daemon. No model, credentials or external requests. */
export function fixtureProvider(): ProviderRegistration {
  return {
    id: "turn-work-fixture", label: "Turn work fixture",
    async status() { return { available: true }; },
    async connect(request) {
      const capabilities = negotiateProviderCapabilities(request.capabilities, ["prompt.message", "session.persistence"]);
      const listeners = new Set<(event: ProviderEvent) => void>();
      const sessions = new Map<string, { turn: number; history: ProviderTimelineItem[] }>();
      let closed = false;
      const emit = (event: ProviderEvent) => { if (!closed) for (const listener of listeners) listener(event); };
      const catalog = { models: [{ id: "fixture", label: "Synthetic fixture" }], modes: [], thinkingOptions: [], defaultModel: "fixture" };
      return {
        version: 1, capabilities,
        onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async close() { closed = true; listeners.clear(); },
        async send(input) {
          if (input.type === "catalog") { emit({ type: "catalog", requestId: input.requestId, catalog }); return; }
          if (input.type === "sessions") { emit({ type: "sessions", requestId: input.requestId, sessions: [] }); return; }
          if (input.type === "session.open") {
            const restored = input.persistence?.data as { turn: number; history: ProviderTimelineItem[] } | undefined;
            const session = sessions.get(input.sessionId) ?? restored ?? { turn: 0, history: [] };
            sessions.set(input.sessionId, session);
            emit({ type: "session.opened", requestId: input.requestId, sessionId: input.sessionId, cwd: input.config.cwd,
              capabilities, restoration: "core", persistence: { version: 1, data: JSON.parse(JSON.stringify(session)) } });
            emit({ type: "session.config", sessionId: input.sessionId, config: { ...catalog, model: "fixture", settings: [] } });
            if (input.history === "replay") for (const item of session.history) emit({ type: "timeline.item", sessionId: input.sessionId, item });
            emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
            return;
          }
          if (input.type === "session.prompt") {
            const session = sessions.get(input.sessionId)!;
            const turnId = `fixture-turn-${++session.turn}`;
            const text = input.prompt.input.type === "message" ? input.prompt.input.content
              .filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join(" ") : "fixture";
            const publish = (item: ProviderTimelineItem) => {
              const index = session.history.findIndex((previous) => previous.id === item.id);
              if (index < 0) session.history.push(item); else session.history[index] = item;
              emit({ type: "timeline.item", sessionId: input.sessionId, item });
            };
            publish({ type: "user_message", id: `user:${turnId}`, text, clientMessageId: input.prompt.clientMessageId });
            emit({ type: "session.prompt_result", sessionId: input.sessionId, clientMessageId: input.prompt.clientMessageId,
              result: { type: "turn", turnId } });
            emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "started" });
            void (async () => {
              const count = text.includes("long") ? 80 : 12;
              const delay = text.includes("slow") ? 120 : 5;
              for (let index = 0; index < count && !closed; index++) {
                publish({ type: "reasoning", id: `thought:${turnId}:${index}`, text: `Inspecting fixture step ${index + 1}.` });
                const callId = `call:${turnId}:${index}`;
                publish({ type: "tool_call", id: callId, callId, name: "shell", status: "running", error: null,
                  detail: { type: "plain_text", label: `fixture-step-${index + 1}`, text: "Synthetic command" } });
                await new Promise((resolve) => setTimeout(resolve, delay));
                const failed = index === 3 || index === 8;
                publish({ type: "tool_call", id: callId, callId, name: "shell",
                  ...(failed ? { status: "failed" as const, error: "Synthetic failure" } : { status: "completed" as const, error: null }),
                  detail: { type: "plain_text", label: `fixture-step-${index + 1}`, text: failed ? "Synthetic failure" : "Synthetic success" } });
              }
              if (closed) return;
              publish({ type: "assistant_message", id: `reply:${turnId}`, text: `Fixture turn ${session.turn} finished. The final answer stays visible.` });
              emit({ type: "session.persistence", sessionId: input.sessionId, persistence: { version: 1, data: JSON.parse(JSON.stringify(session)) } });
              emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "completed" });
            })();
            return;
          }
          if ("requestId" in input) emit({ type: "request.completed", requestId: input.requestId });
        },
      };
    },
  };
}
