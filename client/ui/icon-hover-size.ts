/** The visible feedback stays proportional to the glyph, independently of its hit target. */
export function iconHoverSize(iconSize: number): number {
  return Math.round(iconSize * 1.7);
}
