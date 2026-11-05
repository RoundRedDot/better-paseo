import { vi } from "vitest";

export type FakeWorkspace = { id: string; activityAt: string | null; archivingAt: string | null; archivedAt?: string | null; background?: boolean };
type FetchOptions = { filter?: { includeBackground?: boolean }; page?: { limit?: number; cursor?: string } };

/**
 * The daemon's `fetch_workspaces_request` as Paseo v0.15.0 answers it
 * (server/workspace-directory.ts `listFetchEntries`): archived workspaces never
 * listed, background ones only on request, `activity_at` desc then id, keyset
 * cursor, 200 a page by default. Every call is one daemon request, and the
 * daemon rebuilds the whole directory for each.
 *
 * `ref(id).refresh()` follows the SDK (client/src/index.ts
 * `createWorkspaceHandleFactory`, same in v0.14.0, v0.15.0 and main's
 * `findWorkspace`): pages of 200 with background included until the id shows
 * up, null after the last page.
 */
export function fakeWorkspaceDirectory(records: FakeWorkspace[]) {
  const visible = (options: FetchOptions) => records
    .filter((workspace) => !workspace.archivedAt && (!workspace.background || options.filter?.includeBackground === true))
    .sort((left, right) => (Date.parse(right.activityAt ?? "") || 0) - (Date.parse(left.activityAt ?? "") || 0) || left.id.localeCompare(right.id));
  const fetchWorkspaces = vi.fn(async (options: FetchOptions = {}) => {
    let entries = visible(options);
    if (options.page?.cursor) entries = entries.slice(entries.findIndex((workspace) => workspace.id === options.page!.cursor) + 1);
    const limit = options.page?.limit ?? 200;
    const page = entries.slice(0, limit);
    const hasMore = entries.length > limit;
    return { requestId: "fake", entries: page.map((workspace) => ({ ...workspace })), pageInfo: { nextCursor: hasMore ? page[page.length - 1]!.id : null, prevCursor: options.page?.cursor ?? null, hasMore } };
  });
  const refresh = async (id: string) => {
    let cursor: string | undefined;
    do {
      const result = await fetchWorkspaces({ filter: { includeBackground: true }, page: { limit: 200, ...(cursor ? { cursor } : {}) } });
      const match = result.entries.find((entry) => entry.id === id);
      if (match) return match;
      cursor = result.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    return null;
  };
  return {
    fetchWorkspaces,
    api: { list: (options?: FetchOptions) => fetchWorkspaces(options), ref: (id: string) => ({ refresh: () => refresh(id) }) },
  };
}
