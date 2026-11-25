import React, { useContext, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { ImagePreview } from "../../image-preview";
import { useImageFile } from "../../../image-file";
import { space } from "../../theme-tokens";
import { useHomeDirectory } from "../../../state/home-directory";
import { PathContext } from "../../../ui/path-text";
import type { RenderContext } from "./context";

/** A paragraph that is one local image, drawn as the image rather than its alt text. */
export function LocalImage({ path, context }: { path: string; context: RenderContext }) {
  // The address is absolute, so no working directory is involved.
  const file = useImageFile(path, null);
  const reveal = context.onRevealPath;
  const paths = useContext(PathContext);
  const home = useHomeDirectory();
  const imagePaths = useMemo(() => ({ ...paths, home }), [paths, home]);
  return (
    <View style={styles.frame}>
      <PathContext.Provider value={imagePaths}>
        <ImagePreview
          bleed
          path={path}
          file={file}
          tokens={context.tokens}
          onReveal={reveal ? () => reveal(path) : undefined}
        />
      </PathContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { marginVertical: space.sm },
});
