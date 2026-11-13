import type { PluginTimelineTransformResult } from "@getpaseo/plugin";
import type { Entry } from "./turn-duration";
import { turnWorkCursorKey, turnWorkItemKey, type TurnWorkGroup } from "./turn-work";
import { getDisclosure } from "./disclosure-store";
import { followPreference } from "./follow-preference";
import { getEnhancerPreferences } from "../preferences";

/** Identity supplied by the host, never inferred from content or a renderer. */
export interface TurnWorkSourceIdentity {
  agentId: string;
  sourceId: string;
  sourceCursor: { epoch: string; seq: number };
}

// A store publishes complete snapshots. Projection only reads them; source
// clones, renderer mounts and virtualization cannot change group membership.
const agents = new Map<string, ReadonlyMap<string, TurnWorkGroup>>();
const listeners = new Set<() => void>();
const MAX_AGENTS = 128;
const MAX_MEMBERS = 20_000;
let memberCount = 0;
let queued = false;
let generation = 0;

export function turnWorkDisclosureKey(agentId: string, groupKey: string): string {
  return `turn-work:${agentId}:${groupKey}`;
}

/** One re-projection per store commit or disclosure action. */
export function invalidateTurnWorkProjection(): void {
  if (queued) return;
  queued = true;
  const ticket = generation;
  void Promise.resolve().then(() => {
    if (ticket !== generation) return;
    queued = false;
    for (const listener of listeners) listener();
  });
}

export function subscribeTurnWorkProjection(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function resetTurnWorkProjection(): void {
  generation++;
  queued = false;
  agents.clear();
  memberCount = 0;
}

function sameGroup(left: TurnWorkGroup, right: TurnWorkGroup): boolean {
  return left === right || (left.epoch === right.epoch && left.key === right.key && left.anchor === right.anchor &&
    left.failed === right.failed && left.members.length === right.members.length &&
    left.members.every((member, index) => member === right.members[index]));
}

function sameWork(left: ReadonlyMap<string, TurnWorkGroup>, right: ReadonlyMap<string, TurnWorkGroup>): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  const compared = new Map<TurnWorkGroup, TurnWorkGroup>();
  for (const [key, group] of left) {
    const next = right.get(key);
    if (!next) return false;
    if (compared.get(group) === next) continue;
    if (!sameGroup(group, next)) return false;
    compared.set(group, next);
  }
  return true;
}

/**
 * Publish authoritative membership, including an empty map on failed reads,
 * replacement, reconnect and store disposal. Partial groups remain visible.
 * Capacity exhaustion also leaves rows visible instead of evicting an active
 * group and starting another projection/observation cycle.
 * The result lets the store retain an offscreen event lease only for admitted
 * groups, so observation lifetime shares this registry's capacity bound.
 */
export function updateTurnWorkGroups(agentId: string, work: ReadonlyMap<string, TurnWorkGroup>): boolean {
  if (!agentId) return false;
  const previous = agents.get(agentId);
  if (previous && sameWork(previous, work)) return previous.size > 0;
  const available = MAX_MEMBERS - memberCount + (previous?.size ?? 0);
  const next = new Map<string, TurnWorkGroup>();
  if ((previous || agents.size < MAX_AGENTS) && work.size <= available) {
    const checked = new Set<TurnWorkGroup>();
    for (const group of work.values()) {
      if (checked.has(group)) continue;
      checked.add(group);
      if (!group.epoch || group.members.length < 2 || !group.members.includes(group.anchor) ||
        new Set(group.members).size !== group.members.length ||
        !group.members.every((key) => work.get(key) === group)) continue;
      for (const key of group.members) next.set(key, group);
    }
  }
  if ((!previous && !next.size) || (previous && sameWork(previous, next))) return next.size > 0;
  memberCount += next.size - (previous?.size ?? 0);
  if (next.size) agents.set(agentId, next); else agents.delete(agentId);
  invalidateTurnWorkProjection();
  return next.size > 0;
}

export function followTurnWorkProjection(register: () => () => void): () => void {
  return followPreference("autoCollapseTurnWork", () => {
    let remove = register();
    const stop = subscribeTurnWorkProjection(() => {
      if (!getEnhancerPreferences().autoCollapseTurnWork) return;
      remove();
      remove = register();
    });
    return () => { stop(); remove(); };
  });
}

export function projectTurnWork(
  item: Entry["item"], phase: string, original: PluginTimelineTransformResult | undefined,
  identity?: { agentId?: string; sourceId?: string; sourceCursor?: TurnWorkSourceIdentity["sourceCursor"] | null },
): PluginTimelineTransformResult | undefined {
  // Released Paseo callbacks only provide item/phase. Returning exactly the
  // original result is intentional: no guessed owner, binding, or refresh.
  if (!identity || typeof identity.agentId !== "string" || !identity.agentId ||
    typeof identity.sourceId !== "string" || !identity.sourceId ||
    !identity.sourceCursor || typeof identity.sourceCursor.epoch !== "string" || !identity.sourceCursor.epoch ||
    !Number.isSafeInteger(identity.sourceCursor.seq) || identity.sourceCursor.seq < 0 ||
    phase === "streaming" || !original?.items.length ||
    (item.type !== "reasoning" && item.type !== "tool_call") ||
    (item.type === "tool_call" && (item.status === "running" ||
      item.metadata?.approved === false || item.metadata?.questions))) return original;
  const rawKey = turnWorkItemKey(item, 0);
  if (!rawKey) return original;
  const sourceKey = turnWorkCursorKey(rawKey, identity.sourceCursor.seq);
  const workSource = { agentId: identity.agentId, sourceId: identity.sourceId,
    sourceCursor: { epoch: identity.sourceCursor.epoch, seq: identity.sourceCursor.seq } };
  const candidate = agents.get(workSource.agentId)?.get(sourceKey);
  const group = candidate?.epoch === workSource.sourceCursor.epoch ? candidate : undefined;
  const summary = group && sourceKey === group.anchor ? {
    type: "plugin" as const, kind: "omp-turn-work", version: 1,
    data: { groupKey: group.key, anchor: group.anchor, count: group.members.length, failed: group.failed },
  } : null;
  if (group && getDisclosure(turnWorkDisclosureKey(workSource.agentId, group.key)) !== true) {
    // Empty replacement removes the host cell and its spacing. The anchor's
    // self-contained summary remains, even before its store hook mounts.
    return { items: summary ? [summary] : [] };
  }
  const items = original.items.map((row) => ({ ...row,
    data: { ...row.data as Record<string, never>, workSource } }));
  // Omit output ids so Paseo derives each id from sourceId/index. A constant
  // id would collide across sources in the host's virtualized layout map.
  return { items: summary ? [summary, ...items] : items };
}
