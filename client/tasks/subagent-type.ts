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
