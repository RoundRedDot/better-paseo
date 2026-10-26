import type { TaskCard } from "../model";

/** Active direct Paseo children; provider subagents cannot be stopped independently. */
export function activeStopChildren(card: TaskCard) {
  return card.children.filter((child) => child.kind !== "provider" && (child.status === "running" || child.status === "needs_input"));
}

/** Resolve actual agents, traversing idle parents instead of stopping their aggregate running state. */
export function stopTargets(card: TaskCard, withChildren: boolean, cardById: (id: string) => TaskCard | undefined): string[] {
  if (card.subagent) return [];
  const ids: string[] = card.stoppable ? [card.id] : [];
  if (!withChildren) return ids;
  const visited = new Set([card.id]);
  const visit = (parent: TaskCard) => {
    for (const child of parent.children) {
      if (child.kind === "provider" || visited.has(child.id)) continue;
      visited.add(child.id);
      const current = cardById(child.id);
      if (!current || current.subagent) continue;
      // Attention alone may put an idle agent in needs_input; only stop an actual stoppable turn.
      if (current.stoppable) ids.push(current.id);
      visit(current);
    }
  };
  visit(card);
  return ids;
}
