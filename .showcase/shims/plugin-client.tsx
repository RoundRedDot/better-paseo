import React from "react";
/**
 * Host-injected client hooks, stubbed for the offline screenshot harness.
 * Only the shapes the presentational path touches are provided.
 */
const AGENT_HANDLE = { refresh: async () => null };
// Enough of the Claude catalog for the create_agent card to label its model,
// thinking level and permission mode the way the composer does.
const PROVIDERS = {
  listModels: async (provider: string) => ({ models: provider !== "claude" ? [] : [
    { id: "claude-opus-5", label: "Opus 5", thinkingOptions: [{ id: "high", label: "High", isDefault: true }] },
  ] }),
  listModes: async (provider: string) => ({ modes: provider !== "claude" ? [] : [
    { id: "acceptEdits", label: "Accept File Edits", icon: "ShieldPlus", colorTier: "moderate" },
    { id: "bypassPermissions", label: "Bypass", icon: "ShieldOff", colorTier: "dangerous" },
  ] }),
};
const PASEO = { agents: { ref: () => AGENT_HANDLE }, providers: PROVIDERS };

export function usePaseo() {
  return PASEO as never;
}

// Titles for the agent-card fixtures, as a host that has the agents loaded returns them.
const AGENTS: Record<string, Record<string, unknown>> = {
  "58821f29-ede4-48c1-8bb2-60ed7057abca": { title: "tasks B: cards and status icons", provider: "codex", model: "gpt-6",
    status: "idle", attentionReason: "finished", cwd: "/Users/me/code/better-paseo/.worktrees/tasks-cards" },
  "db43c484-e0ea-4ae2-94f9-6f5261234567": { title: "Screenshot builder", provider: "claude", model: "claude-opus-5",
    status: "running", attentionReason: "permission", cwd: "/Users/me/code/better-paseo" },
};

export function useAgent<T>(agentId: string, selector: (agent: never) => T): T | null {
  const agent = AGENTS[agentId];
  return agent ? selector(agent as never) ?? null : null;
}

export function useWorkspace<T>(_workspaceId: string, selector: (workspace: never) => T): T | null {
  void selector;
  return null;
}

const RPC = async () => ({}) as never;

export function useRpc() {
  return RPC;
}

/**
 * A stand-in for the daemon's settings store: one record per settings id in
 * `localStorage` (so a page reload keeps it, like the daemon would), a
 * revision that changes on every write, and the host's revision check.
 * `?settings=loading|error|invalid` pins a state for the settings-page hint.
 */
type FakeRecord = { revision: string; values: unknown } | null;
const fakeListeners = new Set<() => void>();
const fakeKey = (id: string) => `showcase/daemon-settings/${id}`;
function fakeRead(id: string): FakeRecord {
  const raw = globalThis.localStorage?.getItem(fakeKey(id));
  return raw ? (JSON.parse(raw) as FakeRecord) : null;
}
function fakeWrite(id: string, values: unknown): void {
  const revision = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  globalThis.localStorage?.setItem(fakeKey(id), JSON.stringify({ revision, values }));
  for (const listener of fakeListeners) listener();
}
const pinned =
  typeof location !== "undefined" ? new URLSearchParams(location.search).get("settings") : null;

export function useSettings(definition: { id: string; schema: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: { message: string } } } }) {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    fakeListeners.add(force);
    return () => {
      fakeListeners.delete(force);
    };
  }, []);
  const record = fakeRead(definition.id);
  const revision = record?.revision ?? "missing";
  const actions = {
    saving: false,
    saveError: null,
    async save(values: unknown, against: string) {
      if ((fakeRead(definition.id)?.revision ?? "missing") !== against) return false;
      fakeWrite(definition.id, values);
      return true;
    },
    async reset() {
      fakeWrite(definition.id, {});
      return true;
    },
    async reload() {
      force();
    },
  };
  if (pinned === "loading") return { ...actions, status: "loading" } as never;
  if (pinned === "error") return { ...actions, status: "error", error: "daemon unreachable" } as never;
  if (pinned === "invalid") return { ...actions, status: "invalid", revision, error: "Expected object" } as never;
  const parsed = definition.schema.safeParse(record?.values ?? {});
  if (!parsed.success) return { ...actions, status: "invalid", revision, error: parsed.error?.message ?? "invalid" } as never;
  return { ...actions, status: "ready", revision, values: parsed.data } as never;
}
