import React, { memo, useCallback, useLayoutEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { selectableSurface, unselectable } from "./selection";
import { selectionSurface } from "./selection-actions";
import { surfaceProps } from "./view-props";
import { MarkdownView } from "./markdown/markdown-view";
import { variantMetrics } from "./markdown/render/styles";
import type { ReasoningTraceData } from "../../shared/contracts";
import { DISCLOSURE_HEADER, DisclosureHeader, RowIcon, RowText } from "../ui/disclosure-header";
import { STICKY_SUPPORTED, StickyCard } from "../ui/sticky-header";
import { useScrollAnchor } from "../ui/scroll-anchor";
import { RunningDot } from "../ui/running-dot";
import { CopyButton } from "../ui/copy-button";
import { useCopy } from "../ui/use-copy";
import { useHover } from "../ui/use-hover";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { HoverPreviewBody, HoverPreviewHeader } from "../ui/hover-preview";
import { ToolbarCopyButton } from "../ui/toolbar-button";
import { getDisclosure, setDisclosure, useDisclosure } from "../state/disclosure-store";
import { copyPlan } from "../copy/content";
import { FadeIn } from "../ui/fade-in";
import {
  reasoningText,
  segmentReasoning,
  type ReasoningSection,
  type ReasoningSegmentation,
} from "../reasoning/segment";
import { plainInline, reasoningHeaderText } from "../reasoning/preview";
import { fitsRow } from "../tools/detail";
import { CLAMPED_LINES, splitBodyRuns, type BodyRun } from "../reasoning/paragraphs";
import { TYPE, blockProseBase } from "../ui/tokens/typography";

/** Four lines of a thought's body: quiet compact Markdown at the block's size. */
function clampHeight(tokens: ExtendedThemeTokens): number {
  return variantMetrics("compact", blockProseBase(tokens.typography), false, true).bodyLineHeight * CLAMPED_LINES;
}

function copyTextOf(text: string): string {
  return copyPlan({ kind: "reasoning", text }).primary?.text ?? "";
}

/** "Show more" is 28 tall; this brings it to a 44pt target on touch. */
const MORE_SLOP = 8;

// --- Body ------------------------------------------------------------------

interface LongParagraphProps {
  text: string;
  tokens: ExtendedThemeTokens;
  storeKey: string;
  /** Growing under the reader's eyes when it mounted. */
  live: boolean;
}

/**
 * A plain paragraph over ~600 characters: four lines and "Show more". A
 * paragraph that mounted while it was still streaming starts open and stays
 * open, so text the reader watched arrive never snaps shut under them. The
 * choice lives in the disclosure store, so remounting into history keeps it.
 */
function LongParagraph({ text, tokens, storeKey, live }: LongParagraphProps) {
  const [liveAtMount] = useState(live);
  const [open, setOpen] = useDisclosure(storeKey, liveAtMount);
  useLayoutEffect(() => {
    if (liveAtMount && getDisclosure(storeKey) === undefined) setDisclosure(storeKey, true);
  }, [liveAtMount, storeKey]);
  return (
    <View>
      <View style={open ? null : { maxHeight: clampHeight(tokens), overflow: "hidden" }}>
        <MarkdownView text={text} tokens={tokens} variant="compact" collapseCode quiet size={blockProseBase(tokens.typography)} />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(!open)}
        hitSlop={MORE_SLOP}
        style={styles.moreButton}
      >
        <Text
          selectable={false}
          style={[
            styles.moreText,
            unselectable,
            {
              color: tokens.foregroundMuted,
              fontFamily: tokens.fontUi,
              fontSize: tokens.typography.block.button.size,
              lineHeight: tokens.typography.block.button.lineHeight,
            },
          ]}
        >
          {open ? "Show less" : "Show more"}
        </Text>
      </Pressable>
    </View>
  );
}

interface BodyRunViewProps {
  run: BodyRun;
  tokens: ExtendedThemeTokens;
  storeKey: string;
  live: boolean;
}

const BodyRunView = memo(
  function BodyRunView({ run, tokens, storeKey, live }: BodyRunViewProps) {
    // Fenced code starts folded as `ts · 24 lines ›` (plan §3.4 item 4).
    if (!run.long) return <MarkdownView text={run.text} tokens={tokens} variant="compact" collapseCode quiet size={blockProseBase(tokens.typography)} />;
    return <LongParagraph text={run.text} tokens={tokens} storeKey={storeKey} live={live} />;
  },
  (a, b) =>
    a.run.text === b.run.text &&
    a.run.long === b.run.long &&
    a.tokens === b.tokens &&
    a.storeKey === b.storeKey &&
    a.live === b.live,
);

