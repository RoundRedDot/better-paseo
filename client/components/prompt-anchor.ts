import type { ViewProps } from "react-native";

/**
 * Makes a plugin-rendered prompt findable by the host's chat outline.
 *
 * Clicking a tick in the outline calls `scrollToMessage(id)`, which looks the
 * row up in the DOM by `data-message-id`
 * (`agent-stream/use-scroll-to-message.web.ts:118`, Paseo 0.11.2). The id it
 * passes is the *unprojected* stream item's id
 * (`agent-stream/chat-outline/use-chat-outline.ts`), while the row wrapper of a
 * plugin card carries the projected id `<pluginId>/<itemId>`
 * (`plugins/timeline/projection.ts:105`). The two never match once this plugin
 * renders the prompt, so the jump silently does nothing.
 *
 * The stream id of a user message is not handed to plugins, but it is always
 * one of the two ids that are: a prompt sent from this window keeps its
 * `clientMessageId` as its id after the provider confirms it, and a prompt
 * loaded from history takes its `messageId` (`types/stream.ts`,
 * `createUserMessage` and `applyCanonicalUserMessageEvent`). Each id gets its
 * own marker, so whichever the host searches for is there; a selector that
 * misses one finds the other.
 *
 * The markers are empty, absolutely placed at the card's top-left, and never
 * ancestors of the card's text: the host measures the target's top to land the
 * jump, and finds a selection's message with `closest("[data-message-id]")`,
 * which only ever reaches the host's own row wrapper.
 *
 * Only a mounted card can be found this way. A prompt in the virtualized part
 * of a long chat has no DOM, and the host's fallback looks it up by the
 * projected id, which is not one of these.
 */
export function promptAnchorIds(
  messageId: string | undefined,
  clientMessageId: string | undefined,
): string[] {
  const ids: string[] = [];
  for (const id of [messageId, clientMessageId]) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

const MARKER_STYLE = {
  position: "absolute",
  top: 0,
  left: 0,
  width: 0,
  height: 0,
} as const;

export function promptAnchorMarker(id: string): ViewProps {
  return {
    pointerEvents: "none",
    style: MARKER_STYLE,
    dataSet: { messageId: id },
  } as unknown as ViewProps;
}
