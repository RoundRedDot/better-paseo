import React from "react";
import { Platform, View, type ViewStyle } from "react-native";
import { webTransition } from "./action-style";
import { CutCardSurface } from "./cut-card-surface";

/** The hole's radius: a half circle cut into each side of a scheduled task's card. */
export const TICKET_NOTCH = 5;
/** The rule between the notches: dashes this long with gaps this wide, this thick, starting this far past each notch. */
export const TICKET_RULE = { dash: 3, gap: 2, width: 0.5, inset: 2 } as const;
/** Room for the card's hover shadow outside each clipped section, as `CutCardSurface` keeps. */
const GUTTER = 12;

const WEB = Platform.OS === "web";
const hidden = WEB
  ? ({ "aria-hidden": true } as const)
  : ({ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" } as const);

/** The card's surface, as a whole card would draw it. */
export interface TicketLook {
  radius: number;
  background: string;
  borderColor: string;
  borderWidth: number;
  dashed: boolean;
  /** The card's CSS box-shadow (rest or hover, with the focus ring on native). */
  shadow: string;
  /** The focus ring drawn inside each notch, when present. */
  notchFocus?: string;
  /** The dashed rule's colour. */
  rule: string;
}

/**
 * The card's padding, and where the notches sit: `offset` below the bottom of
 * the rows above them (the head), so `offset` above the top of the rows below
 * (the tail) as far as the tail's first margin reaches.
 */
export interface TicketFrame {
  padH: number;
  padTop: number;
  padBottom: number;
  offset: number;
}

/** The outer arc's radius: the hole and the border drawn round it. */
export function ticketReach(borderWidth: number): number {
  return TICKET_NOTCH + borderWidth;
}

/** A horizontal run of `TICKET_RULE` dashes as a repeated gradient tile: web CSS, and React Native's own background image on iOS and Android. */
export function dashedRule(color: string): ViewStyle {
  const { dash, gap } = TICKET_RULE;
  const image = `linear-gradient(to right, ${color} 0px, ${color} ${dash}px, transparent ${dash}px, transparent ${dash + gap}px)`;
  const size = `${dash + gap}px 100%`;
  return (WEB
    ? { backgroundImage: image, backgroundSize: size, backgroundRepeat: "repeat-x" }
    : { experimental_backgroundImage: image, experimental_backgroundSize: size, experimental_backgroundRepeat: "repeat-x" }) as ViewStyle;
}

function surface(look: TicketLook): ViewStyle {
  return {
    position: "absolute",
    backgroundColor: look.background,
    borderColor: look.borderColor,
    borderWidth: look.borderWidth,
    borderStyle: look.dashed ? "dashed" : "solid",
    borderRadius: look.radius,
    boxShadow: look.shadow,
    ...webTransition,
  };
}

/**
 * The head of a scheduled task's card, drawn behind the rows above the notches
 * and positioned from their box: the card's surface down to the notches (cut
 * at its top-right corner too when `fold` is given), then the band they sit
 * in. The band paints the card's fill around two open half circles and the
 * card's border round them, so the board shows through the holes regardless of
 * the card's selection or failure tint.
 */
export function TicketHead(props: { look: TicketLook; frame: TicketFrame; fold?: { size: number; color: string } | null }) {
  const { look, frame, fold } = props;
  const reach = ticketReach(look.borderWidth);
  const edge = frame.padH + look.borderWidth;
  return (
    <>
      {fold ? (
        // `CutCardSurface` draws on the card's padding box; this one ends a border's width above the band.
        <View pointerEvents="none" {...hidden} style={{ position: "absolute", top: -frame.padTop, left: -frame.padH, right: -frame.padH, bottom: reach - frame.offset + look.borderWidth }} testID="task-card-ticket-head">
          <CutCardSurface size={fold.size} radius={look.radius} background={look.background} borderColor={look.borderColor} borderWidth={look.borderWidth} dashed={look.dashed} shadow={look.shadow} fold={fold.color} open />
        </View>
      ) : (
        <View pointerEvents="none" {...hidden} testID="task-card-ticket-head"
          style={{ position: "absolute", top: -(frame.padTop + look.borderWidth + GUTTER), left: -(edge + GUTTER), right: -(edge + GUTTER), bottom: reach - frame.offset, overflow: "hidden" }}>
          {/* Past the cut, so its bottom corners and border are clipped away. */}
          <View testID="task-card-ticket-head-surface" style={[surface(look), { top: GUTTER, left: GUTTER, right: GUTTER, bottom: -(look.radius + 2) }]} />
        </View>
      )}
      <TicketBand look={look} style={{ left: -edge, right: -edge, bottom: -(frame.offset + reach) }} />
    </>
  );
}

/** The tail of a scheduled task's card, drawn behind the rows below the notches: the card's surface from the band down. */
export function TicketTail(props: { look: TicketLook; frame: TicketFrame }) {
  const { look, frame } = props;
  const reach = ticketReach(look.borderWidth);
  const edge = frame.padH + look.borderWidth;
  return (
    <View pointerEvents="none" {...hidden} testID="task-card-ticket-tail"
      style={{ position: "absolute", top: frame.offset + reach, left: -(edge + GUTTER), right: -(edge + GUTTER), bottom: -(frame.padBottom + look.borderWidth + GUTTER), overflow: "hidden" }}>
      <View testID="task-card-ticket-tail-surface" style={[surface(look), { top: -(look.radius + 2), left: GUTTER, right: GUTTER, bottom: GUTTER }]} />
    </View>
  );
}

/**
 * The band between head and tail, as tall as the notches: the fill between
 * them, the dashed rule joining them, and at each side a corner box holding a
 * ring of fill round the hole and the border's arc. The ring reaches half
 * under the arc, so no seam opens between them.
 */
function TicketBand(props: { look: TicketLook; style: ViewStyle }) {
  const { look } = props;
  const reach = ticketReach(look.borderWidth);
  const inner = TICKET_NOTCH + look.borderWidth / 2;
  const outer = inner + reach;
  const side = (at: "left" | "right") => {
    const centre = at === "left" ? 0 : reach;
    return (
      <View testID={`task-card-ticket-notch-${at}`} style={{ position: "absolute", top: 0, [at]: 0, width: reach, height: reach * 2, overflow: "hidden" }}>
        <View testID={`task-card-ticket-fill-${at}`} style={{
          position: "absolute",
          left: centre - outer,
          top: reach - outer,
          width: outer * 2,
          height: outer * 2,
          borderRadius: outer,
          borderWidth: reach,
          borderColor: look.background,
          ...webTransition,
        }} />
        <View testID={`task-card-ticket-arc-${at}`} style={{
          position: "absolute",
          left: centre - reach,
          top: 0,
          width: reach * 2,
          height: reach * 2,
          borderRadius: reach,
          borderWidth: look.borderWidth,
          borderColor: look.borderColor,
          boxShadow: look.notchFocus,
          ...webTransition,
        }} />
      </View>
    );
  };
  return (
    <View pointerEvents="none" {...hidden} testID="task-card-ticket-band" style={[{ position: "absolute", height: reach * 2 }, props.style]}>
      <View testID="task-card-ticket-band-fill" style={{ position: "absolute", top: 0, bottom: 0, left: reach, right: reach, backgroundColor: look.background, ...webTransition }} />
      {side("left")}
      {side("right")}
      <View testID="task-card-ticket-rule" style={{
        position: "absolute",
        left: reach + TICKET_RULE.inset,
        right: reach + TICKET_RULE.inset,
        // From the centre down, so the line starts on a device pixel.
        top: reach,
        // Chrome draws any box under 1 px as a whole pixel (and one at a
        // fractional top not at all), so the web scales a 1 px box down.
        ...(WEB ? { height: 1, transform: [{ scaleY: TICKET_RULE.width }], transformOrigin: "top" } : { height: TICKET_RULE.width }),
        ...dashedRule(look.rule),
      }} />
    </View>
  );
}
