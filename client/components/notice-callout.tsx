import React, { useMemo, useState } from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { renderTerminalOutput } from "./syntax-highlight";
import { selectableSurface, unselectable } from "./selection";
import { selectionCodeText, selectionSurface } from "./selection-actions";
import { DISCLOSURE_HEADER } from "../ui/disclosure-header";
import { FadeIn } from "../ui/fade-in";
import { formatStamp } from "../ui/time";
import type { NoticeCalloutData } from "../../shared/contracts";

interface NoticeCalloutProps {
  data: NoticeCalloutData;
  tokens: ExtendedThemeTokens;
  /** When the notice arrived; drawn at the end of the row. */
  at?: Date;
  /** `layout.compact`: 32pt rows. */
  compact?: boolean;
}

/** One level, resolved to its mark and its rule. */
interface LevelLook {
  /** Read aloud before the message; the row itself draws no label. */
  label: string;
  icon: string;
  mark: string;
  /** Error and fatal only: the 2px rule on the row's left edge. */
  rule: string | null;
  weight: "400" | "500";
}

function levelLook(data: NoticeCalloutData, tokens: ExtendedThemeTokens): LevelLook {
  // A host `error` item is a failure whatever level it claims, so it takes the
  // danger look before the level is read.
  if (data.fatal) {
    return { label: "Fatal", icon: "OctagonX", mark: tokens.danger, rule: tokens.danger, weight: "500" };
  }
  if (data.level === "error") {
    return { label: "Error", icon: "CircleX", mark: tokens.danger, rule: tokens.danger, weight: "400" };
  }
  if (data.level === "warning") {
    return { label: "Warning", icon: "TriangleAlert", mark: tokens.warning, rule: null, weight: "400" };
  }
  return { label: "Info", icon: "Info", mark: tokens.foregroundMuted, rule: null, weight: "400" };
}

/** Past this, a message is read as data rather than a sentence. */
const INLINE_LIMIT = 120;

/**
 * Marks a notice as machine text rather than a sentence: a URI scheme (`xd://`
 * included), an MCP tool id, a path run, or a comma-separated list of dotted
 * or underscored identifiers. Opened, those go to the monospace body, where a
 * mount notice listing thirty tool ids wraps instead of running off the row.
 */
const TECHNICAL =
  /:\/\/|mcp__|[\w.-]+[\\/][\w.-]+[\\/]|[\w.$-]*[._][\w.$-]*\s*,\s*[\w.$-]*[._][\w.$-]*/;

/**
 * A host `notification` or `error` item as one row (S7 design spec §3.4):
 * the level's icon in the status slot, the message on one line, the time at
 * the end. Only an error or a fatal notice adds a 2px rule on the left, taken
 * out of the row's outdent so the slot does not move; info and warning stay
 * plain so they never out-shout the work. Pressing the row shows the whole
 * message — wrapped, or in a monospace block when it reads as data.
 *
 * Four views (five with a time): the row, the slot, the icon, the message.
 */
export function NoticeCallout({ data, tokens, at, compact = false }: NoticeCalloutProps): React.ReactElement {
  const look = levelLook(data, tokens);
  const message = data.message.trim();
  const asData = message.includes("\n") || message.length > INLINE_LIMIT || TECHNICAL.test(message);
  const [open, setOpen] = useState(false);
  const height = compact ? tokens.typography.block.rowHeight.compact : tokens.typography.block.rowHeight.desktop;
  const block = tokens.typography.block;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          minHeight: height,
          flexDirection: "row",
          alignItems: "center",
          gap: DISCLOSURE_HEADER.gap,
          paddingHorizontal: DISCLOSURE_HEADER.paddingX,
          marginHorizontal: -DISCLOSURE_HEADER.bleed,
          borderRadius: radiusV2.block,
          ...selectableSurface,
        },
        // The rule replaces two points of the outdent's padding.
        ruled: {
          borderLeftWidth: 2,
          paddingLeft: DISCLOSURE_HEADER.paddingX - 2,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
        },
        slot: {
          width: DISCLOSURE_HEADER.iconSlot,
          paddingRight: DISCLOSURE_HEADER.iconSlotPad,
          alignItems: "center",
          justifyContent: "center",
        },
        message: {
          flex: 1,
          minWidth: 0,
          fontFamily: tokens.fontUi,
          fontSize: block.label.size,
          lineHeight: block.label.lineHeight,
          color: tokens.foreground,
          paddingVertical: open ? space.xs : 0,
        },
        time: {
          fontFamily: tokens.fontMono,
          fontSize: block.meta.size,
          lineHeight: block.meta.lineHeight,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        dataBlock: {
          marginLeft: DISCLOSURE_HEADER.textColumn,
          marginBottom: space.xs,
          paddingVertical: space.sm,
          paddingHorizontal: space.md,
          borderRadius: radiusV2.block,
          backgroundColor: tokens.v2.surfaceCode,
        },
        dataText: {
          fontFamily: tokens.fontMono,
          fontSize: tokens.typography.mono.size,
          lineHeight: tokens.typography.mono.lineHeight,
          color: tokens.foregroundMuted,
        },
      }),
    [tokens, height, open],
  );

  return (
    <>
      <Pressable
        {...selectionSurface}
        accessibilityRole="button"
        accessibilityLabel={`${look.label}: ${message}`}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [
          styles.row,
          look.rule ? [styles.ruled, { borderLeftColor: look.rule }] : null,
          pressed && { backgroundColor: tokens.v2.surface2 },
        ]}
      >
        <View style={styles.slot}>
          <Icon name={look.icon} size={DISCLOSURE_HEADER.icon} color={look.mark} />
        </View>
        <Text
          selectable={open}
          numberOfLines={open && !asData ? undefined : 1}
          style={[styles.message, { fontWeight: look.weight }]}
        >
          {message}
        </Text>
        {at ? <Text style={styles.time}>{formatStamp(at)}</Text> : null}
      </Pressable>
      {asData && open ? (
        <FadeIn style={styles.dataBlock}>
          <Text selectable {...selectionCodeText} style={styles.dataText}>
            {renderTerminalOutput(message, tokens)}
          </Text>
        </FadeIn>
      ) : null}
    </>
  );
}
