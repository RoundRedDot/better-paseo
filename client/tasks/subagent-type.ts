/**
 * The subagent type a provider subagent's facts line opens with
 * ("general-purpose · Sonnet 5.5 · High · 185.4k tokens"), as the board
 * draws it: a type the timeline has an icon for as that icon alone, any
 * other name (a custom agent, an explicit `name`) as the timeline's subagent
 * icon and the name.
 */
export interface SubagentFacts {
  /** A Lucide icon before the line, from the timeline's tool icons; null draws none. */
  icon: string | null;
  /** The line to draw: the type's name when the icon alone does not say it, then the rest. */
  text: string | null;
  /** The provider's whole line, type included, for a hint or a screen reader. */
  full: string | null;
}

/**
 * The model and effort a facts line names after the type, as a card's model
 * pill draws them ("Sonnet 5.5", "High"); the token count is left out. A
 * subagent that inherits its parent's model has none on the line
 * ("general-purpose · High · 518k tokens"): the model is null then. Null
 * where the line does not open with the type or names neither, so it reads
 * as written.
 */
export function subagentModel(subtitle: string | null | undefined, type: string | null | undefined): { model: string | null; thinking: string | null } | null {
  const full = subtitle?.trim() || null;
  const name = type?.trim() || null;
  if (!full || !name || !full.startsWith(`${name} · `)) return null;
  const parts = full.slice(name.length + 3).split(" · ").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 0 && TOKENS.test(parts[parts.length - 1]!)) parts.pop();
  const model = parts.length > 0 && !EFFORT.test(parts[0]!) ? parts.shift()! : null;
  const thinking = parts.join(" \u00b7 ") || null;
  if (!model && !thinking) return null;
  return { model, thinking };
}

/** The token count a facts line ends with: "189.7k tokens", "1 token". */
const TOKENS = /\btokens?$/i;

/** An effort as the providers write it ("High", "Extra High", "Max"): no model before it. */
const EFFORT = /^(none|minimal|low|medium|high|extra high|xhigh|max)$/i;

/** The types the timeline's tool icons say on their own. */
const TYPE_ICONS: Record<string, string> = {
  "general-purpose": "Shapes",
  explore: "Search",
  plan: "ListChecks",
  workflow: "Workflow",
  fork: "Split",
  claude: "Bot",
};

/** Any other subagent: the timeline's sub_agent icon, with its name. */
const NAMED_ICON = "Bot";

/**
 * A provider subagent's type: its descriptor's title, or, where the daemon
 * sends none (a background Agent call's descriptor can carry no title), the
 * type its facts line opens with, when the timeline has an icon for it. Any
 * other first name could as well be a model, so it stays unknown.
 */
export function subagentType(title: string | null | undefined, subtitle: string | null | undefined): string | null {
  const named = title?.trim();
  if (named) return named;
  const lead = subtitle?.split(" · ")[0]?.trim();
  return lead && TYPE_ICONS[lead.toLowerCase()] ? lead : null;
}

export function subagentFacts(subtitle: string | null | undefined, type: string | null | undefined): SubagentFacts {
  const full = subtitle?.trim() || null;
  const name = type?.trim() || null;
  if (!full || !name) return { icon: null, text: full, full };
  const lead = full === name ? "" : full.startsWith(`${name} · `) ? full.slice(name.length + 3) : null;
  // A line that does not open with the type is drawn as the provider wrote it.
  if (lead === null) return { icon: null, text: full, full };
  const rest = lead.trim() || null;
  const key = name.toLowerCase();
  const icon = TYPE_ICONS[key];
  if (icon) return { icon, text: rest, full };
  return { icon: NAMED_ICON, text: rest ? `${name} · ${rest}` : name, full };
}
