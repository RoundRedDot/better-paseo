import React, { useContext, useLayoutEffect, useRef } from "react";
import { Platform, StyleSheet, View, type TextProps } from "react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { selectionCodeText } from "../components/selection-actions";
import { useEnhancerPreferences } from "../preferences";
import { ProseSelectionContext, SelectableText } from "../ui/prose-text";
import { perfOn } from "./perf";
import { beginFontProbe, FONT_SAMPLES, type FontProbeMetadata, type FontSample } from "./font-probe-store";

/** Measures the command's own text path, only while /bc-perf is enabled. */
export function CommandFontProbe({ tokens, style }: { tokens: ExtendedThemeTokens; style: TextProps["style"] }) {
  const { debugPerf } = useEnhancerPreferences();
  const selectionContext = useContext(ProseSelectionContext);
  if (!debugPerf) return null;
  const text = StyleSheet.flatten(style) ?? {};
  const metadata: FontProbeMetadata = {
    runtimePlatform: Platform.OS,
    tokenPlatform: tokens.platform,
    family: text.fontFamily ?? null,
    size: text.fontSize ?? null,
    weight: text.fontWeight === undefined ? null : String(text.fontWeight),
    fontStyle: text.fontStyle ?? null,
    letterSpacing: text.letterSpacing ?? null,
    monoSource: tokens.typography.mono.source.kind,
    selectionContext,
  };
  // Remount when the requested font changes, even if its layout box is equal.
  return <ActiveFontProbe key={JSON.stringify(metadata)} metadata={metadata} style={style} />;
}

function ActiveFontProbe({ metadata, style }: { metadata: FontProbeMetadata; style: TextProps["style"] }) {
  const record = useRef<ReturnType<typeof beginFontProbe> | null>(null);
  useLayoutEffect(() => {
    record.current = beginFontProbe(metadata);
    return () => { record.current = null; };
  }, []);
  return (
    <View testID="command-font-probe" pointerEvents="none" accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.hidden}>
      {(Object.keys(FONT_SAMPLES) as FontSample[]).map((sample) => (
        <View key={sample} testID={`command-font-probe-${sample}`} style={styles.sample}
          onLayout={(event) => {
            if (perfOn()) record.current?.(sample, event.nativeEvent.layout.width);
          }}>
          <SelectableText {...selectionCodeText} accessible={false} selectable={false} numberOfLines={1} style={style}>
            {FONT_SAMPLES[sample]}
          </SelectableText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Out of flow and invisible. Each wrapper takes its text's intrinsic width;
  // the wrapper's layout works for both Android Text and iOS UITextView.
  hidden: { position: "absolute", top: 0, left: 0, width: 320, opacity: 0, alignItems: "flex-start" },
  sample: { alignSelf: "flex-start" },
});