function SectionBody({
  body,
  tokens,
  storeKey,
  live,
}: {
  body: string;
  tokens: ExtendedThemeTokens;
  storeKey: string;
  live: boolean;
}) {
  const runs = useMemo(() => splitBodyRuns(body), [body]);
  return (
    <View style={styles.sectionBody}>
      {runs.map((run, index) => (
        <BodyRunView
          // Offsets are stable while the body grows; earlier runs keep their key.
          key={run.offset}
          run={run}
          tokens={tokens}
          storeKey={`${storeKey}:${run.offset}`}
          // Only the newest run of a streaming section is still growing.
          live={live && index === runs.length - 1}
        />
      ))}
    </View>
  );
}

// --- Sections --------------------------------------------------------------

interface SectionViewProps {
  section: ReasoningSection;
  tokens: ExtendedThemeTokens;
  compact: boolean;
  storeKey: string;
  live: boolean;
}

/**
 * One step: a 14/500 title with no number over its Markdown body, in the
 * row's text column with no rule or box (S7 §3.2). The title row carries a copy button for the
 * section's own text — revealed on hover where the pointer can hover, and
 * always shown (muted) on touch, where the body only exists once expanded.
 */
function SectionViewBody({ section, tokens, compact, storeKey, live }: SectionViewProps) {
  const capabilities = useInputCapabilities(compact);
  const { hovered, hoverProps } = useHover();
  const copySource = useCallback(
    () => copyTextOf(section.title ? `${section.title}\n\n${section.body}` : section.body),
    [section],
  );
  if (section.title === null) {
    return <SectionBody body={section.body} tokens={tokens} storeKey={storeKey} live={live} />;
  }
  const showCopy = !capabilities.hover || hovered;
  return (
    <View style={styles.section}>
      <Pressable accessible={false} focusable={false} {...hoverProps} style={styles.sectionTitleRow}>
        <Text
          selectable
          style={[
            styles.sectionTitle,
            {
              color: tokens.foreground,
              fontFamily: tokens.fontUi,
              fontSize: tokens.typography.block.label.size,
              lineHeight: tokens.typography.block.label.lineHeight,
            },
          ]}
        >
          {section.title}
        </Text>
        {/* Always laid out, only hidden, so revealing it moves nothing. */}
        <View style={showCopy ? null : styles.hidden} pointerEvents={showCopy ? "auto" : "none"}>
          <CopyButton text={copySource} tokens={tokens} label="Copy section" />
        </View>
      </Pressable>
      {section.body ? (
        <SectionBody body={section.body} tokens={tokens} storeKey={storeKey} live={live} />
      ) : null}
    </View>
  );
}

// A finished section's text never changes again, so it never re-renders
// while later sections stream in (plan §3.4 item 5).
const SectionView = memo(
  SectionViewBody,
  (a, b) =>
    a.section.title === b.section.title &&
    a.section.body === b.section.body &&
    a.tokens === b.tokens &&
    a.compact === b.compact &&
    a.storeKey === b.storeKey &&
    a.live === b.live,
);

interface ReasoningSectionsViewProps {
  segmentation: ReasoningSegmentation;
  tokens: ExtendedThemeTokens;
  /** Prefix for the long-paragraph disclosure keys. */
  storeKey: string;
  streaming?: boolean;
  compact?: boolean;
}

/** The expanded body for a segmentation: sections, or one prose body. */
export function ReasoningSectionsView({
  segmentation,
  tokens,
  storeKey,
  streaming = false,
  compact = false,
}: ReasoningSectionsViewProps) {
  if (segmentation.kind === "prose") {
    return (
      <SectionBody body={segmentation.body} tokens={tokens} storeKey={`${storeKey}:p`} live={streaming} />
    );
  }
  const last = segmentation.sections.length - 1;
  return (
    <View style={styles.sections}>
      {segmentation.sections.map((section, index) => (
        <SectionView
          // Sections only append; a position names the same step throughout.
          key={index}
          section={section}
          tokens={tokens}
          compact={compact}
          storeKey={`${storeKey}:s${index}`}
          live={streaming && index === last}
        />
      ))}
    </View>
  );
}

