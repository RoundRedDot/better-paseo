/**
 * The host's old `@getpaseo/plugin/client/react-native` entry, where the host
 * still has it.
 *
 * Since Paseo 0.13 that entry is `client/ui` plus `useRevealedText`. Paseo 0.16
 * deprecates both, and the entry goes away after 2027-04-20. Plain UI imports
 * come from `client/ui`, which every supported host (0.14 and later) has. This
 * module is the one place that still reads the old entry, only for what
 * patched hosts add there (`RewindMenu`, `useTimelineStickyHeader`), after
 * `client/ui`. The paced reveal no longer comes from the host: the plugin
 * carries its own (`use-revealed-text`).
 *
 * Not a static import: the bundle is CommonJS, so an import becomes a
 * top-level `require`, and once a host drops the entry its `require` throws
 * and the whole plugin fails to load. A host without the entry yields an empty
 * module instead.
 */
export type HostModule = Readonly<Record<string, unknown>>;

const EMPTY: HostModule = Object.freeze({});

export function readLegacyHostEntry(load: () => unknown): HostModule {
  let entry: unknown;
  try {
    entry = load();
  } catch {
    // The host's `require` throws for a module it does not provide.
    return EMPTY;
  }
  return entry !== null && (typeof entry === "object" || typeof entry === "function") ? (entry as HostModule) : EMPTY;
}

/** Read once: a host has the entry for the whole session or not at all. */
export const LEGACY_HOST_ENTRY = readLegacyHostEntry(() => require("@getpaseo/plugin/client/react-native"));
