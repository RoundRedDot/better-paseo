import React, { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { unselectable } from "./selection";
import { radiusV2, space } from "./theme-tokens";
import { useCopy } from "../ui/use-copy";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { DISCLOSURE_HEADER } from "../ui/disclosure-header";
import { formatFooterStamp, formatFullStamp, formatDuration } from "../ui/time";
import { TYPE } from "../ui/tokens/typography";
import { ProviderLogo } from "./provider-logo";
import { CenteredToolbarDetails, ToolbarItem, TooltipSideContext } from "../ui/toolbar-button";
import { FooterDetails, useFooterDetailsWidth } from "./footer-details";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { useScrollDismiss } from "../ui/scroll-anchor";
import type { TurnUsage } from "./user-message";
import { useEnhancerPreferences } from "../preferences";
import { resolveLanguage } from "../i18n/settings-strings";
import { toolbarLabel } from "../i18n/toolbar-strings";

/**
 * The host's own reply footer — copy, fork and the turn's time — is drawn by
 * the stream layout, not by the message renderer: it walks up from the newest
 * item looking for a `assistant_message` stream item
 * (`agent-stream/layout.ts:102`). A transformed item is projected as
 * `kind: "plugin"` (`plugins/timeline/projection.ts:96`), so once this plugin
 * renders the reply the host finds no assistant and draws no footer.
 *
 * This is the part a plugin can rebuild. Fork is not: it needs the daemon
 * client and a timeline cursor (`hooks/use-fork-agent.ts`), and the plugin SDK
 * exposes neither. Turning "Assistant markdown" off in settings hands the reply
 * back to the host, which brings the full footer with it.
 */
interface AssistantFooterProps {
  /** The reply, copied verbatim — the same text the host would copy. */
  text: string;
  /** The completed turn's end time; source reply identity is resolved before rendering. */
  at: Date;
  agentName?: string | null;
  /** The raw model name from the agent, used for clipboard writes. */
  modelId?: string | null;
  modelName?: string | null;
  thinkingLabel?: string | null;
  durationMs?: number | null;
  startedAt?: number | null;
  usage?: TurnUsage | null;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`: a 44pt touch target for Copy. */
  compact?: boolean;
}

export function AssistantFooter({ text, at, agentName, modelId, modelName, thinkingLabel, durationMs, startedAt, usage, tokens, compact = false }: AssistantFooterProps) {
  // The shared copy path (plan §3.8): a check for 1.2 s on success, a toast
  // on failure, and no timer left running after unmount.
  const { copied, copy } = useCopy();
  const modelCopy = useCopy();
  const capabilities = useInputCapabilities(compact);
  const { language } = useEnhancerPreferences();
  const hintLanguage = resolveLanguage(language);
  const timeLabel = startedAt != null ? "Start time" : "End time";
  const timeStamp = formatFullStamp(startedAt != null ? new Date(startedAt) : at);
  const footerRef = useRef<View>(null);
  const [pressedAnchor, setPressedAnchor] = useState<RefObject<View | null> | null>(null);
  const showDetails = useCallback((anchor: RefObject<View | null>) => setPressedAnchor(anchor), []);
  const closeDetails = useCallback(() => setPressedAnchor(null), []);
  useScrollDismiss(pressedAnchor !== null, closeDetails);
  const longPress = capabilities.touch ? showDetails : undefined;
  const detailsWidth = useFooterDetailsWidth();
  // Grok and Cursor history replays stamp every item with the load time, so a
  // replayed turn spans a millisecond or two. Their live turns time normally.
  const visibleDurationMs = (agentName === "grok" || agentName === "cursor") && durationMs != null &&
    durationMs < REPLAY_COLLAPSE_MS ? null : durationMs;
  const { fit, measure } = useOneLineFit(compact, Boolean(modelName), visibleDurationMs != null);
  const details = <FooterDetails agentName={agentName} modelId={modelId} modelName={modelName} thinkingLabel={thinkingLabel}
    startedAt={startedAt} completedAt={at.getTime()} durationMs={visibleDurationMs} usage={usage} tokens={tokens} />;
  const copyModel = useCallback(() => {
    if (modelId) void modelCopy.copy(modelId, { label: "Copy model name" });
  }, [modelId, modelCopy.copy]);
  const handleCopy = useCallback(() => void copy(text, { label: "Copy reply" }), [copy, text]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          minHeight: FOOTER_HEIGHT,
          marginTop: space.sm,
          // Keep Copy clear of the composer in both desktop and compact layouts.
          marginBottom: space.lg,
          flexDirection: "row",
          // A phone keeps one line and drops items instead (`fitOneLine`).
          flexWrap: compact ? "nowrap" : "wrap",
          alignItems: "center",
          gap: space.sm,
        },
        copyButton: {
          width: "auto",
          // Exclude hit-area padding from the visible spacing between items.
          marginHorizontal: -space.xs,
          height: FOOTER_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          paddingHorizontal: space.xs,
          borderRadius: radiusV2.block,
        },
        copyLabel: {
          fontFamily: tokens.fontUi,
          fontSize: TYPE.button.size,
          lineHeight: TYPE.button.lineHeight,
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        metadata: {
          width: "auto",
          minHeight: FOOTER_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          borderRadius: radiusV2.block,
        },
        modelButton: {
          width: "auto",
          marginHorizontal: -space.xs,
          paddingHorizontal: space.xs,
          paddingVertical: space.xs / 2,
        },
        time: {
          fontFamily: tokens.fontUi,
          fontSize: TYPE.button.size,
          lineHeight: TYPE.button.lineHeight,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
          ...unselectable,
        },
      }),
    [tokens, compact],
  );

  return (
    <TooltipSideContext.Provider value="auto">
      <Pressable ref={footerRef} testID="footer-toolbar" accessible={false} focusable={false}
        onLongPress={longPress ? () => longPress(footerRef) : undefined} style={styles.container}
        onLayout={compact ? measure.row : undefined}>
        <ToolbarItem
          onLayout={compact ? measure.copy : undefined}
          label={copied ? "Copied" : "Copy reply"}
          tokens={tokens}
          align="start"
          accessibilityLabel={copied ? "Reply copied" : "Copy reply"}
          onPress={handleCopy}
          onLongPress={longPress}
          hitSlop={compact ? (44 - FOOTER_HEIGHT) / 2 : 0}
          buttonStyle={styles.copyButton}
        >
          <Icon
            name={copied ? "Check" : "Copy"}
            size={DISCLOSURE_HEADER.icon}
            color={copied ? tokens.success : tokens.foregroundMuted}
          />
          <Text style={styles.copyLabel}>Copy</Text>
        </ToolbarItem>
        {modelName && fit.model ? (
          <ToolbarItem
            onLayout={compact ? measure.model : undefined}
            label={modelCopy.copied ? "Copied" : "Copy model name"}
            tokens={tokens}
            align="start"
            accessibilityLabel={modelCopy.copied ? "Model name copied" : "Copy model name"}
            onPress={copyModel}
            onLongPress={longPress}
            hitSlop={compact ? (44 - FOOTER_HEIGHT) / 2 : 0}
            buttonStyle={[styles.metadata, styles.modelButton]}
            details={details}
            detailsWidth={detailsWidth}
          >
            {modelCopy.copied ? (
              <Icon name="Check" size={DISCLOSURE_HEADER.icon} color={tokens.success} />
            ) : agentName ? (
              <ProviderLogo provider={agentName} size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
            ) : (
              <Icon name="Copy" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
            )}
            <Text style={styles.time}>{modelName}</Text>
          </ToolbarItem>
        ) : null}
        {fit.clock ? (
          <ToolbarItem onLayout={compact ? measure.clock : undefined} label={`${toolbarLabel(timeLabel, language)} ${timeStamp}`} accessibilityLabel={`${timeLabel} ${timeStamp}`} tokens={tokens} align="start" buttonStyle={styles.metadata} onLongPress={longPress}>
            <Icon name="Clock" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
            <Text style={styles.time}>{formatFooterStamp(at)}</Text>
          </ToolbarItem>
        ) : null}
        {visibleDurationMs != null ? (
          <ToolbarItem onLayout={compact ? measure.duration : undefined} label={`${toolbarLabel("Elapsed time", language)}${hintLanguage === "zh" ? "：" : ":"} ${formatDuration(visibleDurationMs, hintLanguage, true)}`} accessibilityLabel={`Elapsed time: ${formatDuration(visibleDurationMs, "en")}`} tokens={tokens} align="end" buttonStyle={styles.metadata} onLongPress={longPress}>
            <Icon name="Hourglass" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
            <Text style={styles.time}>{formatDuration(visibleDurationMs, hintLanguage)}</Text>
          </ToolbarItem>
        ) : null}
      </Pressable>
      {pressedAnchor ? (
        <CenteredToolbarDetails close={closeDetails} width={detailsWidth} tokens={tokens}>
          {details}
        </CenteredToolbarDetails>
      ) : null}
    </TooltipSideContext.Provider>
  );
}

/**
 * The footer row: at least 24 tall, a 44pt Copy on touch through hitSlop. It
 * sits under the last reply, where every extra point moves the turn below, so
 * the compact layout keeps it to one line.
 */
const FOOTER_HEIGHT = 24;

/** A replayed Grok or Cursor turn spans under this; a live model turn never does. */
const REPLAY_COLLAPSE_MS = 1_000;

type FooterSlot = "copy" | "model" | "clock" | "duration";
export interface FooterFit { model: boolean; clock: boolean }

/**
 * Which items one line holds, given each item's width (absent when not drawn)
 * and the row's. The clock goes first, then the model name: both stay in the
 * long-press details. Copy and the elapsed time always stay.
 */
export function fitOneLine(widths: Partial<Record<FooterSlot, number>>, row: number, gap: number): FooterFit {
  const span = (slots: readonly FooterSlot[]) => {
    const drawn = slots.map((slot) => widths[slot]).filter((width): width is number => width !== undefined);
    return drawn.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, drawn.length - 1);
  };
  // Half a point of rounding must not drop an item that fits.
  const fits = (slots: readonly FooterSlot[]) => span(slots) <= row + 0.5;
  if (fits(["copy", "model", "clock", "duration"])) return { model: true, clock: true };
  if (fits(["copy", "model", "duration"])) return { model: true, clock: false };
  return { model: false, clock: false };
}

const FIT_ALL: FooterFit = { model: true, clock: true };

/**
 * Measures the compact row and its items. A dropped item keeps its last width,
 * so a wider row brings it back; an item not drawn at all counts for nothing.
 */
function useOneLineFit(compact: boolean, hasModel: boolean, hasDuration: boolean) {
  const [widths, setWidths] = useState<Partial<Record<FooterSlot | "row", number>>>({});
  const measure = useMemo(() => {
    const slot = (name: FooterSlot | "row") => (event: LayoutChangeEvent) => {
      const width = event.nativeEvent.layout.width;
      setWidths((previous) => previous[name] === width ? previous : { ...previous, [name]: width });
    };
    return { row: slot("row"), copy: slot("copy"), model: slot("model"), clock: slot("clock"), duration: slot("duration") };
  }, []);
  const { row, model, duration, ...rest } = widths;
  const fit = compact && row ? fitOneLine({ ...rest, ...(hasModel ? { model } : {}), ...(hasDuration ? { duration } : {}) },
    row, space.sm) : FIT_ALL;
  return { fit, measure };
}
