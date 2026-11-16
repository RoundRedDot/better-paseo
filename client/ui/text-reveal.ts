/**
 * Paced reveal for streaming text.
 *
 * Ported from Paseo (packages/app/src/agent-stream/text-reveal.ts, getpaseo/paseo
 * 5d70ab2ab), Copyright (c) 2025-present Mohamed Boudra, licensed under the
 * Apache License, Version 2.0. Paseo 0.16 deprecates the `client/react-native`
 * entry that handed plugins the host's `useRevealedText`, and removes it after
 * 2027-04-20; the plugin keeps the same pacing by carrying it itself. Changed
 * from the original: the segmenter probe also survives a runtime without `Intl`.
 *
 * Deltas arrive lumpy: the daemon coalesces one message per 60ms window. Arrival
 * changes the target, and the reveal rate is derived from the backlog, so a burst
 * makes the text catch up faster instead of jumping. Everything here is pure; the
 * hook in `use-revealed-text` only adds a frame clock.
 */

/** Backlog is drained over this horizon. */
export const TEXT_REVEAL_HORIZON_MS = 150;

/** Reveal at most once per 60Hz frame, even on high-refresh displays. */
export const TEXT_REVEAL_FRAME_INTERVAL_MS = 1000 / 60;

// A long stall (backgrounded tab, blocked thread) must not produce one wild step.
const MAX_ELAPSED_MS = 250;

/**
 * Characters to reveal on this frame: proportional to the backlog, with a
 * one-character floor so the tail always finishes.
 */
export function computeRevealStep(input: { backlog: number; elapsedMs: number; horizonMs?: number }): number {
  const { backlog } = input;
  if (backlog <= 0) return 0;
  const horizonMs = input.horizonMs ?? TEXT_REVEAL_HORIZON_MS;
  if (horizonMs <= 0) return backlog;
  const elapsedMs = Math.min(Math.max(input.elapsedMs, 0), MAX_ELAPSED_MS);
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= horizonMs) return backlog;
  const step = Math.ceil((backlog * elapsedMs) / horizonMs);
  return Math.min(backlog, Math.max(1, step));
}

const ZERO_WIDTH_JOINER = 0x200d;

interface GraphemeSegmenter {
  segment(text: string): { containing(index: number): { index: number } | undefined };
}

function createSegmenter(): GraphemeSegmenter | null {
  // `typeof Intl` first: an engine without `Intl` throws on `Intl.Segmenter`.
  if (typeof Intl === "undefined") return null;
  const Segmenter = (Intl as { Segmenter?: new (locale: undefined, options: { granularity: "grapheme" }) => GraphemeSegmenter }).Segmenter;
  return typeof Segmenter === "function" ? new Segmenter(undefined, { granularity: "grapheme" }) : null;
}

const graphemeSegmenter = createSegmenter();

/**
 * Pacing needs a grapheme segmenter. Without one each arrival is painted whole
 * instead of risking a transient broken glyph.
 */
export function isTextRevealPacingSupported(): boolean {
  return graphemeSegmenter !== null;
}

/**
 * Pull a cut index back to a grapheme boundary. Only the rendered boundary
 * moves; the reveal counter stays monotonic, so a long cluster never stalls it.
 */
export function clampToSafeRevealBoundary(text: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  const segment = graphemeSegmenter?.segment(text).containing(index);
  return segment?.index ?? 0;
}

export interface TextRevealFrame {
  elapsedMs: number;
  frameAtMs: number;
}

/**
 * Keep reveal commits at 60Hz, carrying the timing remainder forward so a
 * high-refresh display does not render the reveal at hardware frame rate.
 */
export function nextTextRevealFrame(previousFrameAtMs: number | null, timestampMs: number): TextRevealFrame | null {
  const elapsedMs = previousFrameAtMs === null ? TEXT_REVEAL_FRAME_INTERVAL_MS : timestampMs - previousFrameAtMs;
  if (elapsedMs < TEXT_REVEAL_FRAME_INTERVAL_MS) return null;
  return { elapsedMs, frameAtMs: timestampMs - (elapsedMs % TEXT_REVEAL_FRAME_INTERVAL_MS) };
}

export interface TextRevealState {
  /** The full text as the store knows it. */
  readonly target: string;
  /** How much of it has been released. Monotonic within a message. */
  readonly revealed: number;
}

/**
 * First sight of a text is revealed whole; only growth is paced. History,
 * replay, a remounted row and a finished message all paint complete at once.
 */
export function beginTextReveal(text: string): TextRevealState {
  return { target: text, revealed: text.length };
}

/** Point the reveal at newly arrived text without changing how much is shown. */
export function retargetTextReveal(state: TextRevealState, text: string): TextRevealState {
  if (state.target === text) return state;
  // A shorter string means the slot shows a different message.
  return { target: text, revealed: Math.min(state.revealed, text.length) };
}

/** Release one frame's worth of characters. */
export function advanceTextReveal(state: TextRevealState, elapsedMs: number, horizonMs?: number): TextRevealState {
  const step = computeRevealStep({
    backlog: state.target.length - state.revealed,
    elapsedMs,
    ...(horizonMs !== undefined ? { horizonMs } : {}),
  });
  if (step <= 0) return state;
  return { target: state.target, revealed: Math.min(state.target.length, state.revealed + step) };
}

/** Release everything, for when the turn ends and nothing may be held back. */
export function completeTextReveal(state: TextRevealState): TextRevealState {
  if (state.revealed >= state.target.length) return state;
  return { target: state.target, revealed: state.target.length };
}

export function isTextRevealSettled(state: TextRevealState): boolean {
  return state.revealed >= state.target.length;
}

/** Number of regional indicators at the end of `text`. A flag is a pair. */
function countTrailingRegionalIndicators(text: string): number {
  let count = 0;
  let cursor = text.length;
  while (cursor >= 2) {
    const codePoint = text.codePointAt(cursor - 2);
    if (codePoint === undefined || codePoint < 0x1f1e6 || codePoint > 0x1f1ff) break;
    count += 1;
    cursor -= 2;
  }
  return count;
}

/**
 * Hold back a trailing fragment that certainly waits on more input: a dangling
 * high surrogate, a trailing joiner, or an odd regional indicator.
 */
function trimIncompleteTrailingCluster(text: string): string {
  if (text.length === 0) return text;
  const lastUnit = text.charCodeAt(text.length - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) return text.slice(0, -1);
  if (lastUnit === ZERO_WIDTH_JOINER) return text.slice(0, -1);
  if (countTrailingRegionalIndicators(text) % 2 === 1) return text.slice(0, -2);
  return text;
}

/**
 * What to paint this frame. While `streaming`, a trailing fragment waits for
 * the rest of its cluster; once the turn ends everything received is painted.
 */
export function visibleRevealedText(state: TextRevealState, options?: { streaming?: boolean }): string {
  if (state.revealed >= state.target.length) {
    return options?.streaming ? trimIncompleteTrailingCluster(state.target) : state.target;
  }
  return state.target.slice(0, clampToSafeRevealBoundary(state.target, state.revealed));
}
