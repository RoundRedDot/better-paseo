/**
 * Touches the content of a details panel takes for itself. The drawer moves
 * by its handle, its header, and a pull down on a body at its top (design
 * 4a), but a press-and-drag that starts in one of the content's own gesture
 * zones is the content's: the line-number gutter's hold-and-slide selection,
 * a table's held cell range. Such a zone claims its touch as it begins and
 * lets go as it ends; while a claim stands, the panel's drags do not take the
 * finger, whatever it does (`panelResponder`).
 *
 * A count rather than a context: the zones also draw in the hover preview
 * and the timeline, where nothing reads it and a claim costs nothing.
 */
let claims = 0;

/** Claims the touch under way for the content; returns its release, which may be called again. */
export function claimContentTouch(): () => void {
  claims += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
  };
}

/** Whether a content gesture zone holds the touch under way. */
export function contentOwnsTouch(): boolean {
  return claims > 0;
}

/** Tests: drops every claim. */
export function resetContentTouches(): void {
  claims = 0;
}
