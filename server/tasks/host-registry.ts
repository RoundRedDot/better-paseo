/**
 * Multi-host support for better-paseo's Tasks board.
 *
 * better-paseo historically talks to a single Paseo daemon (the one running
 * this plugin, reached via `PASEO_HOME`). To show agents from more than one
 * host on one board, we need a registry of daemons keyed by host id, each
 * connected on demand with its own credentials.
 *
 * This module is the foundation: it defines the registry shape and a factory
 * that builds one `HostDaemonAccess` per host. It is intentionally minimal and
 * keeps the single-host path working unchanged — callers that pass a single
 * `HostDaemonAccess` keep working; multi-host callers pass a `HostRegistry`.
 *
 * NOTE: remote-host credential resolution (relay tokens / Paseo cloud auth) is
 * not implemented here; `connect` for a non-local host currently returns null
 * until that plumbing lands. See the tracking issue for the multi-host feature.
 */

import type { HostDaemonAccess } from "./register";

export interface HostDescriptor {
  /** Stable host id (matches Paseo's host id, e.g. "srv_..." or a hostname). */
  id: string;
  /** Human-readable label shown in the board's host filter. */
  label: string;
  /** Whether this is the daemon running this plugin process. */
  local: boolean;
}

export interface HostRegistry {
  /** All known hosts, including offline ones. */
  list(): HostDescriptor[];
  /** Access object for one host; null if unknown. */
  get(hostId: string): HostDaemonAccess | null;
  /** Connect to a host on demand; resolves to its daemon or null on failure. */
  connect(hostId: string): Promise<import("./provider-subagents").HostDaemon | null>;
}

/**
 * Build a registry from a map of host id -> connect function. Used by tests
 * and by the single-host default, which wraps one daemon in a one-entry map.
 */
export function createHostRegistry(
  hosts: HostDescriptor[],
  accessByHost: Record<string, HostDaemonAccess>,
): HostRegistry {
  const access = new Map<string, HostDaemonAccess>();
  for (const host of hosts) {
    const a = accessByHost[host.id];
    if (!a) continue;
    access.set(host.id, a);
  }
  return {
    list: () => [...hosts],
    get: (hostId) => access.get(hostId) ?? null,
    connect: async (hostId) => {
      const a = access.get(hostId);
      if (!a) return null;
      return a.connect();
    },
  };
}

/**
 * Wrap a single daemon access as a one-host registry. Keeps existing
 * single-host callers working while the board learns to iterate hosts.
 */
export function singleHostRegistry(host: HostDaemonAccess, id = "local", label = "This host", local = true): HostRegistry {
  return createHostRegistry([{ id, label, local }], { [id]: host });
}
