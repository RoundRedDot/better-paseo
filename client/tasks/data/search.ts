import type { TaskCard } from "../model";

// Reuse text across queries, but invalidate it when the card's title changes.
const texts = new WeakMap<TaskCard, { title: string; text: string }>();

/** The board's searchable metadata, including names hidden by card-field settings or deduplication. */
export function taskSearchText(card: TaskCard): string {
  const known = texts.get(card);
  if (known?.title === card.title) return known.text;
  const { location } = card;
  const pr = location.pullRequest;
  const text = [
    card.title, location.projectName, location.workspaceTitle, location.workspaceName, location.branch,
    location.folderName, location.folder, location.cwd,
    ...card.labels.map((label) => label.name),
    card.provider, card.providerLabel, card.model, card.modelLabel, card.id,
    pr?.number == null ? null : `#${pr.number}`, pr?.title, pr?.url,
  ].filter(Boolean).join(" ").toLowerCase();
  texts.set(card, { title: card.title, text });
  return text;
}

/** `query` is already trimmed and lower-cased, as in `filterLanes`. */
export function matchesTaskSearch(card: TaskCard, query: string, firstMessage?: string): boolean {
  return !query || taskSearchText(card).includes(query) || Boolean(firstMessage?.toLowerCase().includes(query));
}