interface ReasoningSectionsProps {
  /** Raw reasoning text; segmented here. */
  text: string;
  tokens: ExtendedThemeTokens;
  /** Stable id for the block, e.g. `${agentId}:${callId}`; keys the long-paragraph toggles. */
  storeKey?: string;
  streaming?: boolean;
  compact?: boolean;
}

/**
 * The reasoning body on its own, for any card that holds a thought — the
 * `thinking` tool's expanded body among them — so there is one reasoning
 * style. Unframed: the host card supplies the border.
 */
export function ReasoningSections({
  text,
  tokens,
  storeKey = "reasoning",
  streaming = false,
  compact = false,
}: ReasoningSectionsProps) {
  const segmentation = useMemo(() => segmentReasoning(text, { streaming }), [text, streaming]);
  return (
    <View {...surfaceProps(selectionSurface)} style={selectableSurface}>
      <ReasoningSectionsView
        segmentation={segmentation}
        tokens={tokens}
        storeKey={storeKey}
        streaming={streaming}
        compact={compact}
      />
    </View>
  );
}

// --- Card ------------------------------------------------------------------

export interface ReasoningCardProps {
  segmentation: ReasoningSegmentation;
  /** Whether the model is still thinking. */
  streaming: boolean;
  /** Observed duration; null when this client did not watch the stream. */
  durationMs: number | null;
  expanded: boolean;
  onToggle(): void;
  tokens: ExtendedThemeTokens;
  compact?: boolean;
  /** Disclosure key of the card; prefixes the keys of its inner toggles. */
  storeKey: string;
  /** What "copy" puts on the clipboard: the whole thought. */
  copyText: string;
}

/**
 * A thought as one line that opens into its sections (plan §3.4, §3.6).
 * Collapsed it is a bare `DisclosureHeader` row — no border, no fill — whose
 * preview follows the stream (a pulsing dot in the title bar, the newest
 * text in the body); expanded it gains a 1px frame on `surface0`
 * with a divider under the header. The body is not mounted while collapsed.
 *
 * The only motion is the `RunningDot`, mounted while thinking, and the body's
 * fade-in on expansion.
 */
export function ReasoningCard({
  segmentation,
  streaming,
  durationMs,
  expanded: expandedProp,
  onToggle,
  tokens,
  compact = false,
  storeKey,
  copyText,
}: ReasoningCardProps) {
  const label = reasoningHeaderText(segmentation, streaming, durationMs);
  // A finished one-sentence thought is all on the row already: nothing to open.
  const budget = compact ? DISCLOSURE_HEADER.targetBudget.compact : DISCLOSURE_HEADER.targetBudget.desktop;
  const inert =
    !streaming &&
    segmentation.kind === "prose" &&
    plainInline(segmentation.body) === label.preview &&
    fitsRow(label.preview, budget);
  const expanded = expandedProp && !inert;
  // Owned here, not by the row: an opened card moves the row into `StickyCard`.
  const scrollAnchor = useScrollAnchor(expanded);
  const { copy } = useCopy();
  const copySource = useCallback(() => copyTextOf(copyText), [copyText]);
  const onLongPress = useCallback(() => {
    const value = copySource();
    if (value) void copy(value, { feedback: "toast", label: "Copy thought" });
  }, [copy, copySource]);

  // The row alone while collapsed; the opened body is its sibling, so the row
  // keeps its place in the tree (and its hover) across the toggle.
  const header = (
    <DisclosureHeader
      expanded={expanded}
      onToggle={onToggle}
      scrollAnchor={scrollAnchor}
      previewKey={`${storeKey}:preview`}
      tokens={tokens}
      compact={compact}
      inert={inert}
      icon={
        streaming ? (
          <RunningDot color={tokens.accent} accessibilityLabel="Thinking" />
        ) : (
          <RowIcon name="Lightbulb" />
        )
      }
      iconIsStatus={streaming}
      tone={streaming ? "active" : "quiet"}
      verb={label.verb}
      target={
        label.preview ? (
          <RowText
            part="target"
            selectable={false}
            numberOfLines={1}
            style={[
              styles.preview,
              unselectable,
              {
                fontFamily: tokens.fontUi,
                fontSize: tokens.typography.block.label.size,
                lineHeight: tokens.typography.block.label.lineHeight,
              },
            ]}
          >
            {label.preview}
          </RowText>
        ) : undefined
      }
      meta={label.meta}
      actions={<ToolbarCopyButton text={copySource} tokens={tokens} label="Copy thought" />}
      onLongPress={onLongPress}
      accessibilityLabel={label.preview ? `${label.verb}: ${label.preview}` : label.verb}
      previewContent={() => (
        <>
          <HoverPreviewHeader tokens={tokens} streaming={streaming}>
            <View style={styles.previewActions}>
              <ToolbarCopyButton text={copySource} tokens={tokens} label="Copy thought" />
            </View>
          </HoverPreviewHeader>
          <HoverPreviewBody streaming={streaming}>
            <MarkdownView text={reasoningText(segmentation)} tokens={tokens} variant="compact" quiet streaming={streaming} size={blockProseBase(tokens.typography)} />
          </HoverPreviewBody>
        </>
      )}
    />
  );
  const body = expanded ? (
    <FadeIn>
      <View {...surfaceProps(selectionSurface)} style={[styles.body, selectableSurface]}>
        <ReasoningSectionsView
          segmentation={segmentation}
          tokens={tokens}
          storeKey={storeKey}
          streaming={streaming}
          compact={compact}
        />
      </View>
    </FadeIn>
  ) : null;

  // A long opened thought pins its row on a host with the sticky API (S6).
  if (expanded && STICKY_SUPPORTED) {
    return (
      <StickyCard tokens={tokens} compact={compact} header={header}>
        {body}
      </StickyCard>
    );
  }
  return (
    <>
      {header}
      {body}
    </>
  );
}

