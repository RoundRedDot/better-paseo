import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Glyph } from "./glyph";
import { radiusV2, space } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { renderTerminalOutput } from "./syntax-highlight";
import { selectableSurface, unselectable } from "./selection";
import { selectionCodeText, selectionSurface } from "./selection-actions";
import { DISCLOSURE_HEADER } from "../ui/disclosure-header";
import { UI_SCALE } from "../ui/tokens/typography";
import type { NoticeCalloutData } from "../../shared/contracts";

interface NoticeCalloutProps {
  data: NoticeCalloutData;
  tokens: ExtendedThemeTokens;
}

/** One level, resolved to its mark and colours. */
interface LevelLook {
  label: string;
  glyph: string;
  /** The icon's colour. */
  mark: string;
  /** The label's and message's colour. */
  text: string;
  /** Errors only: the 2px rule on the row's left edge. */
  rule: string | null;
}

function levelLook(data: NoticeCalloutData, tokens: ExtendedThemeTokens): LevelLook {
  // A host `error` item is a failure whatever level it claims, so it takes the
  // danger look before the level is read.
  if (data.fatal || data.level === "error") {
    return {
      label: "Error",
      glyph: "AlertCircle",
      mark: tokens.danger,
      text: tokens.danger,
      rule: tokens.danger,
    };
  }
  if (data.level === "warning") {
    return {
      label: "Warning",
      glyph: "AlertTriangle",
      mark: tokens.warning,
      text: tokens.foreground,
      rule: null,
    };
  }
  return {
    label: "Info",
    glyph: "CircleDot",
    mark: tokens.foregroundMuted,
    text: tokens.foreground,
    rule: null,
  };
}

/** Past this, a message stops fitting on the row and moves to its own block. */
const INLINE_LIMIT = 120;

/**
 * Marks a notice as machine text rather than a sentence: a URI scheme (`xd://`
 * included), an MCP tool id, a path run, or a comma-separated list of dotted
 * or underscored identifiers. Those read as data, so they go to the monospace
 * body where a mount notice listing thirty tool ids wraps instead of running
 * off the row.
 */
const TECHNICAL =
  /:\/\/|mcp__|[\w.-]+[\\/][\w.-]+[\\/]|[\w.$-]*[._][\w.$-]*\s*,\s*[\w.$-]*[._][\w.$-]*/;

/**
 * A host `notification` or `error` item, drawn as a row (plan §3.6): a status
 * icon, the level, and the message, with no frame and no fill. An error adds
 * a 2px danger rule on the left and colours its text; nothing else is tinted.
 * There is no disclosure control: the item carries one message and nothing
 * else, so hiding it behind a chevron only adds a click.
 */
export function NoticeCallout({ data, tokens }: NoticeCalloutProps): React.ReactElement {
  const look = levelLook(data, tokens);
  const message = data.message.trim();
  const asData = message.includes("\n") || message.length > INLINE_LIMIT || TECHNICAL.test(message);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          gap: space.xs,
          paddingVertical: space.xs,
          ...selectableSurface,
        },
        ruled: {
          borderLeftWidth: 2,
          paddingLeft: space.xs,
        },
        row: {
          flexDirection: "row",
          // Top alignment, because a wrapped message grows downwards and a
          // centred icon would drift to the middle of it.
          alignItems: "flex-start",
          gap: DISCLOSURE_HEADER.gap,
          paddingHorizontal: DISCLOSURE_HEADER.paddingX,
        },
        iconSlot: {
          width: DISCLOSURE_HEADER.iconSlot,
          height: 20,
          alignItems: "center",
          justifyContent: "center",
        },
        label: {
          fontFamily: tokens.fontUi,
          fontSize: DISCLOSURE_HEADER.verb,
          lineHeight: 20,
          fontWeight: "500",
          ...unselectable,
        },
        // `flex: 1` with `minWidth: 0` is what makes the message wrap beside
        // the label. A flex child floors at its content width by default, so
        // without the override a long line widens the row instead of folding.
        message: {
          flex: 1,
          minWidth: 0,
          fontFamily: tokens.fontUi,
          fontSize: UI_SCALE.md,
          lineHeight: 20,
        },
        dataBlock: {
          marginLeft: DISCLOSURE_HEADER.paddingX + DISCLOSURE_HEADER.iconSlot + DISCLOSURE_HEADER.gap,
          marginRight: DISCLOSURE_HEADER.paddingX,
          padding: space.sm,
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
    [tokens],
  );

  return (
    <View
      {...selectionSurface}
      style={[styles.container, look.rule ? [styles.ruled, { borderLeftColor: look.rule }] : null]}
    >
      <View style={styles.row}>
        <View style={styles.iconSlot}>
          <Glyph name={look.glyph} size={DISCLOSURE_HEADER.icon} color={look.mark} />
        </View>
        <Text selectable={false} style={[styles.label, { color: look.text }]}>
          {look.label}
        </Text>
        {asData ? null : (
          <Text selectable style={[styles.message, { color: look.text }]}>
            {message}
          </Text>
        )}
      </View>

      {asData ? (
        <View style={styles.dataBlock}>
          <Text selectable {...selectionCodeText} style={styles.dataText}>
            {renderTerminalOutput(message, tokens)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
