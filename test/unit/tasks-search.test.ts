import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => import("./helpers/rn-mock"));

import { filterLanes } from "../../client/tasks/data";
import { matchesTaskSearch } from "../../client/tasks/data/search";
import { EMPTY_FILTERS, LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../../client/tasks/model";
import { sampleCards } from "../../client/tasks/sample-cards";

const card: TaskCard = {
  ...sampleCards()[0]!,
  id: "task-uuid-123",
  title: "Fix search behavior",
  provider: "omp",
  providerLabel: "Oh My Pi",
  model: "vendor/model-v3",
  modelLabel: "Example Model 3",
  location: {
    ...sampleCards()[0]!.location,
    projectName: "Project Apple",
    workspaceName: null,
    workspaceTitle: "Raw Workspace",
    branch: "feature/search",
    folder: null,
    folderName: "HiddenFolder",
    cwd: "/Users/dev/Projects/HiddenFolder",
    pullRequest: { number: 987, title: "Improve find behavior", url: "https://github.com/team/repo/pull/987" },
  },
  labels: [{ name: "Needs QA", color: null }],
};

function lanesFor(...cards: TaskCard[]): Record<LaneId, LaneModel> {
  return Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: cards.filter((card) => card.lane === id), hasMore: false, loading: false }])) as Record<LaneId, LaneModel>;
}

describe("task search fields", () => {
  it.each([false, true])("searches the current title after renaming (replace snapshot: %s)", (replaceSnapshot) => {
    let renamed = { ...card, title: "Original task name" };
    const search = (query: string) => filterLanes(lanesFor(renamed), { ...EMPTY_FILTERS, query })[renamed.lane].cards;
    expect(search("original task name")).toEqual([renamed]);
    expect(search("改名后的任务")).toEqual([]);

    if (replaceSnapshot) renamed = { ...renamed, title: "改名后的任务" };
    else renamed.title = "改名后的任务";

    expect(search("改名后的任务")).toEqual([renamed]);
    expect(search("original task name")).toEqual([]);
  });

  it.each([
    ["title", "search behavior"], ["project", "project apple"], ["raw workspace name", "raw workspace"],
    ["branch", "feature/search"], ["folder hidden by deduplication", "hiddenfolder"],
    ["complete path", "/users/dev/projects/hiddenfolder"], ["label", "needs qa"],
    ["provider id", "omp"], ["provider display name", "oh my pi"],
    ["model id", "vendor/model-v3"], ["model display name", "example model 3"],
    ["task id", "uuid-123"], ["PR number", "987"], ["PR hash and number", "#987"],
    ["PR title", "improve find behavior"], ["PR URL", "https://github.com/team/repo/pull/987"],
  ])("matches %s", (_field, query) => {
    expect(filterLanes(lanesFor(card), { ...EMPTY_FILTERS, query: `  ${query.toUpperCase()}  ` })[card.lane].cards).toEqual([card]);
  });

  it("matches every keyword in any order across fields without interpreting regex syntax", () => {
    expect(matchesTaskSearch(card, "fix search")).toBe(true);
    expect(matchesTaskSearch(card, "behavior fix")).toBe(true);
    expect(matchesTaskSearch(card, "apple   behavior")).toBe(true);
    expect(matchesTaskSearch(card, "apple missing")).toBe(false);
    expect(matchesTaskSearch(card, "fix dragonfruit", "Dragonfruit")).toBe(true);
    expect(matchesTaskSearch(card, "fix.*behavior")).toBe(false);
    expect(matchesTaskSearch(card, "")).toBe(true);
    const unknown = { ...card, model: null, modelLabel: null, labels: [], location: { ...card.location, pullRequest: null } };
    expect(matchesTaskSearch(unknown, "null")).toBe(false);
    expect(matchesTaskSearch(unknown, "#987")).toBe(false);
  });

  it("matches the full first message while retaining the other filters", () => {
    const messages = new Map([[card.id, "First line\nOnly this first message mentions Dragonfruit."]]);
    const filters = { ...EMPTY_FILTERS, query: "DRAGONFRUIT", providers: ["omp"], labels: ["Needs QA"], workspaceIds: [card.location.workspaceId!] };
    expect(filterLanes(lanesFor(card), filters, messages)[card.lane].cards).toEqual([card]);
    expect(filterLanes(lanesFor(card), { ...filters, providers: ["codex"] }, messages)[card.lane].cards).toEqual([]);
    expect(filterLanes(lanesFor(card), { ...filters, labels: ["other"] }, messages)[card.lane].cards).toEqual([]);
    expect(filterLanes(lanesFor(card), { ...filters, workspaceIds: ["other"] }, messages)[card.lane].cards).toEqual([]);
    expect(filterLanes(lanesFor(card), filters)[card.lane].cards).toEqual([]);
  });

  it("lets a matching running child stand alone when the parent's first message does not match", () => {
    const parent = { ...card, lane: "running" as const, status: "running" as const };
    const child = { ...parent, id: "child", parent: { id: parent.id, title: parent.title, missing: false, archived: false } };
    const lanes = lanesFor(parent, child);
    const filters = { ...EMPTY_FILTERS, query: "dragonfruit", hideSubtasks: true };
    expect(filterLanes(lanes, filters, new Map([[child.id, "Dragonfruit"]])).running.cards).toEqual([child]);
    expect(filterLanes(lanes, filters, new Map([[child.id, "Dragonfruit"], [parent.id, "Dragonfruit"]])).running.cards).toEqual([parent]);
  });
});
