import React, { useContext, type ReactNode } from "react";
import { ProseSpan } from "../../../ui/prose-text";
import { formatPath } from "../../../paths/format-path";
import { PathContext } from "../../../ui/path-text";
import { useCopy } from "../../../ui/use-copy";
import { useInputCapabilities } from "../../../ui/use-input-capabilities";
import type { RenderContext } from "./context";

/**
 * A link in the prose that points at a file. It behaves as a path does
 * everywhere else (plan §3.9): a pointer reveals the file in the file
 * manager, and touch copies the absolute path, because revealing would open
 * a window on the daemon's machine rather than the phone in hand.
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
  const absolutePath = formatPath(path, pathContext).absolutePath;
  const reveal = context.onRevealPath ?? pathContext.reveal;
  const copies = (capabilities.touch && !capabilities.hover) || !reveal;
  // `onPress` on a Text, as for a web link: a View mid sentence would break
  // the line box.
  return (
    <ProseSpan
      selectable
      accessibilityRole="link"
      accessibilityLabel={absolutePath}
      accessibilityHint={copies ? "Copies the path" : "Reveals the file"}
      onPress={() => (copies ? void copy(absolutePath, { feedback: "toast", label: "Copy path" }) : reveal(absolutePath))}
      style={context.styles.link}
    >
      {children}
    </ProseSpan>
  );
}
