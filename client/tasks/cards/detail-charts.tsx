import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type TextStyle, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { mix } from "../../components/theme-tokens";
import { ProgressRing } from "../../ui/progress-ring";
import type { TasksLanguage } from "../i18n";
import type { StatusKind } from "../model";
import { TaskText as Text, HOST_FONT as F, HOST_LINE } from "../typography";
import {
  formatExact,
  formatShare,
  formatSpan,
  statusTone,
  timelineFractions,
  type ContextView,
  type StatusTone,
  type SummaryTile,
  type Timeline,
  type TokenMix,
  type TokenPart,
} from "./detail-model";
import { formatTokens } from "./format";
import { cardStrings } from "./strings";
import type { TaskTokens } from "./tokens";

/**
 * The details card's charts (`docs/prototypes/task-details-rich.md`, board 6),
 * every one drawn with Views: the plugin sandbox has no SVG. Tooltips show on
 * hover with a pointer and on a tap with touch, where a tap elsewhere or 3 s
 * hides them.
 */

/** The colours the charts mix from the card (prototype 6 §4). */
export interface DetailColors {
  sunk: string;
  rowHover: string;
  /** A pressed row: a step past the hover. */
  rowPress: string;
  track: string;
  pastSpan: string;
  tokens: Record<TokenPart, string>;
  errorFill: string;
  errorBorder: string;
  tipFill: string;
  tipText: string;
  tipMuted: string;
}

const colorCache = new WeakMap<TaskTokens, DetailColors>();

export function detailColors(tokens: TaskTokens): DetailColors {
  let colors = colorCache.get(tokens);
  if (!colors) {
    const card = tokens.card.background;
    const fg = tokens.foreground;
    colors = {
      sunk: mix(card, fg, 0.025),
      rowHover: mix(card, fg, 0.05),
      rowPress: mix(card, fg, 0.08),
      track: mix(card, fg, 0.09),
      pastSpan: mix(card, fg, 0.16),
      tokens: { cached: mix(card, tokens.accent, 0.32), input: tokens.accent, output: mix(card, fg, 0.45) },
      errorFill: mix(card, tokens.danger, 0.06),
      errorBorder: mix(card, tokens.danger, 0.28),
      tipFill: fg,
      tipText: card,
      tipMuted: mix(fg, card, 0.65),
    };
    colorCache.set(tokens, colors);
  }
  return colors;
}

export function toneColor(tone: StatusTone, tokens: TaskTokens): string {
  if (tone === "running") return tokens.status.running;
  if (tone === "warning") return tokens.status.warning;
  if (tone === "success") return tokens.status.success;
  if (tone === "danger") return tokens.status.danger;
  return tokens.foregroundMuted;
}

export function statusColor(status: StatusKind, tokens: TaskTokens): string {
  return toneColor(statusTone(status), tokens);
}

export function contextColor(view: ContextView, tokens: TaskTokens): string {
  return view.level === "danger" ? tokens.danger : view.level === "warning" ? tokens.warning : tokens.foregroundMuted;
}

/**
 * Which tooltip shows, and how it is asked for: hover with a pointer, a tap
 * with touch (a second tap or 3 s hides it).
 */
function useTip<K extends string>(touch: boolean) {
  const [tip, setTip] = useState<K | null>(null);
  useEffect(() => {
    if (!touch || tip === null) return;
    const timer = setTimeout(() => setTip(null), 3000);
    return () => clearTimeout(timer);
  }, [touch, tip]);
  const bind = (key: K) =>
    touch
      ? { onPress: () => setTip((was) => (was === key ? null : key)) }
      : { onHoverIn: () => setTip(key), onHoverOut: () => setTip((was) => (was === key ? null : was)) };
  return { tip, bind };
}

/** A dark tooltip: a title and a muted line, above its anchor. */
function Tip(props: { colors: DetailColors; title: string; sub: string; style: ViewStyle; testID?: string }) {
  return (
    <View
      pointerEvents="none"
      testID={props.testID}
      style={[
        { position: "absolute", zIndex: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: props.colors.tipFill, boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.14)" } as ViewStyle,
        props.style,
      ]}
    >
      <Text numberOfLines={1} style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, fontWeight: "500", color: props.colors.tipText }}>
        {props.title}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: props.colors.tipMuted }}>
        {props.sub}
      </Text>
    </View>
  );
}

