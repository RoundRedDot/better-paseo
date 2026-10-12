import {
  getEnhancerPreferences,
  subscribeEnhancerPreferences,
  type EnhancerPreferences,
} from "../preferences";

/**
 * Registers a timeline transformer that reads `key`, and registers it again
 * whenever that preference changes.
 *
 * Paseo runs a transformer once per source item and caches the result by the
 * host's combined transform, which it rebuilds whenever a plugin adds or
 * removes a transformer. A transformer that consults a preference would
 * otherwise keep the decision it made for every item already projected: on a
 * client with no local cache (iOS, a new browser) the first items are
 * transformed with the default before the daemon's settings arrive, and stay
 * that way. Registering again makes the host project them anew.
 */
export function followPreference(
  key: keyof EnhancerPreferences,
  register: () => () => void,
): () => void {
  let remove = register();
  let last = getEnhancerPreferences()[key];
  const unsubscribe = subscribeEnhancerPreferences(() => {
    const next = getEnhancerPreferences()[key];
    if (next === last) return;
    last = next;
    // Remove first: the host refuses a second transformer with the same id.
    remove();
    remove = register();
  });
  return () => {
    unsubscribe();
    remove();
  };
}
