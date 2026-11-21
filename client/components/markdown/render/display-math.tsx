import React, { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { CopyButton } from "../../../ui/copy-button";
import { HScroll } from "../../../ui/h-scroll";
import { codeSurface } from "../../host-font-escape";
import type { RenderContext } from "./context";
import { MarkdownProse } from "./prose";
import { useFormula } from "./use-formula";

export function DisplayMath({ tex, context }: { tex: string; context: RenderContext }) {
  const { tokens, metrics, styles } = context;
  const [showSource, setShowSource] = useState(false);
  const [failedUri, setFailedUri] = useState<string>();
  const formula = useFormula(tex, tokens, metrics.bodySize * 1.1, true, !showSource);
  const { imageScale } = formula;
  const image = formula.image?.uri !== failedUri ? formula.image : undefined;
  const error = formula.image && !image ? "Could not load the rendered formula" : formula.error;

  return <View testID="better-paseo-display-math" style={{ minWidth: 0, gap: 4 }}>
    {image && !showSource ? (
      <HScroll tokens={tokens} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: 4 }}>
        <Image key={image.uri} testID="better-paseo-formula-image" source={{ uri: image.uri }} resizeMode="contain"
          accessible accessibilityLabel={tex} onError={() => setFailedUri(image.uri)}
          style={{ width: image.width * imageScale, height: image.height * imageScale, flexShrink: 0 }} />
      </HScroll>
    ) : <MarkdownProse context={context} {...codeSurface} style={styles.plain} text={tex} />}
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
      {error && <Text style={{ color: tokens.foregroundMuted, fontSize: 12, flexShrink: 1 }}>{error}</Text>}
      {image && <Pressable accessibilityRole="button" onPress={() => setShowSource(value => !value)}
        style={{ minHeight: 28, justifyContent: "center", paddingHorizontal: 4 }}>
        <Text style={{ color: tokens.foregroundMuted, fontSize: 12 }}>{showSource ? "Show formula" : "Show LaTeX"}</Text>
      </Pressable>}
      <CopyButton text={tex} tokens={tokens} label="Copy LaTeX" />
    </View>
  </View>;
}
