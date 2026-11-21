/**
 * Wraps a mocked `translation.translate` caller so every `check` passes, as on a host that can
 * translate; `start` and `status` still reach the mock. The wrapper is stable per caller.
 */
const wrappers = new WeakMap<object, (input: { action?: string }) => unknown>();

export function passingTranslationCheck<T extends (input: never) => unknown>(rpc: T): T {
  let wrapped = wrappers.get(rpc);
  if (!wrapped) {
    wrapped = (input: { action?: string }) => input?.action === "check" ? Promise.resolve({ state: "ready" }) : rpc(input as never);
    wrappers.set(rpc, wrapped);
  }
  return wrapped as unknown as T;
}
