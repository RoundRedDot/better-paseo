/**
 * The filter searches' rule, shared by the desktop menus and the phone's
 * filter sheet: every word of the query, ignoring case, must appear in the
 * text the row shows.
 */

/** A query's words, lower-cased; none for a blank query. */
export function searchWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether the row's shown texts, taken together, hold every word. */
export function matchesSearch(texts: readonly (string | null | undefined)[], words: readonly string[]): boolean {
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}
