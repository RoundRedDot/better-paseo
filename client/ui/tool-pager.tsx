import { useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { unselectable } from "../components/selection";
import { ToolbarButton } from "./toolbar-button";
import { usePreviewPanel } from "./hover-preview";
import { bindPreviewPaging } from "../web";

/** `‹ 2 / 3 ›`: shared by grouped calls and questions, including maximized arrow-key paging. */
export function ToolPager({ index, count, onChange, tokens, subject = "operation" }: {
  subject?: "operation" | "question";
  index: number;
  count: number;
  onChange(index: number): void;
  tokens: ExtendedThemeTokens;
}) {
  const pagerRef = useRef<View>(null);
  const maximized = usePreviewPanel()?.maximized ?? false;
  useEffect(() => {
    if (!maximized) return;
    return bindPreviewPaging(pagerRef.current, (direction) => {
      const next = index + direction;
      if (next >= 0 && next < count) onChange(next);
    });
  }, [maximized, index, count, onChange]);
  return (
    <View ref={pagerRef} style={styles.pager}>
      <ToolbarButton icon="ChevronLeft" label={`Previous ${subject}`} disabled={index === 0}
        onPress={() => onChange(index - 1)} tokens={tokens} />
      <Text selectable={false} style={[styles.pagerLabel, unselectable, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: tokens.typography.block.caption.size }]}>
        {`${index + 1} / ${count}`}
      </Text>
      <ToolbarButton icon="ChevronRight" label={`Next ${subject}`} disabled={index === count - 1}
        onPress={() => onChange(index + 1)} tokens={tokens} />
    </View>
  );
}

const styles = StyleSheet.create({
  pager: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", zIndex: 1 },
  pagerLabel: { minWidth: 36, textAlign: "center", fontVariant: ["tabular-nums"] },
});
