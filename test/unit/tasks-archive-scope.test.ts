import { describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { archiveScope } from "../../client/tasks/actions/archive-scope";

const child = (id: string, parent: string) => ({ agent: { id, labels: { "paseo.parent-agent-id": parent } } });

function fixture() {
  const calls: string[] = [];
  const list = vi.fn(async (options: { page: { cursor?: string } }) => options.page.cursor
    ? { entries: [child("grandchild", "child-a"), child("child-b", "parent")], pageInfo: { hasMore: false, nextCursor: null } }
    : { entries: [child("child-a", "parent"), child("other", "unrelated")], pageInfo: { hasMore: true, nextCursor: "second" } });
  const detach = vi.fn(async (id: string) => { calls.push(`detach:${id}`); });
  const archive = vi.fn(async (id: string) => { calls.push(`archive:${id}`); });
  const paseo = { agents: { list, ref: (id: string) => ({ detach: () => detach(id), archive: () => archive(id) }) } } as unknown as PaseoApi;
  return { paseo, list, calls, detach, archive };
}

describe("scoped archive through the existing host", () => {
  it("reads every page and detaches direct children before archiving only the parent", async () => {
    const host = fixture();
    const progress = { detached: 0, archived: 0 };
    await archiveScope(host.paseo, "parent", "self", progress);
    expect(host.list).toHaveBeenCalledTimes(2);
    expect(host.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: { limit: 200, cursor: "second" } }));
    expect(host.calls).toEqual(["detach:child-a", "detach:child-b", "archive:parent"]);
    expect(progress).toEqual({ detached: 2, archived: 1 });
  });

  it("archives the entire tree from the leaves, including later pages", async () => {
    const host = fixture();
    const progress = { detached: 0, archived: 0 };
    await archiveScope(host.paseo, "parent", "tree", progress);
    expect(host.calls).toEqual(["archive:grandchild", "archive:child-a", "archive:child-b", "archive:parent"]);
    expect(progress).toEqual({ detached: 0, archived: 4 });
  });

  it("does not change anything when a page fails", async () => {
    const host = fixture();
    host.list.mockResolvedValueOnce({ entries: [child("child-a", "parent")], pageInfo: { hasMore: true, nextCursor: "second" } }).mockRejectedValueOnce(new Error("list failed"));
    await expect(archiveScope(host.paseo, "parent", "self", { detached: 0, archived: 0 })).rejects.toThrow("list failed");
    expect(host.calls).toEqual([]);
  });

  it("stops after a detach or archive fails and records completed operations", async () => {
    const host = fixture();
    host.detach.mockImplementationOnce(async (id) => { host.calls.push(`detach:${id}`); }).mockRejectedValueOnce(new Error("detach failed"));
    const progress = { detached: 0, archived: 0 };
    await expect(archiveScope(host.paseo, "parent", "self", progress)).rejects.toThrow("detach failed");
    expect(host.calls).toEqual(["detach:child-a"]);
    expect(progress).toEqual({ detached: 1, archived: 0 });
    const tree = fixture();
    tree.archive.mockImplementationOnce(async (id) => { tree.calls.push(`archive:${id}`); }).mockRejectedValueOnce(new Error("archive failed"));
    const treeProgress = { detached: 0, archived: 0 };
    await expect(archiveScope(tree.paseo, "parent", "tree", treeProgress)).rejects.toThrow("archive failed");
    expect(tree.calls).toEqual(["archive:grandchild"]);
    expect(treeProgress).toEqual({ detached: 0, archived: 1 });
  });
});
