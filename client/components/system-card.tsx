import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { SyntaxHighlightBlock } from "./syntax-highlight";
import { selectableSurface, unselectable } from "./selection";
import { selectionSurface } from "./selection-actions";
import { DisclosureHeader, RowIcon, RowText } from "../ui/disclosure-header";
import { FadeIn } from "../ui/fade-in";
import { contentTextProps, contentTextStyle } from "../ui/content-text";
import type { SystemEnvelope, SystemEnvelopeKind } from "../system-envelope";

interface SystemCardProps {
  envelope: SystemEnvelope;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`. */
  compact?: boolean;
}

const KIND_LOOK: Record<SystemEnvelopeKind, { icon: string; label: string }> = {
  job: { icon: "CircleCheck", label: "Job" },
  message: { icon: "Bot", label: "Agent" },
  reminder: { icon: "CircleAlert", label: "Reminder" },
  process: { icon: "SquareTerminal", label: "Process" },
  notice: { icon: "Info", label: "Notice" },
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
 * reminder — drawn as a tool row rather than as the model's own words (S7
 * design spec §3.4): the kind's icon, its label, the title, the envelope's
 * figures as meta. Opened, the body sits on the same surface1 slab as a tool
 * call's. A failed job shows a danger icon and "failed" in its meta, nothing
 * more: no frame, no rule, no tinted surface.
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
        title: {
          flex: 1,
          minWidth: 0,
          fontFamily: tokens.fontUi,
          fontSize: tokens.typography.block.label.size,
          lineHeight: tokens.typography.block.label.lineHeight,
          ...unselectable,
        },
        body: {
          marginTop: 2,
          marginBottom: 6,
          borderRadius: radiusV2.block,
          overflow: "hidden",
          backgroundColor: tokens.v2.surface1,
        },
        bodyInner: {
          paddingVertical: space.sm,
          paddingHorizontal: space.md,
          ...selectableSurface,
        },
        prose: {
          fontFamily: tokens.fontUi,
          fontSize: tokens.typography.content.size - 1 + tokens.typography.block.delta,
          lineHeight: tokens.typography.block.label.lineHeight + 2,
          color: tokens.foreground,
        },
      }),
    [tokens],
  );

  const icon = (
    <RowIcon
      name={failed ? "CircleX" : look.icon}
      color={failed ? tokens.danger : envelope.kind === "job" ? tokens.success : undefined}
    />
  );
  const title = (
    <RowText part="target" selectable={false} numberOfLines={1} style={styles.title}>
      {envelope.title}
    </RowText>
  );
  const meta: React.ReactNode[] = envelope.chips.map((chip) => chip.value);
  if (failed) meta.push(<Text style={{ color: tokens.danger }}>failed</Text>);

  return (
    <>
      <DisclosureHeader
        expanded={open}
        onToggle={() => setExpanded((prev) => !prev)}
        inert={!hasBody}
        tokens={tokens}
        compact={compact}
        icon={icon}
        iconIsStatus={failed}
        verb={look.label}
        target={title}
        meta={meta}
        accessibilityLabel={`${look.label} ${envelope.title}${failed ? ", failed" : ""}`}
      />
      {open ? (
        <FadeIn style={styles.body}>
          <View {...selectionSurface} style={styles.bodyInner}>
            {kind === "prose" ? (
              <Text selectable {...contentTextProps()} style={[styles.prose, contentTextStyle()]}>
                {envelope.body}
              </Text>
            ) : (
              <SyntaxHighlightBlock
                code={envelope.body}
                language={kind === "json" ? "json" : "text"}
                tokens={tokens}
                compact
                bare
              />
            )}
          </View>
        </FadeIn>
      ) : null}
    </>
  );
}
