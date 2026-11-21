import type { PaseoApi } from "@getpaseo/client";

export type ArchiveScope = "self" | "tree";

export interface ArchiveProgress {
  detached: number;
  archived: number;
}

/** Read every active agent before changing any parent links or archive state. */
export async function archiveScope(paseo: PaseoApi, parentId: string, scope: ArchiveScope, progress: ArchiveProgress): Promise<void> {
  const children = new Map<string, string[]>();
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      filter: { includeBackground: true },
      sort: [{ key: "created_at", direction: "asc" }],
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const { agent } of page.entries) {
      const parent = agent.labels?.["paseo.parent-agent-id"];
      if (!parent) continue;
      const siblings = children.get(parent) ?? [];
      siblings.push(agent.id);
      children.set(parent, siblings);
    }
    if (page.pageInfo.hasMore && !page.pageInfo.nextCursor) throw new Error("Agent list returned an incomplete page.");
    cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
  } while (cursor);

  if (scope === "self") {
    for (const child of children.get(parentId) ?? []) {
      await paseo.agents.ref(child).detach();
      progress.detached += 1;
    }
    await paseo.agents.ref(parentId).archive();
    progress.archived += 1;
    return;
  }

  const targets: string[] = [];
  const visited = new Set([parentId]);
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      visit(child);
    }
    targets.push(id);
  };
  visit(parentId);
  for (const id of targets) {
    await paseo.agents.ref(id).archive();
    progress.archived += 1;
  }
}
