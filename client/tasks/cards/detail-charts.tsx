import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent, type TextStyle, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { mix } from "../../components/theme-tokens";
import { ProgressRing } from "../../ui/progress-ring";
import type { TasksLanguage } from "../i18n";
import type { StatusKind } from "../model";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, taskControlHeight, useTasksFontScale } from "../typography";
import {
  formatExact,
  formatShare,
  formatSpan,
  statusTone,
  timelineFractions,
  type ContextView,
  type StatusTone,
  type SummaryReadout,
  type Timeline,
  type TokenMix,
  type TokenPart,
} from "./detail-model";
import { formatTokens } from "./format";
import { cardStrings } from "./strings";
import type { TaskTokens } from "./tokens";
import { useHover } from "../../ui/use-hover";
import { tipProps } from "./card-hints";
import { webTransition } from "./action-style";

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

/**
 * Running: the turn's timer beside the context ring in one sunk box. With the
 * session's tokens the box holds three alike cells in one row, timer, tokens
 * and context, and the ring shrinks to the context's label icon.
 */
/** `timerOnly`: a provider subagent's run, which has no turns or context of its own to report. */
export function TurnHero(props: { timer: string; lastTurn: string | null; total: { value: string; sub: string } | null; context: ContextView | null; tokens: TaskTokens; touch: boolean; language: TasksLanguage; timerOnly?: boolean }) {
  const { tokens, context } = props;
  const colors = detailColors(tokens);
  const words = cardStrings(props.language).details;
  const { tip, bind } = useTip<"context">(props.touch);
  const compact = props.total !== null;
  const small = F.sm;
  const tone = context ? contextColor(context, tokens) : tokens.foregroundMuted;
  const cell: ViewStyle = { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10, gap: 2 };
  const divided: ViewStyle = { borderLeftWidth: 1, borderLeftColor: tokens.border };
  const big: TextStyle = { fontSize: F["2xl"], lineHeight: HOST_LINE["2xl"], fontWeight: "600", color: tokens.foreground, fontVariant: ["tabular-nums"] };
  const sub: TextStyle = { fontSize: F.sm, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] };
  const head = (lead: React.ReactNode, label: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      {lead}
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: small, color: tokens.foregroundMuted }}>
        {label}
      </Text>
    </View>
  );
  const ring = (size: number, stroke: number) =>
    context ? (
      <ProgressRing value={context.ratio} max={1} size={size} stroke={stroke} color={tone} trackColor={colors.track} />
    ) : (
      <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: compact ? 1.5 : 2, borderStyle: "dashed", borderColor: tokens.border }} />
    );
  const figures = context ? (
    <>
      <Text numberOfLines={1} style={[big, context.level === "normal" ? null : { color: tone }]}>{context.percent}</Text>
      <Text numberOfLines={1} style={sub}>
        {context.text}
      </Text>
    </>
  ) : (
    <Text style={{ fontSize: F.sm, color: tokens.foregroundMuted }}>{words.notReported}</Text>
  );
  return (
    <View testID="detail-turn" style={{ flexDirection: "row", borderWidth: 1, borderColor: tokens.border, borderRadius: 10, backgroundColor: colors.sunk }}>
      <View style={cell}>
        {head(<Icon name="Timer" size={14} color={tokens.foregroundMuted} />, words.turnTimer)}
        <Text testID="detail-turn-timer" numberOfLines={1} style={big}>
          {props.timer}
        </Text>
        {props.timerOnly ? null : (
          <Text numberOfLines={1} style={sub}>
            {words.lastTurn(props.lastTurn ?? "—")}
          </Text>
        )}
      </View>
      {props.timerOnly ? null : (
        <>
          {compact ? (
            <View testID="detail-turn-tokens" style={[cell, divided]}>
              {head(<Icon name="Layers" size={14} color={tokens.foregroundMuted} />, words.sessionTokens)}
              <Text numberOfLines={1} style={big}>
                {props.total?.value}
              </Text>
              <Text numberOfLines={1} style={sub}>
                {props.total?.sub}
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole={props.touch ? "button" : undefined}
            accessibilityLabel={context ? `${words.context} ${context.percent}` : undefined}
            {...(context ? bind("context") : {})}
            testID="detail-context"
            style={[compact ? cell : { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 }, divided]}
          >
            {compact ? (
              <>
                {head(ring(14, 2), words.context)}
                {figures}
              </>
            ) : (
              <>
                {ring(44, 4)}
                <View style={{ flexShrink: 1, minWidth: 0, gap: 2 }}>
                  <Text numberOfLines={1} style={{ fontSize: small, color: tokens.foregroundMuted }}>
                    {words.context}
                  </Text>
                  {figures}
                </View>
              </>
            )}
            {tip === "context" && context ? (
              <Tip colors={colors} title={`${words.context} · ${context.percent}`} sub={words.tokensUnit(context.exact)} style={{ bottom: "100%", left: 12, marginBottom: 6 }} testID="detail-context-tip" />
            ) : null}
          </Pressable>
        </>
      )}
    </View>
  );
}

// ---- Usage -----------------------------------------------------------------

/** The context bar with notches at 75% and 90%, outside the running turn. */
/** `stacked`: caption, figure and bar on their own lines, for a cell a column wide. */
export function ContextBar(props: { context: ContextView | null; tokens: TaskTokens; touch: boolean; language: TasksLanguage; font: number; stacked?: boolean }) {
  const { context, tokens } = props;
  const colors = detailColors(tokens);
  const words = cardStrings(props.language).details;
  const { tip, bind } = useTip<"context">(props.touch);
  if (!context) {
    return (
      <View testID="detail-context-bar">
        <ChartHead icon="Gauge" label={words.context} font={props.font} tokens={tokens}>
          {props.stacked ? null : <Text style={{ fontSize: props.font, color: tokens.foregroundMuted }}>{words.notReported}</Text>}
        </ChartHead>
        {props.stacked ? <Text numberOfLines={1} style={{ marginTop: 2, fontSize: props.font, color: tokens.foregroundMuted }}>{words.notReported}</Text> : null}
        <View style={[dashed(tokens, 6), { marginTop: 8 }]} />
      </View>
    );
  }
  const tone = contextColor(context, tokens);
  return (
    <Pressable {...bind("context")} accessibilityLabel={`${words.context} ${context.percent}`} testID="detail-context-bar" style={{ position: "relative" }}>
      {props.stacked ? (
        <>
          <ChartHead icon="Gauge" label={words.context} font={props.font} tokens={tokens} />
          <View style={{ minWidth: 0, marginTop: 2, flexDirection: "row", alignItems: "baseline", gap: 6 }}>
            <Text numberOfLines={1} style={{ flexShrink: 0, fontSize: props.font, fontWeight: "600", color: context.level === "normal" ? tokens.foreground : tone, fontVariant: ["tabular-nums"] }}>{context.percent}</Text>
            <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontSize: props.font, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{context.text}</Text>
          </View>
        </>
      ) : (
        <ChartHead icon="Gauge" label={words.context} font={props.font} tokens={tokens}>
          <Text style={{ fontSize: props.font, fontWeight: "600", color: context.level === "normal" ? tokens.foreground : tone, fontVariant: ["tabular-nums"] }}>{context.percent}</Text>
          <Text style={{ fontSize: props.font, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{context.text}</Text>
        </ChartHead>
      )}
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
/** `stacked`: caption, total, bar and a wrapping legend on their own lines, for a cell a column wide. */
export function TokenBar(props: { mix: TokenMix | null; tokens: TaskTokens; touch: boolean; language: TasksLanguage; font: number; stacked?: boolean }) {
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
      {props.stacked ? (
        <>
          <ChartHead icon="Layers" label={words.tokenMix} font={props.font} tokens={tokens} />
          <Text numberOfLines={1} style={{ marginTop: 2, fontSize: props.font, fontWeight: "600", color: tokenMix ? tokens.foreground : tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>
            {tokenMix ? formatTokens(tokenMix.total) : "—"}
          </Text>
        </>
      ) : (
        <ChartHead icon="Layers" label={words.tokenMix} font={props.font} tokens={tokens}>
          <Text style={{ fontSize: props.font, fontWeight: "600", color: tokenMix ? tokens.foreground : tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>
            {tokenMix ? formatTokens(tokenMix.total) : "—"}
          </Text>
        </ChartHead>
      )}
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

/**
 * The same moments stacked, for a card too narrow to lay the track out without
 * its labels colliding: a row per point, its name and time beside the rail, and
 * each span's length under the point it starts from.
 */
export function TimelineList(props: { timeline: Timeline; liveColor: string; tokens: TaskTokens; endMark?: React.ReactNode }) {
  const { timeline: line, tokens } = props;
  const colors = detailColors(tokens);
  const lastIndex = line.points.length - 1;
  return (
    <View testID="detail-timeline" style={{ paddingHorizontal: 10, paddingTop: 4, paddingBottom: 2 }}>
      {line.points.map((point, index) => {
        const last = index === lastIndex;
        const color = last && line.live ? props.liveColor : null;
        const gap = last ? null : line.points[index + 1]!.at - point.at;
        return (
          <View key={point.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
            <View style={{ width: 16, alignSelf: "stretch", alignItems: "center" }}>
              {last && props.endMark ? (
                <View
                  testID="detail-timeline-end-mark"
                  style={{ width: END_MARK, height: END_MARK, marginTop: 3, borderRadius: END_MARK / 2, alignItems: "center", justifyContent: "center" }}
                >
                  {props.endMark}
                </View>
              ) : (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    marginTop: 5,
                    borderRadius: 4,
                    borderWidth: 1.5,
                    borderColor: color ?? tokens.foregroundMuted,
                    backgroundColor: color ?? tokens.card.background,
                  }}
                />
              )}
              {gap !== null ? <View style={{ width: 2, flex: 1, minHeight: 16, marginVertical: 3, backgroundColor: colors.pastSpan }} /> : null}
            </View>
            <View testID={`detail-timeline-${point.key}`} style={{ flexShrink: 1, minWidth: 0, paddingBottom: gap === null ? 2 : 14 }}>
              <Text numberOfLines={1} style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, fontWeight: "600", color: tokens.foreground }}>
                {point.name}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>
                {point.time}
              </Text>
            </View>
            {gap !== null ? (
              <Text style={{ marginTop: 1, fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{formatSpan(gap)}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ---- Review and done -------------------------------------------------------

/**
 * One baseline row: each number with its caption beside it, in the sunk box.
 * The row is measured, not the card: from 480 the captions name the whole fact
 * and hairlines divide the clusters; from 300 they stay short and packed;
 * below that they wrap between clusters, never inside one, so a number or a
 * price does not ellipsize. Until a width arrives the short row is used.
 */
export function SummaryTiles(props: { tiles: SummaryReadout[]; tokens: TaskTokens; touch: boolean }) {
  const { tokens } = props;
  const colors = detailColors(tokens);
  const [width, onLayout] = useWidth();
  const wide = width >= 480;
  const wrap = width > 0 && width < 300;
  return (
    <View
      testID="detail-summary"
      onLayout={onLayout}
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        flexWrap: wrap ? "wrap" : "nowrap",
        // Wrapped rows space by row only; a wrapped cluster keeps its own line.
        rowGap: wrap ? 4 : 0,
        columnGap: 0,
        justifyContent: wide ? "space-between" : "flex-start",
        borderWidth: 1,
        borderColor: tokens.border,
        borderRadius: 10,
        backgroundColor: colors.sunk,
        paddingVertical: 7,
        paddingHorizontal: 12,
      }}
    >
      {props.tiles.map((tile, index) => (
        <View
          key={tile.key}
          testID={`detail-summary-${tile.key}`}
          accessible
          accessibilityLabel={tile.tip}
          {...tipProps(tile.tip)}
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            gap: 6,
            flexShrink: 0,
            marginRight: wide || index === props.tiles.length - 1 ? 0 : 14,
          }}
        >
          <Text
            style={{
              fontSize: F.lg,
              lineHeight: HOST_LINE.lg,
              fontWeight: tile.value !== null ? "600" : "500",
              color: tile.value !== null ? tokens.foreground : tokens.foregroundMuted,
              fontVariant: ["tabular-nums"],
            }}
          >
            {tile.value ?? "—"}
          </Text>
          <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }}>
            {wide ? tile.wide : tile.short}
          </Text>
          {/* The rule belongs to the cluster it follows, so space-between divides clusters, not rules. */}
          {wide && index < props.tiles.length - 1 ? (
            <View
              testID="detail-summary-rule"
              style={{ width: 1, height: 12, marginLeft: 16, alignSelf: "center", backgroundColor: tokens.border }}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** A hairline-outlined pill: a lead (dot, icon, mark) and its text. */
export function Chip(props: { tokens: TaskTokens; lead?: React.ReactNode; text: string; tip: string; renderText?(text: string): React.ReactNode; muted?: boolean; compact?: boolean; height: number; font: number; testID?: string }) {
  // Grows with the text size like the card's other controls, so larger text stays inside the pill.
  const height = taskControlHeight(props.height, useTasksFontScale());
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      testID={props.testID}
      {...hoverProps}
      {...tipProps(props.tip)}
      style={{ height, minWidth: height, maxWidth: "100%", paddingHorizontal: props.compact ? 9 : 8, borderRadius: height / 2, borderWidth: StyleSheet.hairlineWidth, borderColor: props.tokens.card.pillBorder, backgroundColor: hovered ? mix(props.tokens.card.background, props.tokens.foreground, 0.06) : "transparent", boxShadow: Platform.OS === "web" && hovered ? props.tokens.card.buttonShadowHover : undefined, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: props.compact ? 6 : 5, ...webTransition }}
    >
      {props.lead}
      <Text numberOfLines={1} style={{ fontSize: props.font, lineHeight: Math.round(props.font * 1.25), flexShrink: 1, color: props.muted ? props.tokens.foregroundMuted : props.tokens.foreground }}>
        {props.renderText ? props.renderText(props.text) : props.text}
      </Text>
    </Pressable>
  );
}

