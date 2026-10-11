/**
 * Host-injected client hooks, stubbed for the offline screenshot harness.
 * Only the shapes the presentational path touches are provided.
 */
const AGENT_HANDLE = { refresh: async () => null };
const PASEO = { agents: { ref: () => AGENT_HANDLE } };

export function usePaseo() {
  return PASEO as never;
}

export function useAgent<T>(_agentId: string, selector: (agent: never) => T): T | null {
  void selector;
  return null;
}

export function useWorkspace<T>(_workspaceId: string, selector: (workspace: never) => T): T | null {
  void selector;
  return null;
}

const RPC = async () => ({}) as never;

export function useRpc() {
  return RPC;
}

export function useSettings() {
  return { status: "ready" } as never;
}
