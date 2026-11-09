/**
 * Lays a `react-test-renderer` host tree (from `rn-mock`) out with Yoga, the
 * way React Native's Fabric renderer does on a phone, then answers each
 * `onLayout` with the computed frame.
 *
 * Fabric runs Yoga with every erratum on (`YGErrataAll` in
 * `YogaLayoutableShadowNode::layoutTree`, React Native 0.86), including
 * `StretchFlexBasis`: a flex item whose content holds a growing child can take
 * the whole row as its flex basis. Browsers and hand-fed `onLayout` widths do
 * not show that, so a row can fit in every other test and still run off a
 * phone's screen. Text is measured by a fixed per-glyph estimate, which keeps
 * the label widths stable across machines.
 */
import Yoga, { Align, Direction, Display, Edge, Errata, FlexDirection, Gutter, Justify, MeasureMode, Overflow, PositionType, Wrap, type Node } from "yoga-layout";
import { act, type ReactTestInstance } from "react-test-renderer";

type Style = Record<string, unknown>;

export interface Frame {
  /** Relative to the laid-out root. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface YogaLayoutOptions {
  /** The width the root's container offers, as a card's content column does. */
  width: number;
  /** Physical pixels per layout point. */
  pixelScale?: number;
  /** Multiplies every text width, as a larger system font does. */
  textScale?: number;
  /**
   * Wrap a text narrower than its estimate onto more lines, up to its
   * `numberOfLines`, as a title does. Off: every text is one line tall.
   */
  wrapText?: boolean;
}

/** Host element types that sit in a separate native layer, outside the row. */
const DETACHED = new Set(["Modal"]);

function flatten(style: unknown): Style {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return typeof style === "object" ? (style as Style) : {};
}

