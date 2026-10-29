import type { TaskCard, TaskLabel } from "../model";

export type SearchField = "title" | "prompt" | "conversation" | "pr" | "label" | "branch" | "folder" | "project" | "workspace" | "path" | "model" | "id";
export interface SearchRange {
  start: number;
  end: number;
}
export interface SearchHit {
  field: SearchField;
  text: string;
  ranges: SearchRange[];
  snippet: string;
  preview: string;
  visible: boolean;
  mono: boolean;
}
export interface SearchVisibility {
  title: boolean;
  project: boolean;
  workspace: boolean;
  branch: boolean;
  folder: boolean;
  path: boolean;
  modelPill: boolean;
  model: boolean;
  pullRequest: boolean;
  labels: number;
  labelLimit: number;
}

/** Highlight each literal keyword, merging overlaps. */
export function searchRanges(text: string, query: string): SearchRange[] {
  const needles = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!needles.length) return [];
  // Lowercasing can expand a Unicode character (İ); retain original UTF-16 offsets.
  const folded = text.toLowerCase();
  const offsets: number[] = [];
  let offset = 0;
  for (const char of text) {
    for (let i = 0; i < char.toLowerCase().length; i++) offsets.push(offset);
    offset += char.length;
  }
  offsets.push(text.length);
  const ranges: SearchRange[] = [];
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const start = folded.indexOf(needle, from);
      if (start < 0) break;
      const last = start + needle.length - 1;
      const end = offsets[last]! + (text.codePointAt(offsets[last]!)! > 0xffff ? 2 : 1);
      ranges.push({ start: offsets[start]!, end });
      from = start + needle.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  return ranges.reduce<SearchRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
    return merged;
  }, []);
}

/** Promote only as many matches as there are slots, keeping the original order within each group. */
export function searchLabels(labels: TaskLabel[], limit: number, query: string): TaskLabel[] {
  if (!query.trim()) return labels.slice(0, limit);
  const matches = labels.filter((label) => searchRanges(label.name, query).length > 0).slice(0, limit);
  const selected = new Set(matches);
  const normal = labels.filter((label) => !selected.has(label)).slice(0, Math.max(0, limit - matches.length));
  return labels.filter((label) => selected.has(label) || normal.includes(label));
}

export function searchSnippet(text: string, query: string, field: SearchField, preview = false): string {
  const range = searchRanges(text, query)[0];
  if (!range) return text;
  if (preview && ["path", "id", "branch", "model"].includes(field)) {
    if (text.length <= 100) return text;
    const before = Math.max(0, range.start - 20);
    const start = Math.max(text.lastIndexOf("/", before), text.lastIndexOf("-", before)) + 1;
    let end = Math.min(text.length, range.end + 80);
    // Keep machine tokens whole, even if a single token exceeds the preview budget.
    while (end < text.length && !/[\/-]/.test(text[end]!)) end++;
    return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  }
  if (!preview && field === "id") {
    const groups = text.split("-");
    let offset = 0;
    const group = groups.findIndex((value) => {
      const end = offset + value.length;
      const matches = range.start <= end;
      offset = end + 1;
      return matches;
    });
    // A query crossing UUID groups must stay intact.
    if (groups.length === 5 && !query.includes("-") && group > 0)
      return `${groups[0]}…${groups.slice(group, group + 2).join("-")}${group + 2 < groups.length ? "…" : ""}`;
  }
  if (!preview && field === "path") {
    const prefix = text.lastIndexOf("/", range.start);
    const previous = text.lastIndexOf("/", prefix - 1);
    if (previous > 1) return `${text.startsWith("~/") ? "~/" : text.startsWith("/") ? "/" : ""}…${text.slice(previous)}`;
  }
  const before = text.slice(0, range.start);
  const budget = preview ? 20 : /[\u3400-\u9fff]/.test(before.slice(-16)) ? 8 : 16;
  let start = Math.max(0, range.start - budget);
  const punctuation = /[\s,.;:!?\uFF0C\u3002\uFF1B\uFF1A\uFF01\uFF1F]/;
  // Move forward to a word boundary without exceeding the context budget.
  if (start > 0 && /[\w]/.test(text[start - 1]!) && /[\w]/.test(text[start]!)) {
    const boundary = text.slice(start, range.start).search(punctuation);
    if (boundary >= 0) start += boundary + 1;
  }
  while (start < range.start && punctuation.test(text[start]!)) start++;
  const end = preview ? Math.min(text.length, range.end + 80) : text.length;
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}

/** Middle truncation keeps the prefix, at least six characters before the hit, and the entire tail. */
export function searchBranch(text: string, query: string, columns: number): string {
  const hit = searchRanges(text, query)[0];
  if (!hit || text.length <= columns) return text;
  const slash = text.indexOf("/");
  const prefix = slash < 0 ? 4 : Math.min(text.length, text.indexOf("-", slash) + 1 || slash + 1);
  const start = Math.max(prefix, hit.start - 6);
  if (start <= prefix + 1) return text;
  return `${text.slice(0, prefix)}…${text.slice(start)}`;
}

