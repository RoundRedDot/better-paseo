import { Platform, type ScrollViewProps } from "react-native";

/**
 * The details' web scrollbars (styled in `board/lane-scrollbar.ts`): classic
 * ones, so they take a gutter of their own instead of lying over the text.
 *
 * - `inset`: a scroller inside the details card. Its gutter is the outer 6
 *   of the card's 12 side padding, which the content gives up on that side,
 *   so the text keeps its edge under the header's and a 4 wide thumb stays
 *   about 7 off it.
 * - `column`: the sidebar column scrolled as one. The cards narrow by the
 *   gutter and the thumb keeps 6 off their edge.
 */
export const DETAIL_SCROLLBAR = {
  inset: { gutter: 6, left: 1, right: 1 },
  column: { gutter: 12, left: 6, right: 2 },
} as const;

export type DetailScrollbarKind = keyof typeof DETAIL_SCROLLBAR;

/** The room a details scroller's content leaves for its scrollbar: none off web, where the indicator lies over the padding. */
export const detailGutter = (kind: DetailScrollbarKind): number => (Platform.OS === "web" ? DETAIL_SCROLLBAR[kind].gutter : 0);

/**
 * A native sheet's horizontal padding. The scroller borrows it with a matching
 * negative margin so the platform indicator sits outside the card, and gives
 * the same room back as content padding so the card keeps its width. Web keeps
 * the gutter above instead.
 */
export const OUTSIDE_INDICATOR = 12;

export function outsideIndicator(active: boolean): { marginRight: number; paddingRight: number } | null {
  if (!active || Platform.OS === "web") return null;
  return { marginRight: -OUTSIDE_INDICATOR, paddingRight: OUTSIDE_INDICATOR };
}

/**
 * A details scroller's indicator props: the styled scrollbar on web, the
 * platform's indicator elsewhere, kept off the card's rounded bottom corners.
 */
export function detailScrollProps(kind: DetailScrollbarKind): ScrollViewProps {
  if (Platform.OS === "web") return { showsVerticalScrollIndicator: true, dataSet: { bcdetails: kind } } as ScrollViewProps;
  return { showsVerticalScrollIndicator: true, scrollIndicatorInsets: kind === "inset" ? { bottom: 8 } : undefined };
}