/** The host elements directly under `node`, looking through function components. */
export function hostChildren(node: ReactTestInstance): ReactTestInstance[] {
  return node.children.flatMap((child) =>
    typeof child === "string" ? [] : typeof child.type === "string" ? [child] : hostChildren(child),
  );
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

/** A rough, stable glyph width: CJK at one em, Latin at a little over half. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const wide = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef);
    width += fontSize * (wide ? 1 : char === " " ? 0.28 : 0.56);
  }
  return Math.ceil(width);
}

const ALIGN: Record<string, Align> = {
  auto: Align.Auto,
  "flex-start": Align.FlexStart,
  center: Align.Center,
  "flex-end": Align.FlexEnd,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
  "space-between": Align.SpaceBetween,
  "space-around": Align.SpaceAround,
};
const JUSTIFY: Record<string, Justify> = {
  "flex-start": Justify.FlexStart,
  center: Justify.Center,
  "flex-end": Justify.FlexEnd,
  "space-between": Justify.SpaceBetween,
  "space-around": Justify.SpaceAround,
  "space-evenly": Justify.SpaceEvenly,
};
const DIRECTION: Record<string, FlexDirection> = {
  row: FlexDirection.Row,
  column: FlexDirection.Column,
  "row-reverse": FlexDirection.RowReverse,
  "column-reverse": FlexDirection.ColumnReverse,
};

type Length = number | "auto" | `${number}%` | undefined;
const length = (value: unknown): Length =>
  typeof value === "number" ? value : value === "auto" ? "auto" : typeof value === "string" && /^-?[\d.]+%$/.test(value) ? (value as `${number}%`) : undefined;

const EDGES: Array<[string, Edge]> = [
  ["", Edge.All],
  ["Horizontal", Edge.Horizontal],
  ["Vertical", Edge.Vertical],
  ["Top", Edge.Top],
  ["Right", Edge.Right],
  ["Bottom", Edge.Bottom],
  ["Left", Edge.Left],
  ["Start", Edge.Start],
  ["End", Edge.End],
];

function applyStyle(node: Node, style: Style) {
  const s = style;
  if (s.display === "none") node.setDisplay(Display.None);
  if (s.position === "absolute") node.setPositionType(PositionType.Absolute);
  if (typeof s.flexDirection === "string") node.setFlexDirection(DIRECTION[s.flexDirection]!);
  if (s.flexWrap === "wrap") node.setFlexWrap(Wrap.Wrap);
  if (s.flexWrap === "wrap-reverse") node.setFlexWrap(Wrap.WrapReverse);
  if (typeof s.justifyContent === "string") node.setJustifyContent(JUSTIFY[s.justifyContent]!);
  if (typeof s.alignItems === "string") node.setAlignItems(ALIGN[s.alignItems]!);
  if (typeof s.alignSelf === "string") node.setAlignSelf(ALIGN[s.alignSelf]!);
  if (typeof s.alignContent === "string") node.setAlignContent(ALIGN[s.alignContent]!);
  if (s.overflow === "hidden") node.setOverflow(Overflow.Hidden);
  if (s.overflow === "scroll") node.setOverflow(Overflow.Scroll);
  // React Native's `flex` is Yoga's own shorthand, resolved by Yoga.
  if (typeof s.flex === "number") node.setFlex(s.flex);
  if (typeof s.flexGrow === "number") node.setFlexGrow(s.flexGrow);
  if (typeof s.flexShrink === "number") node.setFlexShrink(s.flexShrink);
  if (s.flexBasis !== undefined) node.setFlexBasis(length(s.flexBasis));
  if (s.width !== undefined) node.setWidth(length(s.width));
  if (s.height !== undefined) node.setHeight(length(s.height));
  if (s.minWidth !== undefined) node.setMinWidth(length(s.minWidth) as number | `${number}%` | undefined);
  if (s.minHeight !== undefined) node.setMinHeight(length(s.minHeight) as number | `${number}%` | undefined);
  if (s.maxWidth !== undefined) node.setMaxWidth(length(s.maxWidth) as number | `${number}%` | undefined);
  if (s.maxHeight !== undefined) node.setMaxHeight(length(s.maxHeight) as number | `${number}%` | undefined);
  if (typeof s.aspectRatio === "number") node.setAspectRatio(s.aspectRatio);
  for (const [suffix, edge] of EDGES) {
    const margin = s[`margin${suffix}`];
    if (margin !== undefined) node.setMargin(edge, length(margin));
    const padding = s[`padding${suffix}`];
    if (padding !== undefined) node.setPadding(edge, length(padding) as number | `${number}%` | undefined);
    const border = s[`border${suffix}Width`];
    if (typeof border === "number") node.setBorder(edge, border);
    if (suffix && suffix !== "Horizontal" && suffix !== "Vertical") {
      const offset = s[suffix.toLowerCase()];
      if (offset !== undefined) node.setPosition(edge, length(offset) as number | `${number}%` | undefined);
    }
  }
  if (typeof s.gap === "number") node.setGap(Gutter.All, s.gap);
  if (typeof s.rowGap === "number") node.setGap(Gutter.Row, s.rowGap);
  if (typeof s.columnGap === "number") node.setGap(Gutter.Column, s.columnGap);
}

/**
 * One layout pass of `root` inside a column `options.width` wide. Returns
 * every host node's frame, relative to `root`'s container.
 */
export function measureHostTree(root: ReactTestInstance, options: YogaLayoutOptions): Map<ReactTestInstance, Frame> {
  const config = Yoga.Config.create();
  config.setErrata(Errata.All);
  config.setPointScaleFactor(options.pixelScale ?? 3);
  const scale = options.textScale ?? 1;
  const nodes = new Map<ReactTestInstance, Node>();

  const build = (instance: ReactTestInstance): Node => {
    const node = Yoga.Node.create(config);
    nodes.set(instance, node);
    const style = flatten(instance.props.style);
    applyStyle(node, style);
    const type = String(instance.type);
    if (type === "Icon") {
      const size = typeof instance.props.size === "number" ? instance.props.size : 16;
      node.setWidth(size);
      node.setHeight(size);
    } else if (type === "Text" || type === "Animated.Text") {
      const fontSize = typeof style.fontSize === "number" ? style.fontSize : 14;
      const lineHeight = typeof style.lineHeight === "number" ? style.lineHeight : Math.ceil(fontSize * 1.25);
      const intrinsic = estimateTextWidth(textOf(instance), fontSize) * scale;
      const maxLines = typeof instance.props.numberOfLines === "number" && instance.props.numberOfLines > 0 ? instance.props.numberOfLines : Infinity;
      node.setMeasureFunc((width, widthMode) => {
        const shown = widthMode === MeasureMode.Exactly ? width : widthMode === MeasureMode.AtMost ? Math.min(width, intrinsic) : intrinsic;
        const lines = options.wrapText && widthMode !== MeasureMode.Undefined && width > 0 ? Math.min(maxLines, Math.max(1, Math.ceil(intrinsic / width))) : 1;
        return { width: shown, height: lineHeight * lines };
      });
    } else {
      hostChildren(instance)
        .filter((child) => !DETACHED.has(String(child.type)))
        .forEach((child, index) => node.insertChild(build(child), index));
    }
    return node;
  };

  const container = Yoga.Node.create(config);
  container.setWidth(options.width);
  container.insertChild(build(root), 0);
  container.calculateLayout(undefined, undefined, Direction.LTR);

  const frames = new Map<ReactTestInstance, Frame>();
  const walk = (instance: ReactTestInstance, x: number, y: number) => {
    const node = nodes.get(instance)!;
    const left = x + node.getComputedLeft();
    const top = y + node.getComputedTop();
    frames.set(instance, { left, top, width: node.getComputedWidth(), height: node.getComputedHeight() });
    for (const child of hostChildren(instance)) if (nodes.has(child)) walk(child, left, top);
  };
  walk(root, 0, 0);
  container.freeRecursive();
  config.free();
  return frames;
}

/**
 * Lay `find()` out, answer every `onLayout` under it with its frame, and
 * repeat until the frames stop changing, as a native row settles after its
 * labels report their widths. `find` runs again after each render.
 */
export async function settleHostLayout(find: () => ReactTestInstance, options: YogaLayoutOptions): Promise<Map<ReactTestInstance, Frame>> {
  let previous = "";
  for (let pass = 0; pass < 8; pass++) {
    const root = find();
    const frames = measureHostTree(root, options);
    const signature = [...frames.values()].map((frame) => `${frame.left},${frame.top},${frame.width},${frame.height}`).join(";");
    if (signature === previous) return frames;
    previous = signature;
    await act(async () => {
      for (const [instance, frame] of frames) {
        const onLayout = instance.props.onLayout as ((event: unknown) => void) | undefined;
        if (typeof onLayout !== "function") continue;
        const parent = instance === root ? { left: 0, top: 0 } : nearestFrame(instance, frames);
        onLayout({ nativeEvent: { layout: { x: frame.left - parent.left, y: frame.top - parent.top, width: frame.width, height: frame.height } } });
      }
    });
  }
  throw new Error("host layout did not settle in 8 passes");
}

function nearestFrame(instance: ReactTestInstance, frames: Map<ReactTestInstance, Frame>): Frame | { left: number; top: number } {
  for (let parent = instance.parent; parent; parent = parent.parent) {
    const frame = frames.get(parent);
    if (frame) return frame;
  }
  return { left: 0, top: 0 };
}
