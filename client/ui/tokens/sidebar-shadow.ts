/**
 * The shadow a right-hand sidebar casts on the content to its left: the
 * Tasks board's sidebar and the details side panel share it, so both
 * read as the same layer.
 */
export function sidebarShadow(isDark: boolean): string {
  return `-8px 0px 16px -8px rgba(0, 0, 0, ${isDark ? 0.5 : 0.2})`;
}

/** Shared surface for desktop right-hand sidebars. */
export function sidebarSurface(surface: string, border: string, isDark: boolean) {
  return { backgroundColor: surface, borderLeftWidth: 1, borderLeftColor: border, boxShadow: sidebarShadow(isDark) };
}
