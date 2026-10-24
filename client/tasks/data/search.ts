import type { TaskCard } from "../model";

// Card snapshots are immutable; normal clock ticks and query changes reuse this text.
const texts = new WeakMap<TaskCard, string>();

/** The board's searchable metadata, including names hidden by card-field settings or deduplication. */
export function taskSearchText(card: TaskCard): string {
  const known = texts.get(card);
  if (known !== undefined) return known;
  const { location } = card;
  const pr = location.pullRequest;
  const text = [
    card.title, location.projectName, location.workspaceTitle, location.workspaceName, location.branch,
    location.folderName, location.folder, location.cwd,
    ...card.labels.map((label) => label.name),
    card.provider, card.providerLabel, card.model, card.modelLabel, card.id,
    pr?.number == null ? null : `#${pr.number}`, pr?.title, pr?.url,
  ].filter(Boolean).join(" ").toLowerCase();
  texts.set(card, text);
  return text;
}

/** `query` is already trimmed and lower-cased, as in `filterLanes`. */
export function matchesTaskSearch(card: TaskCard, query: string, firstMessage?: string): boolean {
  return !query || taskSearchText(card).includes(query) || Boolean(firstMessage?.toLowerCase().includes(query));
}
