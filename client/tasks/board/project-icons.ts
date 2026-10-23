import { useEffect } from "react";
import type { FilterOptions } from "./filter-options";

type ProjectGroup = Pick<FilterOptions["workspaceGroups"][number], "projectId" | "projectIcon">;

/** The projects among `groups` whose icon has not loaded, each once; the group of gone workspaces has none. */
export function iconlessProjects(groups: readonly ProjectGroup[]): string[] {
  return [...new Set(groups.flatMap((group) => (group.projectId && group.projectIcon === null ? [group.projectId] : [])))];
}

/**
 * Asks the data layer for each project's icon while a list shows it. Only
 * cards on screen fetch their own, so a project with no card would keep its
 * initial in a filter menu though it has an image. The data layer caches by
 * icon revision and dedupes requests in flight.
 */
export function useRequestProjectIcons(projectIds: readonly string[], request: (projectId: string) => void): void {
  const key = projectIds.join("\n");
  useEffect(() => {
    if (key) for (const projectId of key.split("\n")) request(projectId);
  }, [key, request]);
}
