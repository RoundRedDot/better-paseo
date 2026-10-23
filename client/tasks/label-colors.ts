/**
 * A label the daemon gives no color (no label definitions, or a color name
 * the board has no hex for) takes one of Linear's label colors. Linear's default
 * labels keep theirs; any other starts at the color its name hashes to and
 * steps past colors already given, and past the default labels' colors while
 * others are free, so labels differ until the palette runs out. A name keeps
 * its color for the session.
 */
const FALLBACK_LABEL_COLORS = ["#5e6ad2", "#26b5ce", "#4cb782", "#f2c94c", "#f2994a", "#eb5757", "#bb87fc", "#4ea7fc", "#e879a6", "#a5876b"];
const LINEAR_DEFAULT_LABELS: Readonly<Record<string, string>> = { bug: "#eb5757", feature: "#bb87fc", improvement: "#4ea7fc" };
const fallbackColors = new Map<string, string>();

export function fallbackLabelColor(name: string): string {
  const given = fallbackColors.get(name);
  if (given) return given;
  let color = LINEAR_DEFAULT_LABELS[name.trim().toLowerCase()];
  if (!color) {
    let hash = 0;
    for (const char of name) hash = (Math.imul(hash, 31) + char.codePointAt(0)!) | 0;
    const start = (hash >>> 0) % FALLBACK_LABEL_COLORS.length;
    const taken = new Set(fallbackColors.values());
    const reserved = new Set([...taken, ...Object.values(LINEAR_DEFAULT_LABELS)]);
    color = FALLBACK_LABEL_COLORS[start]!;
    search: for (const skip of [reserved, taken]) {
      for (let step = 0; step < FALLBACK_LABEL_COLORS.length; step += 1) {
        const candidate = FALLBACK_LABEL_COLORS[(start + step) % FALLBACK_LABEL_COLORS.length]!;
        if (!skip.has(candidate)) {
          color = candidate;
          break search;
        }
      }
    }
  }
  fallbackColors.set(name, color);
  return color;
}
