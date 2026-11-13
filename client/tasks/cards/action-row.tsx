import React, { Children, Fragment, createContext, isValidElement, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";

interface ActionSize {
  full: number;
  icon: number;
  /** The row's main answer (Allow): its label goes only after every other one. */
  keep?: boolean;
}

/**
 * Drop whole labels from left to right, the main answer's last; never truncate
 * a word or shrink an icon.
 */
export function actionIconOnly(width: number, sizes: readonly ActionSize[], gap: number): boolean[] {
  let total = sizes.reduce((sum, size) => sum + size.full, 0) + Math.max(0, sizes.length - 1) * gap;
  const folded = sizes.map(() => false);
  for (let pass = 0; pass < 2; pass++) {
    for (let index = 0; index < sizes.length; index++) {
      const size = sizes[index]!;
      if ((size.keep === true) !== (pass === 1) || total <= width + 0.5 || size.full <= size.icon) continue;
      total -= size.full - size.icon;
      folded[index] = true;
    }
  }
  return folded;
}

type Entry = ActionSize & { id: string; index: number };
interface ActionSlot {
  index: number;
  folded: ReadonlySet<string>;
  /** The row lays its buttons out one under another (`ActionRow`'s `stack`). */
  stacked: boolean;
  fill: boolean;
  register(entry: Entry): () => void;
}
const ActionContext = createContext<ActionSlot | null>(null);
const NO_FOLDS: ReadonlySet<string> = new Set();

function actions(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? actions(child.props.children) : [child],
  );
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const id of right) if (!left.has(id)) return false;
  return true;
}

/**
 * One measured row, shared by cards, the details header and the phone sheet.
 *
 * Only which buttons fold to their icon is state: the row's width and each
 * button's sizes are bookkeeping that decides it. A card mounting used to
 * render its row three more times (the row's width, each label's width, each
 * button registering), a commit and a native text layout each; on a low-end
 * Android phone some 200 ms for every card that came into view. Now a row
 * whose buttons fit, the usual case, renders once.
 */
export function ActionRow(props: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /**
   * Lay the buttons out one under another, each as wide as the row and with
   * its whole label, when they do not fit on one line even with the others
   * folded to their icons: for answers that only their words tell apart
   * (`keepsAnswerLabel`), so none is ever cut in the middle of a word.
   */
  stack?: boolean;
  /** Stack before folding any labels when the full row does not fit. */
  stackFull?: boolean;
  /** Grow buttons to fill the row, or fill it when stacked. */
  fill?: boolean;
  /** With `fill`: keep the last action on a separate line only if the whole row does not fit. */
  splitLast?: boolean;
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(NO_FOLDS);
  const [stacked, setStacked] = useState(false);
  const [lastOnOwnRow, setLastOnOwnRow] = useState(false);
  const stack = useRef(props.stack === true);
  stack.current = props.stack === true;
  const stackFull = useRef(props.stackFull === true);
  stackFull.current = props.stackFull === true;
  const splitLast = useRef(props.splitLast === true);
  splitLast.current = props.splitLast === true;
  const gap = props.gap ?? 8;
  const authored = StyleSheet.flatten(props.style);
  const padding = (authored?.paddingLeft ?? authored?.paddingHorizontal ?? authored?.padding ?? 0) as number;
  const endPadding = (authored?.paddingRight ?? authored?.paddingHorizontal ?? authored?.padding ?? 0) as number;
  // Measurements, not state: the fold below is what they decide.
  const sizes = useRef<{ width: number | null; gap: number; entries: Map<string, Entry> }>({ width: null, gap, entries: new Map() });
  const refold = useCallback(() => {
    const { width, entries } = sizes.current;
    if (width === null) return;
    const sorted = [...entries.values()].sort((a, b) => a.index - b.index);
    const modes = actionIconOnly(width, sorted, sizes.current.gap);
    const total = sorted.reduce((sum, item, index) => sum + (modes[index] ? item.icon : item.full), 0) + Math.max(0, sorted.length - 1) * sizes.current.gap;
    // Stacked, every button has the row's width, so none needs to fold.
    const fullTotal = sorted.reduce((sum, item) => sum + item.full, 0) + Math.max(0, sorted.length - 1) * sizes.current.gap;
    const separate = splitLast.current && sorted.length === 3 && fullTotal > width + 0.5;
    const pairTotal = sorted.slice(0, 2).reduce((sum, item) => sum + item.full, 0) + sizes.current.gap;
    const tight = splitLast.current ? separate && pairTotal > width + 0.5 : stackFull.current ? fullTotal > width + 0.5 : stack.current && total > width + 0.5;
    setLastOnOwnRow(separate);
    setStacked(tight);
    const next = tight ? NO_FOLDS : new Set(sorted.filter((_, index) => modes[index]).map((item) => item.id));
    setFolded((current) => (sameIds(current, next) ? current : next.size === 0 ? NO_FOLDS : next));
  }, []);
  const register = useCallback((entry: Entry) => {
    sizes.current.entries.set(entry.id, entry);
    refold();
    return () => {
      if (sizes.current.entries.get(entry.id) !== entry) return;
      sizes.current.entries.delete(entry.id);
      refold();
    };
  }, [refold]);
  useLayoutEffect(() => {
    if (sizes.current.gap === gap) return;
    sizes.current.gap = gap;
    refold();
  }, [gap, refold]);
  useLayoutEffect(() => { refold(); }, [props.stack, props.stackFull, props.fill, props.splitLast, refold]);
  // One value per slot while the fold holds, so a button draws again only when it folds or unfolds.
  const children = actions(props.children);
  // The last slot's place depends on the count only when it may take a line of its own.
  const lastIndex = props.splitLast ? children.length - 1 : -1;
  const slots = useMemo(() => new Map<number, ActionSlot>(), [folded, stacked, lastOnOwnRow, props.fill, lastIndex, register]);
  const slot = (index: number) => {
    let value = slots.get(index);
    if (!value) {
      value = { index, folded, stacked: stacked || (index === lastIndex && lastOnOwnRow), fill: props.fill === true, register };
      slots.set(index, value);
    }
    return value;
  };
  // `splitLast` keeps every button a direct child of one wrapping row, in
  // every mode: one line shares the room as a plain row does, a stacked
  // button (`width: "100%"`) takes a line of its own, and a row that has not
  // yet learnt its width wraps instead of drawing buttons over each other.
  return (
    <View
      testID={props.testID}
      onLayout={(event) => {
        sizes.current.width = Math.max(0, event.nativeEvent.layout.width - padding - endPadding);
        refold();
      }}
      style={[{ flexDirection: "row", width: "100%", minWidth: 0, alignSelf: "stretch", gap }, props.style, props.splitLast ? { flexWrap: "wrap" } : stacked ? { flexDirection: "column", alignItems: "stretch" } : null]}
    >
      {children.map((child, index) => <ActionContext.Provider key={index} value={slot(index)}>{child}</ActionContext.Provider>)}
    </View>
  );
}

