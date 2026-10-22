import React, { useContext, type ReactNode } from "react";
import { ProseSpan } from "../../../ui/prose-text";
import { formatPath } from "../../../paths/format-path";
import { PathContext } from "../../../ui/path-text";
import { useCopy } from "../../../ui/use-copy";
import { useInputCapabilities } from "../../../ui/use-input-capabilities";
import type { RenderContext } from "./context";

/**
 * A link in the prose that points at a file. It behaves as a path does
 * everywhere else (plan §3.9): the host file pane when this app passed
 * `openFile`, otherwise a pointer reveals the file in the file manager and
 * touch copies the absolute path.
 */
export function LocalLink({
  path,
  context,
  children,
}: {
  path: string;
  context: RenderContext;
  children: ReactNode;
}) {
  const pathContext = useContext(PathContext);
  const capabilities = useInputCapabilities();
  const { copy } = useCopy();
  const formatted = formatPath(path, pathContext);
  const absolutePath = formatted.absolutePath;
  const reveal = context.onRevealPath ?? pathContext.reveal;
  const openInPane = pathContext.openInPane;
  const copies = !openInPane && ((capabilities.touch && !capabilities.hover) || !reveal);
  // `onPress` on a Text, as for a web link: a View mid sentence would break
  // the line box.
  return (
    <ProseSpan
      selectable
      accessibilityRole="link"
      accessibilityLabel={absolutePath}
      accessibilityHint={openInPane ? "Opens the file" : copies ? "Copies the path" : "Reveals the file"}
      onPress={() => {
        if (openInPane) {
          openInPane(absolutePath, formatted.suffix);
          return;
        }
        if (copies || !reveal) void copy(absolutePath, { feedback: "toast", label: "Copy path" });
        else reveal(absolutePath);
      }}
      style={context.styles.link}
    >
      {children}
    </ProseSpan>
  );
}
