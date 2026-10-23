import type { TasksLanguage } from "../i18n";
import { LANE_ORDER, turnRunning, type LaneId, type LaneModel, type TaskCard } from "../model";

/**
 * Sorting the lanes. One sort applies to every lane; without one each lane
 * keeps the spec's order (the data layer's). Ties, and every card the key
 * cannot rank, keep that default order, and cards missing the key go last
 * in both directions.
 */
export const SORT_KEYS = ["workspace", "project", "branch", "folder", "title", "created", "updated", "context", "duration"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";
export interface BoardSort {
  key: SortKey;
  direction: SortDirection;
}

/** Names sort A to Z first; times, context and duration largest first. */
export const NAME_KEYS: ReadonlySet<SortKey> = new Set(["workspace", "project", "branch", "folder", "title"]);

/** Every choice in menu order, the default (null) first. */
export const SORT_CHOICES: readonly (BoardSort | null)[] = [
  null,
  ...SORT_KEYS.flatMap((key): BoardSort[] =>
    NAME_KEYS.has(key)
      ? [
          { key, direction: "asc" },
          { key, direction: "desc" },
        ]
      : [
          { key, direction: "desc" },
          { key, direction: "asc" },
        ],
  ),
];

export function encodeSort(sort: BoardSort | null): string | null {
  return sort ? `${sort.key}-${sort.direction}` : null;
}

export function decodeSort(value: string | undefined): BoardSort | null {
  if (!value) return null;
  const [key, direction] = value.split("-");
  if (!(SORT_KEYS as readonly string[]).includes(key ?? "")) return null;
  if (direction !== "asc" && direction !== "desc") return null;
  return { key: key as SortKey, direction };
}

export function sameSort(a: BoardSort | null, b: BoardSort | null): boolean {
  return encodeSort(a) === encodeSort(b);
}

type Compare = (a: string, b: string) => number;
type IntlLike = { Collator?: new (locales?: string | string[], options?: Intl.CollatorOptions) => { compare: Compare } };

/**
 * Case-insensitive, numeric-aware name comparison: Intl.Collator (pinyin
 * order for Chinese where the runtime has it); without Intl.Collator,
 * `localeCompare` on lower-cased names, else code points.
 */
export function nameCompare(language: TasksLanguage, intl: IntlLike | undefined = (globalThis as { Intl?: IntlLike }).Intl): Compare {
  const Collator = intl?.Collator;
  if (typeof Collator === "function") {
    try {
      const locales = language === "zh" ? ["zh-Hans-u-co-pinyin", "zh"] : ["en"];
      return new Collator(locales, { numeric: true, sensitivity: "base" }).compare;
    } catch {
      // An unsupported locale or option: fall through.
    }
  }
  return (a, b) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    try {
      return x.localeCompare(y);
    } catch {
      return x < y ? -1 : x > y ? 1 : 0;
    }
  };
}

function since(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? now - at : null;
}

function timestamp(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

function text(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The card's value for a key; null when it has none. */
function sortValue(card: TaskCard, key: SortKey, now: number): string | number | null {
  const location = card.location;
  switch (key) {
    case "workspace":
      return text(location.workspaceTitle ?? location.workspaceName);
    case "project":
      return text(location.projectName);
    case "branch":
      return text(location.branch);
    case "folder":
      return text(location.folderName ?? location.folder);
    case "title":
      return text(card.title);
    case "created":
      return timestamp(card.timing.createdAt);
    case "updated":
      return timestamp(card.timing.updatedAt);
    case "context":
      return card.context && card.context.maxTokens > 0 ? card.context.usedTokens / card.context.maxTokens : null;
    case "duration":
      if (turnRunning(card)) return since(card.timing.turnStartedAt, now);
      if (card.lane === "needs_input") return since(card.timing.attentionAt, now);
      return card.timing.lastTurnMs;
  }
}

/** One lane's cards in the sort's order; the input order breaks ties. */
export function sortCards(cards: readonly TaskCard[], sort: BoardSort, now: number, compareNames: Compare): TaskCard[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  const ranked = cards.map((card, index) => ({ card, index, value: sortValue(card, sort.key, now) }));
  ranked.sort((a, b) => {
    if (a.value === null || b.value === null) {
      if (a.value === null && b.value === null) return a.index - b.index;
      return a.value === null ? 1 : -1;
    }
    const order =
      typeof a.value === "string" && typeof b.value === "string"
        ? compareNames(a.value, b.value)
        : (a.value as number) - (b.value as number);
    return order !== 0 ? sign * order : a.index - b.index;
  });
  return ranked.map((entry) => entry.card);
}

/** Every lane sorted; the lanes as given without a sort. Pure: `now` is the moment the order was taken. */
export function sortLaneCards(
  lanes: Record<LaneId, LaneModel>,
  sort: BoardSort | null,
  now: number,
  compareNames: Compare = nameCompare("en"),
): Record<LaneId, LaneModel> {
  if (!sort) return lanes;
  const out = {} as Record<LaneId, LaneModel>;
  for (const id of LANE_ORDER) out[id] = { ...lanes[id], cards: sortCards(lanes[id].cards, sort, now, compareNames) };
  return out;
}

/** Whether the done lane, paged 50 at a time, is sorted only among what has loaded. */
export function sortsLoadedOnly(sort: BoardSort | null): boolean {
  return sort !== null && sort.key !== "updated";
}