// --- Static data -----------------------------------------------------------

interface ReasoningTraceProps {
  data: ReasoningTraceData;
  tokens: ExtendedThemeTokens;
  defaultExpanded?: boolean;
  compact?: boolean;
}

/** `ReasoningTraceData` steps as a segmentation: titled steps are sections. */
export function segmentationFromTrace(data: ReasoningTraceData): ReasoningSegmentation {
  const sections = data.steps.map((step): ReasoningSection => {
    const code = step.codeSnippet
      ? `\n\n\`\`\`${step.codeSnippet.language}\n${step.codeSnippet.code}\n\`\`\``
      : "";
    return { title: step.title?.trim() || null, body: `${step.content}${code}`.trim() };
  });
  const steps = sections.filter((section) => section.title !== null).length;
  if (steps === 0) {
    return { kind: "prose", body: sections.map((section) => section.body).join("\n\n") };
  }
  return { kind: "sections", sections, steps };
}

/**
 * A `ReasoningTraceData` (the showcase and any static source) drawn as the
 * same card. Token counts, models and step numbers in the data are not
 * shown; a recorded `durationMs` is, since it is part of the data rather
 * than an estimate.
 */
export function ReasoningTrace({
  data,
  tokens,
  defaultExpanded = false,
  compact = false,
}: ReasoningTraceProps) {
  const storeKey = `trace:${data.id}`;
  const [expanded, setExpanded] = useDisclosure(storeKey, defaultExpanded);
  const segmentation = useMemo(() => segmentationFromTrace(data), [data]);
  const copyText = useMemo(() => reasoningText(segmentation), [segmentation]);
  return (
    <ReasoningCard
      segmentation={segmentation}
      streaming={data.status === "thinking"}
      durationMs={data.durationMs > 0 ? data.durationMs : null}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      tokens={tokens}
      compact={compact}
      storeKey={storeKey}
      copyText={copyText}
    />
  );
}

const styles = StyleSheet.create({
  previewActions: { flexDirection: "row", justifyContent: "flex-end" },
  // The live preview takes the row's free width and ends in an ellipsis.
  preview: {
    flex: 1,
    minWidth: 0,
    fontSize: TYPE.label.size,
    lineHeight: TYPE.label.lineHeight,
  },
  // The thought, in the row's text column: no box, no rule (S7 3.2).
  body: {
    paddingLeft: DISCLOSURE_HEADER.textColumn,
    paddingTop: space.xs,
    paddingBottom: space.sm,
  },
  sections: {
    gap: space.md,
  },
  section: {
    gap: space.xs,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  sectionTitle: {
    flex: 1,
    fontSize: TYPE.label.size,
    lineHeight: TYPE.label.lineHeight,
    fontWeight: "500",
  },
  sectionBody: {
    gap: space.sm,
  },
  hidden: {
    opacity: 0,
  },
  moreButton: {
    alignSelf: "flex-start",
    height: 28,
    justifyContent: "center",
  },
  moreText: {
    fontSize: TYPE.button.size,
    lineHeight: TYPE.button.lineHeight,
    fontWeight: "500",
  },
});