/** A tooltip at `at` px along a track `width` wide, kept inside it. */
function TrackTip(props: { colors: DetailColors; title: string; sub: string; at: number; width: number; bottom: number; testID?: string }) {
  const [tipWidth, setTipWidth] = useState(0);
  const left = Math.max(0, Math.min(props.at - tipWidth / 2, props.width - tipWidth));
  return (
    <View
      pointerEvents="none"
      onLayout={(event: LayoutChangeEvent) => setTipWidth(event.nativeEvent.layout.width)}
      style={{ position: "absolute", zIndex: 5, bottom: props.bottom, left, opacity: tipWidth > 0 ? 1 : 0 }}
    >
      <Tip colors={props.colors} title={props.title} sub={props.sub} style={{ position: "relative" }} testID={props.testID} />
    </View>
  );
}

function useWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (event) => setWidth(Math.round(event.nativeEvent.layout.width))];
}

/** A label row over a chart: icon, muted label, then whatever sits on the right. */
function ChartHead(props: { icon: string; label: string; font: number; tokens: TaskTokens; children?: React.ReactNode }) {
  return (
    <View style={{ minHeight: 20, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name={props.icon} size={14} color={props.tokens.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: props.font, color: props.tokens.foregroundMuted }}>
        {props.label}
      </Text>
      <View style={{ flex: 1 }} />
      {props.children}
    </View>
  );
}

const dashed = (tokens: TaskTokens, height: number): ViewStyle => ({ height, borderRadius: height / 2, borderWidth: 1, borderStyle: "dashed", borderColor: tokens.border });

// ---- The running turn ------------------------------------------------------

/** With a cost, the running turn's box: one row of three from this width up, under it the context drops to a row of its own (hysteresis like the properties' label column). */
const TURN_ROW = { show: 420, hide: 412 };

/**
 * Running: the turn's timer, the cost so far and the context ring, cells in
 * one sunk box. A narrow box keeps the timer and the cost side by side and
 * gives the context, ring and all, the row under them. Without a reported
 * cost there is no cost cell: the timer beside the context.
 */
export function TurnHero(props: { timer: string; lastTurn: string | null; cost: string | null; context: ContextView | null; tokens: TaskTokens; touch: boolean; language: TasksLanguage }) {
  const { tokens, context } = props;
  const colors = detailColors(tokens);
  const words = cardStrings(props.language).details;
  const { tip, bind } = useTip<"context">(props.touch);
  const [row, setRow] = useState(false);
  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setRow((was) => (width >= TURN_ROW.show ? true : width < TURN_ROW.hide ? false : was));
  };
  const small = F.sm;
  const tone = context ? contextColor(context, tokens) : tokens.foregroundMuted;
  const cell: ViewStyle = { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10, gap: 2 };
  const big: TextStyle = { fontSize: F["2xl"], lineHeight: HOST_LINE["2xl"], fontWeight: "600", color: tokens.foreground, fontVariant: ["tabular-nums"] };
  const sub: TextStyle = { fontSize: F.sm, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] };
  const head = (icon: string, label: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Icon name={icon} size={14} color={tokens.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: small, color: tokens.foregroundMuted }}>
        {label}
      </Text>
    </View>
  );
  const timer = (
    <View style={cell}>
      {head("Timer", words.turnTimer)}
      <Text testID="detail-turn-timer" numberOfLines={1} style={big}>
        {props.timer}
      </Text>
      <Text numberOfLines={1} style={sub}>
        {words.lastTurn(props.lastTurn ?? "—")}
      </Text>
    </View>
  );
  const cost = props.cost === null ? null : (
    <View testID="detail-turn-cost" style={[cell, { borderLeftWidth: 1, borderLeftColor: tokens.border }]}>
      {head("Coins", words.cost)}
      <Text numberOfLines={1} style={big}>
        {props.cost}
      </Text>
      <Text numberOfLines={1} style={sub}>
        {words.total}
      </Text>
    </View>
  );
  const stacked = cost !== null && !row;
  const contextCell = (
    <Pressable
      accessibilityRole={props.touch ? "button" : undefined}
      accessibilityLabel={context ? `${words.context} ${context.percent}` : undefined}
      {...(context ? bind("context") : {})}
      testID="detail-context"
      style={[
        { minWidth: 0, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
        stacked ? { borderTopWidth: 1, borderTopColor: tokens.border } : { flex: cost ? 1.4 : 1, borderLeftWidth: 1, borderLeftColor: tokens.border },
      ]}
    >
      {context ? (
        <ProgressRing value={context.ratio} max={1} size={44} stroke={4} color={tone} trackColor={colors.track} />
      ) : (
        <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderStyle: "dashed", borderColor: tokens.border }} />
      )}
      <View style={{ flexShrink: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: small, color: tokens.foregroundMuted }}>
          {words.context}
        </Text>
        {context ? (
          <>
            <Text style={[big, context.level === "normal" ? null : { color: tone }]}>{context.percent}</Text>
            <Text numberOfLines={1} style={sub}>
              {context.text}
            </Text>
          </>
        ) : (
          <Text style={{ fontSize: F.sm, color: tokens.foregroundMuted }}>{words.notReported}</Text>
        )}
      </View>
      {tip === "context" && context ? (
        <Tip colors={colors} title={`${words.context} · ${context.percent}`} sub={words.tokensUnit(context.exact)} style={{ bottom: "100%", left: 12, marginBottom: 6 }} testID="detail-context-tip" />
      ) : null}
    </Pressable>
  );
  return (
    <View testID="detail-turn" onLayout={onLayout} style={{ borderWidth: 1, borderColor: tokens.border, borderRadius: 10, backgroundColor: colors.sunk }}>
      {!stacked ? (
        <View style={{ flexDirection: "row" }}>
          {timer}
          {cost}
          {contextCell}
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row" }}>
            {timer}
            {cost}
          </View>
          {contextCell}
        </>
      )}
    </View>
  );
}

