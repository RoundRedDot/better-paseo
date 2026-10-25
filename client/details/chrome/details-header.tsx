/**
 * The details panel's header (docs/prototypes/block-details-sheet.md, "头部";
 * table 5.2): the block's icon in a 28 tile, its full title and a subtitle of
 * status, duration and place, then ‹ › × at the right. 52 tall on touch, 44
 * with a pointer. The shell's header handlers ride on it: a vertical drag
 * moves the drawer, a horizontal swipe steps.
 */
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import { space } from "../../components/theme-tokens";
import { unselectable } from "../../components/selection";
import { Glyph } from "../../components/glyph";
import { renderMarkIcon } from "../../components/mark-icon";
import { RunningDot } from "../../ui/running-dot";
import { SpokenLabelsContext, ToolbarButton, ToolbarMetricsContext, TooltipAlignContext, type ToolbarMetrics } from "../../ui/toolbar-button";
import type { BlockEntry, DetailsShellValue } from "../contracts";
import { useEnhancerPreferences } from "../../preferences";
import { toolbarLabel } from "../../i18n/toolbar-strings";

/** Header height and its buttons: touch, then pointer. */
export const DETAILS_HEADER = { touch: 52, pointer: 44 } as const;
export const HEADER_BUTTONS: Readonly<Record<"touch" | "pointer", ToolbarMetrics>> = {
  touch: { button: 36, icon: 18 },
  pointer: { button: 28, icon: 16 },
};
const ICON_TILE = 28;
const TILE_ICON = 16;
const TITLE_LINES = 4;

export function DetailsHeader({ shell, tokens, icon, titleText, title, meta, streaming = false }: {
  shell: DetailsShellValue;
  tokens: ExtendedThemeTokens;
  /** The content's own icon, drawn when the block names none. */
  icon?: ReactNode;
  /** The content's name for itself, used when the block has no title. */
  titleText?: string;
  /** A title the content draws itself, used when there is no text for one. */
  title?: ReactNode;
  /** Facts appended to the subtitle, such as a picture's size. */
  meta?: ReactNode;
  streaming?: boolean;
}) {
  const { entry, pointer } = shell;
  const { language } = useEnhancerPreferences();
  const metrics = HEADER_BUTTONS[pointer ? "pointer" : "touch"];
  // A tap shows up to four lines; another block starts on one again.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = expandedId === entry.id;
  const text = entry.title || titleText || "";
  const navigable = shell.index > 0 && shell.count > 0;
  const subtitle = subtitleParts(entry, navigable ? `${shell.index} / ${shell.count}` : null);
  const titleStyle = [
    styles.title,
    unselectable,
    entry.titleMono
      ? { fontFamily: tokens.fontMono, fontSize: 13, lineHeight: 18 }
      : { fontFamily: tokens.fontUi, fontSize: 14, lineHeight: 20 },
    { color: tokens.foreground },
  ];
  return (
    <View
      testID="details-header"
      {...(shell.headerHandlers ?? {})}
      style={[styles.header, { minHeight: DETAILS_HEADER[pointer ? "pointer" : "touch"] }]}
    >
      <View testID="details-header-icon" style={[styles.tile, { backgroundColor: tokens.v2.surface1 }]}>
        {entry.icon ? <TileIcon name={entry.icon} color={entry.iconColor ?? tokens.foregroundMuted} />
          : typeof icon === "string" ? <TileIcon name={icon} color={tokens.foregroundMuted} /> : icon}
      </View>
      <View style={styles.text}>
        {text ? (
          <Pressable
            testID="details-header-title"
            accessibilityRole="button"
            accessibilityLabel={text}
            accessibilityState={{ expanded }}
            onPress={() => setExpandedId(expanded ? null : entry.id)}
          >
            <Text selectable={false} numberOfLines={expanded ? TITLE_LINES : 1} style={titleStyle}>{text}</Text>
          </Pressable>
        ) : title ?? null}
        {streaming || subtitle.length > 0 || meta ? (
          <View testID="details-header-subtitle" style={styles.subtitle}>
            {streaming ? (
              <View testID="details-header-streaming" style={styles.dot}>
                <RunningDot color={tokens.accent} accessibilityLabel={toolbarLabel("Streaming", language)} />
              </View>
            ) : null}
            {subtitle.length > 0 ? (
              <Text selectable={false} numberOfLines={1}
                style={[styles.subtitleText, unselectable, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
                {subtitle.map((part, index) => (
                  <Text key={index} style={index === 0 && part.status ? { color: toneColor(entry.tone, tokens) } : undefined}>
                    {index > 0 ? ` · ${part.text}` : part.text}
                  </Text>
                ))}
              </Text>
            ) : null}
            {meta ? <View style={styles.meta}>{meta}</View> : null}
          </View>
        ) : null}
      </View>
      <SpokenLabelsContext.Provider value><ToolbarMetricsContext.Provider value={metrics}>
        {/* The group ends at the panel's right edge: names open leftwards. */}
        <TooltipAlignContext.Provider value="end">
          <View style={styles.buttons}>
            {navigable ? <>
              <ToolbarButton icon="ChevronLeft" label="Previous block" disabled={!shell.canStep.previous}
                onPress={() => shell.step(-1)} tokens={tokens} />
              <ToolbarButton icon="ChevronRight" label="Next block" disabled={!shell.canStep.next}
                onPress={() => shell.step(1)} tokens={tokens} />
            </> : null}
            <ToolbarButton icon="X" label="Close details" onPress={shell.close} tokens={tokens} />
          </View>
        </TooltipAlignContext.Provider>
      </ToolbarMetricsContext.Provider></SpokenLabelsContext.Provider>
    </View>
  );
}

/** The subtitle's parts: the block's own (its first is the status), then its place among the blocks. */
export function subtitleParts(entry: Pick<BlockEntry, "subtitle">, place: string | null): Array<{ text: string; status: boolean }> {
  const parts = entry.subtitle.filter(Boolean).map((text, index) => ({ text, status: index === 0 }));
  if (place) parts.push({ text: place, status: false });
  return parts;
}

function toneColor(tone: BlockEntry["tone"], tokens: ExtendedThemeTokens): string {
  switch (tone) {
    case "accent": return tokens.accent;
    case "success": return tokens.success;
    case "warning": return tokens.warning;
    case "danger": return tokens.danger;
    default: return tokens.foregroundMuted;
  }
}

/**
 * The block's icon in its tile, by the name its row draws (`RowIcon`): a
 * `brand:` name is a daemon raster (the npm mark of a Bash call), `provider:`
 * a harness logo, anything else a Lucide icon. `Glyph` alone knows only the
 * bare brand names, and drew a `brand:` one as an unknown Lucide icon: nothing.
 */
function TileIcon({ name, color }: { name: string; color: string }) {
  return renderMarkIcon({ name, size: TILE_ICON, brandColor: color, providerColor: color })
    ?? <Glyph name={name} size={TILE_ICON} color={color} />;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.xs,
    flexShrink: 0,
  },
  tile: { width: ICON_TILE, height: ICON_TILE, borderRadius: 7, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontWeight: "600" },
  subtitle: { flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0 },
  subtitleText: { flexShrink: 1, fontSize: 12, lineHeight: 16 },
  dot: { width: 8, alignItems: "center", justifyContent: "center" },
  meta: { flexShrink: 0 },
  buttons: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 },
});
