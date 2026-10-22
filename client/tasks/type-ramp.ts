/**
 * The host's type ramp as plain numbers, for code that sizes text without
 * React (menus' geometry, models). `typography.tsx` re-exports it.
 */

/**
 * Paseo's interface type ramp (`FONT_SIZE` in the app's `styles/theme.ts`)
 * at its default base of 14. Size text with these steps, not with literal
 * numbers: `TaskText` scales a size by the user's base size / 14 and rounds,
 * as the host scales its own ramp (`appearance/apply.ts`), so a step here is
 * the host's step under any interface size the user picks.
 */
export const HOST_FONT = { sm: 12, base: 14, lg: 16, xl: 18, "2xl": 20, "3xl": 22 } as const;

/** Line heights for the ramp's steps, about 1.4 of the size on the 2 px grid. */
export const HOST_LINE = { sm: 16, base: 20, lg: 22, xl: 26, "2xl": 28, "3xl": 30 } as const;
