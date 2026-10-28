/** Match skill families, including plugin namespaces, without claiming generic names like `qa`. */
const SKILL_ICONS: readonly (readonly [RegExp, string])[] = [
  [/(^|:)(bsk|browserskill|browser-skill|agent-browser)($|[-:])/, "AppWindow"],
  [/(^|:)playwright($|[-:])/, "brand:playwright"],
  [/(^|:)remotion($|[-:])/, "Film"],
  [/(^|:)hyperframes($|[-:])/, "Clapperboard"],
  [/(^|:)impeccable($|[-:])/, "Palette"],
  [/(^|:)gstack($|[-:])/, "Layers"],
  [/(^|:)firecrawl($|[-:])/, "Flame"],
  [/(^|:)(find-skills|skills)$/, "Blocks"],
  [/(^|:)(ui-taste|uizze)($|[-:])/, "PanelsTopLeft"],
];

/** Known skills draw their tool's icon; other skills retain the existing sparkle. */
export function skillIcon(skill: string | undefined): string {
  const name = skill?.trim().toLowerCase().replace(/^\//, "") ?? "";
  return SKILL_ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? "Sparkles";
}
