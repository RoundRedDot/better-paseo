import React, { useMemo, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { radiusV2, space } from "../components/theme-tokens";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { selectionCodeText } from "../components/selection-actions";
import { SelectableText } from "./prose-text";

/**
 * The band a shell or git call's command sits on: one line on its own fill,
 * ruled at the left, apart from what follows it.
 */
export function CommandBand({ tokens, style, children }: {
  tokens: ExtendedThemeTokens;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const band = useMemo(
    () => ({
      backgroundColor: tokens.v2.surface2,
      borderLeftWidth: 2,
      borderLeftColor: tokens.row.meta,
      borderTopRightRadius: radiusV2.block,
      borderBottomRightRadius: radiusV2.block,
      paddingVertical: space.xs,
      paddingHorizontal: space.sm,
    }),
    [tokens],
  );
  return <View style={[band, style]}>{children}</View>;
}

/** The whole path at the top of a preview, on the command's band. */
export function PreviewPath({ path, tokens }: { path: string; tokens: ExtendedThemeTokens }) {
  return (
    <CommandBand tokens={tokens}>
      <SelectableText
        {...selectionCodeText}
        style={[
          styles.clear,
          {
            fontFamily: tokens.fontMono,
            fontSize: tokens.typography.mono.size,
            lineHeight: tokens.typography.mono.lineHeight,
            color: tokens.row.outputText,
          },
        ]}
      >
        {path}
      </SelectableText>
    </CommandBand>
  );
}

// A UITextView paints its own white unless told otherwise.
const styles = StyleSheet.create({ clear: { backgroundColor: "transparent" } });