/**
 * Each label's width by its text and type, the widest reading kept: every
 * card's Stop is as wide as the first one measured, so a card that mounts
 * knows its buttons' widths at once instead of measuring them again.
 */
const labelWidths = new Map<string, number>();

/** Tests: forget the measured labels. */
export function resetActionWidths(): void {
  labelWidths.clear();
}

/**
 * A measured width rounded up to whole points, ignoring float noise: native
 * Yoga snaps frames to the pixel grid in float32, so a 24 pt label can read
 * 24.000004, which a plain `Math.ceil` makes 25.
 */
export function layoutCeil(width: number): number {
  return Math.ceil(width - 0.01);
}

/**
 * Measure the untruncated label once per text/typography change, retaining it
 * while icon-only. `keep` marks the row's main answer, folded last. A
 * `labelOnly` button (a question's written option) has no icon to fold to and
 * stays visible: the others fold first, then its label can shrink if needed.
 * A `wrap` button never folds either, nor shrinks on its row: its row stacks
 * (`ActionRow`'s `stack`) when it does not fit, and there its label wraps
 * between words.
 */
export function useActionFit(label: string, typography: string, iconWidth: number, chromeWidth: number, square = false, keep = false, labelOnly = false, wrap = false) {
  const context = useContext(ActionContext);
  const id = useId();
  const key = `${label}|${typography}`;
  // The button's height and chrome tell a compact card's button from a full one, whose label may be set larger.
  const cacheKey = `${key}|${iconWidth}|${chromeWidth}`;
  const [measured, setMeasured] = useState<{ key: string; width: number } | null>(() => {
    const known = labelWidths.get(cacheKey);
    return known === undefined ? null : { key, width: known };
  });
  const labelWidth = measured?.key === key ? measured.width : labelWidths.get(cacheKey) ?? null;
  const full = square ? iconWidth : labelWidth === null ? null : Math.max(iconWidth, labelWidth + chromeWidth);
  const register = context?.register;
  const index = context?.index ?? 0;
  useLayoutEffect(() => {
    if (register && full !== null) return register({ id, index, full, icon: labelOnly || wrap ? full : iconWidth, keep });
  }, [register, id, index, full, iconWidth, keep, labelOnly, wrap]);
  const iconOnly = square || (!labelOnly && !wrap && full !== null && context?.folded.has(id) === true);
  const stacked = context?.stacked === true;
  const labelLayout = context ? (event: LayoutChangeEvent) => {
    const width = Math.max(layoutCeil(event.nativeEvent.layout.width), labelWidths.get(cacheKey) ?? 0);
    labelWidths.set(cacheKey, width);
    // Native snaps a label to the pixel grid by where it sits, so a 45.9 pt
    // label reads 46 or 46.33 as the row moves it, and rounding up flipped
    // the button between two widths forever. The text and type are the
    // key, so its true width cannot shrink: keep the widest reading.
    setMeasured((old) => old?.key === key && old.width >= width ? old : { key, width });
  } : undefined;
  let style: ViewStyle | undefined;
  if (context && iconOnly) style = { width: iconWidth, minWidth: iconWidth, flexGrow: 0, flexShrink: 0, paddingHorizontal: 0 };
  else if (context?.fill && stacked) style = { width: "100%", minWidth: 0, flexGrow: 0, flexShrink: 1, flexBasis: "auto" };
  else if (context?.fill && full !== null) style = { minWidth: full, flexGrow: 1, flexShrink: 0, flexBasis: 0 };
  // Measure the whole label before constraining it to an equal share of the row.
  else if (context && ((labelOnly && !wrap) || (wrap && stacked))) style = { minWidth: 0, flexShrink: 1 };
  else if (context) style = { minWidth: full ?? iconWidth, flexShrink: 0 };
  // A wrapping label keeps its one-line width on a row, so it is measured whole; stacked, it may wrap.
  return { iconOnly, labelLayout, style, full, stacked, labelStyle: context ? { flexShrink: (labelOnly && !wrap) || (wrap && stacked) ? 1 : 0 } : undefined };
}
