import type {
  PluginHookContext,
  PluginHookEvents,
  PluginServerContext,
  PluginSessionOpenRequest,
} from "@getpaseo/plugin/server";

/**
 * Lifecycle hooks across Paseo versions.
 *
 * Paseo 0.15 added `addHook` with renamed hooks; 0.16 deprecates the `on` and
 * `before` names (removed after 2027-04-30). Paseo 0.14 has only `on` and
 * `before`, and the manifest still accepts it, so `addHook` is used only when
 * the host provides it.
 */
const LEGACY_EVENTS = {
  "agent.turn.before": "agent.turn_started",
  "agent.turn.after": "agent.turn_ended",
  "agent.create.after": "agent.created",
  "agent.archive.after": "agent.archived",
} as const;

export type HookEventName = keyof typeof LEGACY_EVENTS;
/** Older hosts may pass no context; handlers check `context?.paseo`. */
export type HookContext = PluginHookContext | undefined;

type Hooks = Pick<PluginServerContext, "on" | "before"> & Partial<Pick<PluginServerContext, "addHook">>;

export function onHookEvent<Name extends HookEventName>(
  server: Hooks,
  name: Name,
  handler: (payload: PluginHookEvents[Name], context: HookContext) => void | Promise<void>,
): () => void {
  if (typeof server.addHook === "function") {
    return server.addHook(name, (async (payload: PluginHookEvents[Name], context: PluginHookContext) => {
      await handler(payload, context);
    }) as never);
  }
  return server.on(LEGACY_EVENTS[name], handler as never);
}

/** Watches a session open; never changes the request. */
export function onSessionOpen(
  server: Hooks,
  handler: (request: PluginSessionOpenRequest, context: HookContext) => void,
): () => void {
  if (typeof server.addHook === "function") {
    return server.addHook("agent.open.before", async ({ request }, context) => {
      handler(request, context);
    });
  }
  return server.before("agent.session_open", ({ request }, context) => {
    handler(request as PluginSessionOpenRequest, context);
  });
}