// ---- Usage -----------------------------------------------------------------

/** The context bar with notches at 75% and 90%, outside the running turn. */
export function ContextBar(props: { context: ContextView | null; tokens: TaskTokens; touch: boolean; language: TasksLanguage; font: number }) {
  const { context, tokens } = props;
  const colors = detailColors(tokens);
  const words = cardStrings(props.language).details;
  const { tip, bind } = useTip<"context">(props.touch);
  if (!context) {
    return (
      <View testID="detail-context-bar">
        <ChartHead icon="Gauge" label={words.context} font={props.font} tokens={tokens}>
          <Text style={{ fontSize: props.font, color: tokens.foregroundMuted }}>{words.notReported}</Text>
        </ChartHead>
        <View style={[dashed(tokens, 6), { marginTop: 8 }]} />
      </View>
    );
  }
  const tone = contextColor(context, tokens);
  return (
    <Pressable {...bind("context")} accessibilityLabel={`${words.context} ${context.percent}`} testID="detail-context-bar" style={{ position: "relative" }}>
      <ChartHead icon="Gauge" label={words.context} font={props.font} tokens={tokens}>
        <Text style={{ fontSize: props.font, fontWeight: "600", color: context.level === "normal" ? tokens.foreground : tone, fontVariant: ["tabular-nums"] }}>{context.percent}</Text>
        <Text style={{ fontSize: props.font, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{context.text}</Text>
      </ChartHead>
      <View style={{ height: 6, marginTop: 8, borderRadius: 3, backgroundColor: colors.track, overflow: "hidden" }}>
        <View style={{ width: `${Math.min(context.ratio, 1) * 100}%`, height: 6, borderRadius: 3, backgroundColor: tone }} />
        <View style={{ position: "absolute", left: "75%", top: 0, bottom: 0, width: 2, backgroundColor: tokens.card.background }} />
        <View style={{ position: "absolute", left: "90%", top: 0, bottom: 0, width: 2, backgroundColor: tokens.card.background }} />
      </View>
      {tip === "context" ? (
        <Tip colors={colors} title={`${words.context} · ${context.percent}`} sub={words.tokensUnit(context.exact)} style={{ bottom: "100%", right: 0, marginBottom: 4 }} testID="detail-context-tip" />
      ) : null}
    </Pressable>
  );
}

/** Cached input, new input and output as one stacked bar with a legend; a segment's tooltip has its exact count. */
export function TokenBar(props: { mix: TokenMix | null; tokens: TaskTokens; touch: boolean; language: TasksLanguage; font: number }) {
  const { mix: tokenMix, tokens } = props;
  const colors = detailColors(tokens);
  const words = cardStrings(props.language).details;
  const { tip, bind } = useTip<TokenPart>(props.touch);
  const [width, onLayout] = useWidth();
  let before = 0;
  const mids: Partial<Record<TokenPart, number>> = {};
  for (const segment of tokenMix?.segments ?? []) {
    mids[segment.part] = before + segment.share / 2;
    before += segment.share;
  }
  const shown = tokenMix?.segments.find((segment) => segment.part === tip);
  return (
    <View testID="detail-tokens">
      <ChartHead icon="Layers" label={words.tokenMix} font={props.font} tokens={tokens}>
        <Text style={{ fontSize: props.font, fontWeight: "600", color: tokenMix ? tokens.foreground : tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>
          {tokenMix ? formatTokens(tokenMix.total) : "—"}
        </Text>
      </ChartHead>
      {tokenMix ? (
        <>
          <View onLayout={onLayout} style={{ position: "relative", marginTop: 8 }}>
            <View style={{ flexDirection: "row", gap: 2, height: 8 }}>
              {tokenMix.segments.map((segment) => (
                <Pressable
                  key={segment.part}
                  {...bind(segment.part)}
                  accessibilityLabel={`${words.tokenParts[segment.part]} ${formatTokens(segment.tokens)}`}
                  testID={`detail-tokens-${segment.part}`}
                  style={{ flexGrow: segment.tokens, flexBasis: 0, minWidth: 3, borderRadius: 2, backgroundColor: colors.tokens[segment.part], opacity: tip && tip !== segment.part ? 0.4 : 1 }}
                />
              ))}
            </View>
            {shown ? (
              <TrackTip
                colors={colors}
                title={`${words.tokenParts[shown.part]} · ${words.tokensUnit(formatExact(shown.tokens))}`}
                sub={words.tokenShare(formatShare(shown.share), formatExact(tokenMix.total))}
                at={(mids[shown.part] ?? 0.5) * width}
                width={width}
                bottom={14}
                testID="detail-tokens-tip"
              />
            ) : null}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4, marginTop: 8 }}>
            {tokenMix.segments.map((segment) => (
              <View key={segment.part} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors.tokens[segment.part] }} />
                <Text style={{ fontSize: F.sm, color: tokens.foregroundMuted }}>{words.tokenParts[segment.part]}</Text>
                <Text style={{ fontSize: F.sm, color: tokens.foreground, fontVariant: ["tabular-nums"] }}>{formatTokens(segment.tokens)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <>
          <View style={[dashed(tokens, 8), { marginTop: 8, borderRadius: 2 }]} />
          <Text style={{ marginTop: 6, fontSize: F.sm, color: tokens.foregroundMuted }}>{words.noTokens}</Text>
        </>
      )}
    </View>
  );
}

/**
 * Text in runs a line may break between and nowhere else: each run its own
 * text in a wrapping row, so a narrow tile breaks a CJK label between its
 * words rather than leaving one character on a line of its own. A run wider than the row
 * still wraps inside itself.
 */
function Runs(props: { runs: string[]; style: TextStyle }) {
  return (
    <View style={{ flexShrink: 1, flexDirection: "row", flexWrap: "wrap" }}>
      {props.runs.map((run, index) => (
        <Text key={index} style={props.style}>
          {run}
        </Text>
      ))}
    </View>
  );
}

// ---- Activity --------------------------------------------------------------

const LABEL_WIDTH = 96;
const SPAN_WIDTH = 64;
/** The end point's status icon box, backed by the card so the track stops short of a ring. */
const END_MARK = 14;

/**
 * The card's life on one track: a point per moment with its name and time
 * under it, each span's length above it. Spans are as long as their time but
 * never so short that the labels collide; the last one takes the status
 * colour while it is still going. `endMark` replaces the last point's dot.
 */
export function TimelineChart(props: { timeline: Timeline; liveColor: string; tokens: TaskTokens; endMark?: React.ReactNode }) {
  const { timeline: line, tokens } = props;
  const colors = detailColors(tokens);
  const [measured, onLayout] = useWidth();
  const width = measured || 320;
  const spans = line.points.slice(1).map((point, index) => point.at - line.points[index]!.at);
  const fractions = timelineFractions(spans, width);
  const at: number[] = [0];
  for (const fraction of fractions) at.push(at[at.length - 1]! + fraction);
  const lastIndex = line.points.length - 1;
  const spanColor = (index: number) => (line.live && index === spans.length - 1 ? props.liveColor : colors.pastSpan);
  return (
    <View testID="detail-timeline" style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 2 }}>
      <View onLayout={onLayout} style={{ position: "relative", height: 66 }}>
        {spans.map((span, index) => (
          <Text
            key={`span-${index}`}
            numberOfLines={1}
            style={{ position: "absolute", top: 0, left: (at[index]! + fractions[index]! / 2) * width - SPAN_WIDTH / 2, width: SPAN_WIDTH, textAlign: "center", fontSize: F.sm, color: line.live && index === spans.length - 1 ? props.liveColor : tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}
          >
            {formatSpan(span)}
          </Text>
        ))}
        <View style={{ position: "absolute", top: 20, left: 0, right: 0, height: 2, borderRadius: 1, backgroundColor: colors.track }} />
        {fractions.map((fraction, index) => (
          <View key={`seg-${index}`} style={{ position: "absolute", top: 20, left: at[index]! * width, width: fraction * width, height: 2, backgroundColor: spanColor(index) }} />
        ))}
        {line.points.map((point, index) => {
          const last = index === lastIndex;
          const color = last && line.live ? props.liveColor : null;
          const edge = index === 0 ? "start" : last ? "end" : "middle";
          const labelLeft = edge === "start" ? 0 : edge === "end" ? width - LABEL_WIDTH : at[index]! * width - LABEL_WIDTH / 2;
          return (
            <React.Fragment key={point.key}>
              {last && props.endMark ? (
                <View
                  testID="detail-timeline-end-mark"
                  style={{
                    position: "absolute",
                    top: 21 - END_MARK / 2,
                    left: at[index]! * width - END_MARK / 2,
                    width: END_MARK,
                    height: END_MARK,
                    borderRadius: END_MARK / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: tokens.card.background,
                  }}
                >
                  {props.endMark}
                </View>
              ) : (
                <View
                  style={{
                    position: "absolute",
                    top: 17,
                    left: at[index]! * width - 4,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    borderWidth: 1.5,
                    borderColor: color ?? tokens.foregroundMuted,
                    backgroundColor: color ?? tokens.card.background,
                  }}
                />
              )}
              <View style={{ position: "absolute", top: 32, left: labelLeft, width: LABEL_WIDTH }} testID={`detail-timeline-${point.key}`}>
                <Text numberOfLines={1} style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted, textAlign: edge === "start" ? "left" : edge === "end" ? "right" : "center" }}>
                  {point.name}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foreground, textAlign: edge === "start" ? "left" : edge === "end" ? "right" : "center" }}>
                  {point.time}
                </Text>
              </View>
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

// ---- Review and done -------------------------------------------------------

/** Three cells: the last turn's length, the cost, the tokens; "—" when not reported. */
export function SummaryTiles(props: { tiles: SummaryTile[]; tokens: TaskTokens; touch: boolean }) {
  const { tokens } = props;
  const colors = detailColors(tokens);
  const small = F.sm;
  return (
    <View testID="detail-summary" style={{ flexDirection: "row", gap: 1, borderWidth: 1, borderColor: tokens.border, borderRadius: 10, backgroundColor: tokens.border, overflow: "hidden" }}>
      {props.tiles.map((tile) => (
        <View key={tile.key} testID={`detail-summary-${tile.key}`} style={{ flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10, gap: 2, backgroundColor: colors.sunk }}>
          {/* Labels wrap rather than cut: a larger interface size or a narrow column leaves a tile little room. */}
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 5 }}>
            <View style={{ height: HOST_LINE.sm, justifyContent: "center" }}>
              <Icon name={tile.icon} size={14} color={tokens.foregroundMuted} />
            </View>
            <Runs runs={tile.labelRuns} style={{ fontSize: small, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }} />
          </View>
          <Text numberOfLines={1} style={{ fontSize: F.lg, lineHeight: HOST_LINE.lg, fontWeight: "600", color: tile.value ? tokens.foreground : tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>
            {tile.value ?? "—"}
          </Text>
          <Runs runs={tile.subRuns} style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }} />
        </View>
      ))}
    </View>
  );
}

/** A hairline-outlined pill: a lead (dot, icon, mark) and its text. */
export function Chip(props: { tokens: TaskTokens; lead?: React.ReactNode; text: string; muted?: boolean; height: number; font: number; testID?: string }) {
  return (
    <View
      testID={props.testID}
      style={{ height: props.height, paddingLeft: 6, paddingRight: 8, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: props.tokens.card.pillBorder, flexDirection: "row", alignItems: "center", gap: 5 }}
    >
      {props.lead}
      <Text numberOfLines={1} style={{ fontSize: props.font, color: props.muted ? props.tokens.foregroundMuted : props.tokens.foreground }}>
        {props.text}
      </Text>
    </View>
  );
}