/** Move the matching breadcrumb's cut to the front and shorten its neighbour. */
export function searchBreadcrumb(project: string, workspace: string, query: string, columns: number): string {
  if (!query.trim() || project.length + workspace.length + 3 <= columns) return [project, workspace].filter(Boolean).join(" › ");
  const workspaceHit = searchRanges(workspace, query)[0];
  const projectHit = searchRanges(project, query)[0];
  if (!workspaceHit && !projectHit) return [project, workspace].filter(Boolean).join(" › ");
  const short = (value: string) => (value.length > 8 ? `${value.slice(0, 8)}…` : value);
  const matching = workspaceHit ? workspace : project;
  const range = workspaceHit ?? projectHit!;
  const other = short(workspaceHit ? project : workspace);
  const available = Math.max(0, columns - other.length - (other ? 3 : 0));
  const start = Math.max(0, Math.min(range.start - 4, matching.length - available + 1));
  const shown = `${start > 0 ? "…" : ""}${matching.slice(start)}`;
  return (workspaceHit ? [other, shown] : [shown, other]).filter(Boolean).join(" › ");
}

/** One entry per field (labels per value); matching aliases in the same field share a row. */
export function taskSearchHits(card: TaskCard, query: string, visibility: SearchVisibility, prompt?: string, messageField: "prompt" | "conversation" = "prompt"): SearchHit[] {
  if (!query.trim()) return [];
  const location = card.location;
  const pr = location.pullRequest;
  const labels = visibility.labels ? searchLabels(card.labels, visibility.labelLimit, query) : [];
  const hits: SearchHit[] = [];
  const add = (
    field: SearchField,
    values: (string | null | undefined)[],
    visibleValues: (string | null | undefined)[] = [],
    mono = false,
  ) => {
    const matching = [...new Set(values.filter((value): value is string => Boolean(value) && searchRanges(value!, query).length > 0))];
    if (!matching.length) return;
    const visible = visibleValues.some((value) => value && searchRanges(value, query).length > 0);
    const text = matching.join(" · ");
    hits.push({
      field,
      text,
      ranges: searchRanges(text, query),
      snippet: searchSnippet(matching[0]!, query, field),
      preview: searchSnippet(text, query, field, true),
      visible,
      mono,
    });
  };
  add("title", [card.title], visibility.title ? [card.title] : []);
  add(messageField, [prompt]);
  add(
    "pr",
    [pr?.number == null ? null : `#${pr.number}`, pr?.title, pr?.url],
    visibility.pullRequest ? [pr?.number == null ? pr?.title : `#${pr.number}`] : [],
  );
  for (const label of card.labels) add("label", [label.name], labels.includes(label) ? [label.name] : []);
  add("branch", [location.branch], visibility.branch ? [location.branch] : [], true);
  add("folder", [location.folder, location.folderName], visibility.folder ? [location.folder] : []);
  add("project", [location.projectName], visibility.project ? [location.projectName] : []);
  add("workspace", [location.workspaceName, location.workspaceTitle], visibility.workspace ? [location.workspaceName] : []);
  // A path match already highlighted inside the visible folder needs no duplicate summary.
  add("path", [location.cwd], visibility.path ? [location.cwd] : visibility.folder ? [location.folder] : [], true);
  add(
    "model",
    [card.provider, card.providerLabel, card.model, card.modelLabel],
    visibility.modelPill ? [visibility.model && card.modelLabel ? card.modelLabel : card.providerLabel] : [],
    true,
  );
  add("id", [card.id], [], true);
  return hits;
}

/** Visible fields follow the card's reading order; hidden fields retain the summary priority. */
export function orderedSearchHits(hits: SearchHit[]): SearchHit[] {
  const order: SearchField[] = ["project", "workspace", "title", "model", "branch", "folder", "path", "label", "pr", "id", "prompt", "conversation"];
  return [
    ...hits.filter((hit) => hit.visible).sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field)),
    ...hits.filter((hit) => !hit.visible),
  ];
}

/** Full values absent from the normal details rows; search never duplicates those rows. */
export function detailSearchHits(card: TaskCard, query: string): SearchHit[] {
  const model = card.modelLabel ?? (card.thinkingLabel ? null : card.subagent?.subtitle) ?? card.providerLabel;
  const values: [SearchField, (string | null | undefined)[]][] = [
    ["workspace", [card.location.workspaceTitle !== card.location.workspaceName ? card.location.workspaceTitle : null]],
    ["pr", [card.location.pullRequest?.url]],
    [
      "model",
      [card.provider, card.providerLabel, card.model, card.modelLabel].filter((value) => value?.toLowerCase() !== model.toLowerCase()),
    ],
    ["id", [card.id]],
  ];
  return values.flatMap(([field, texts]) => {
    const text = [...new Set(texts.filter((value): value is string => Boolean(value) && searchRanges(value!, query).length > 0))].join(
      " · ",
    );
    if (!text) return [];
    return [
      {
        field,
        text,
        snippet: searchSnippet(text, query, field),
        preview: text,
        ranges: searchRanges(text, query),
        visible: false,
        mono: field !== "workspace",
      },
    ];
  });
}
