import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Glyph } from "./glyph";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { SyntaxHighlightBlock } from "./syntax-highlight";
import { selectableSurface, unselectable } from "./selection";
import { selectionSurface } from "./selection-actions";
import { DISCLOSURE_HEADER, DisclosureHeader } from "../ui/disclosure-header";
import { FadeIn } from "../ui/fade-in";
import { UI_SCALE } from "../ui/tokens/typography";
import type { SystemEnvelope, SystemEnvelopeKind } from "../system-envelope";

interface SystemCardProps {
  envelope: SystemEnvelope;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`. */
  compact?: boolean;
}

const KIND_LOOK: Record<SystemEnvelopeKind, { glyph: string; label: string }> = {
  job: { glyph: "ListChecks", label: "Job" },
  message: { glyph: "Bot", label: "Agent" },
  reminder: { glyph: "AlertCircle", label: "Reminder" },
  process: { glyph: "Terminal", label: "Process" },
  notice: { glyph: "CircleDot", label: "Notice" },
};

/** Body longer than this opens closed: a job preview is pages of JSON. */
const COLLAPSE_LIMIT = 220;

/**
 * The surface follows the envelope, not a guess about the text. A job carries
 * a tool's output and earns the code surface; a relayed message or a reminder
 * is written for a reader. JSON is JSON wherever it appears.
 */
function bodyKind(envelope: SystemEnvelope): "json" | "output" | "prose" {
  const head = envelope.body.trimStart()[0];
  if (head === "{" || head === "[") return "json";
  return envelope.kind === "job" ? "output" : "prose";
}

/**
 * Harness text — a finished background job, an agent's relayed message, a
 * reminder — drawn as a row rather than as the model's own words (plan §3.6).
 *
 * Collapsed it is a bare `DisclosureHeader` row; expanded it takes the same
 * frame as a tool call. A failure is marked by a 2px danger rule on the left
 * and danger text, never by a tinted surface.
 *
 * The host files these under the same item kind as a reply, so without this
 * the raw `<system-notice>` markup reads as something the model typed.
 */
export function SystemCard({ envelope, tokens, compact = false }: SystemCardProps): React.ReactElement {
  const look = KIND_LOOK[envelope.kind];
  const [expanded, setExpanded] = useState(envelope.body.length <= COLLAPSE_LIMIT);
  const kind = bodyKind(envelope);
  const failed = envelope.failed;
  const hasBody = envelope.body.length > 0;
  const open = hasBody && expanded;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        ruled: {
          borderLeftWidth: 2,
          borderLeftColor: tokens.danger,
          paddingLeft: space.xs,
        },
        // A transparent border while collapsed keeps the header from moving
        // by a pixel when the frame appears.
        frame: {
          borderWidth: 1,
          borderColor: "transparent",
          borderRadius: radiusV2.card,
          overflow: "hidden",
          ...selectableSurface,
        },
        frameOpen: {
          borderColor: tokens.v2.border,
          backgroundColor: tokens.v2.surface0,
        },
        title: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.md,
          color: failed ? tokens.danger : tokens.foreground,
          ...unselectable,
        },
        staticRow: {
          height: DISCLOSURE_HEADER.height.desktop,
          flexDirection: "row",
          alignItems: "center",
          gap: DISCLOSURE_HEADER.gap,
          paddingHorizontal: DISCLOSURE_HEADER.paddingX,
        },
        staticVerb: {
          fontFamily: tokens.fontUi,
          fontSize: DISCLOSURE_HEADER.verb,
          fontWeight: "500",
          color: failed ? tokens.danger : tokens.foreground,
          ...unselectable,
        },
        iconSlot: {
          width: DISCLOSURE_HEADER.iconSlot,
          alignItems: "center",
        },
        body: {
          padding: space.sm,
          borderTopWidth: 1,
          borderTopColor: tokens.v2.borderSubtle,
        },
        prose: {
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.md,
          lineHeight: 20,
          color: tokens.foreground,
        },
      }),
    [tokens, failed],
  );

  const icon = (
    <Glyph
      name={look.glyph}
      size={DISCLOSURE_HEADER.icon}
      color={failed ? tokens.danger : tokens.foregroundMuted}
    />
  );
  const title = (
    <Text selectable={false} numberOfLines={1} style={styles.title}>
      {envelope.title}
    </Text>
  );
  const meta = envelope.chips.map((chip) => chip.value);

  const card = (
    <View {...selectionSurface} style={[styles.frame, open && styles.frameOpen]}>
      {hasBody ? (
        <DisclosureHeader
          expanded={expanded}
          onToggle={() => setExpanded((prev) => !prev)}
          tokens={tokens}
          compact={compact}
          icon={icon}
          verb={look.label}
          target={title}
          meta={meta}
          tone={failed ? "danger" : "default"}
          accessibilityLabel={`${look.label} ${envelope.title}`}
        />
      ) : (
        <View style={styles.staticRow}>
          <View style={styles.iconSlot}>{icon}</View>
          <Text selectable={false} style={styles.staticVerb}>
            {look.label}
          </Text>
          <View style={{ flex: 1, minWidth: 0 }}>{title}</View>
        </View>
      )}
      {open ? (
        <FadeIn style={styles.body}>
          {kind === "prose" ? (
            <Text selectable style={styles.prose}>
              {envelope.body}
            </Text>
          ) : (
            <SyntaxHighlightBlock
              code={envelope.body}
              language={kind === "json" ? "json" : "text"}
              tokens={tokens}
              compact
            />
          )}
        </FadeIn>
      ) : null}
    </View>
  );
  // The rule sits outside the frame, so it stays a straight 2px line rather
  // than following the frame's rounded corner.
  return failed ? <View style={styles.ruled}>{card}</View> : card;
}
