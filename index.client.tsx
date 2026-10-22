import type { PluginClientContext } from "@getpaseo/plugin/client";
import { z } from "zod";
import { contributeSettingsScreen } from "./client/settings-screen";
import { removeEmbeddedFonts, setEmbeddedFontLoader } from "./client/components/embed-fonts";
import { installHostNoticeStyle } from "./client/components/host-notice";
import { installChatFind } from "./client/components/chat-find";
import { installPointerFocusRing } from "./client/components/focus-ring";
import { extractPromptImages } from "./client/prompt-images";
import { getEnhancerPreferences } from "./client/preferences";
import { followPreference } from "./client/state/follow-preference";
import { perfSlashCommand } from "./client/debug/perf-command";
import { transformCompaction, transformToolCall } from "./client/tools/transform";
import { agentMessageSchema } from "./client/tools/agent-message";
import { assistantRows } from "./client/assistant-transform";
import { embeddedFontsRpc } from "./shared/font-rpc";
import { markBitmapsRpc } from "./shared/mark-rpc";
import { setMarkLoader } from "./client/components/marks";
import { contributeTasks } from "./client/tasks/contribute";
import { installToolRollupSpacing } from "./client/web";
import {
  LiveToolCallRenderer,
  LiveReasoningRenderer,
  LiveTodoRenderer,
  LiveUserMessageRenderer,
  LiveNoticeRenderer,
  LiveAssistantRenderer,
} from "./client/live-renderers";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export default function contribute(client: PluginClientContext) {
  // The embedded Inter faces are read from the daemon and installed on first
  // use by a reader who picks them (`ensureEmbeddedFonts`); unloading
  // removes them.
  setEmbeddedFontLoader(() => client.rpc(embeddedFontsRpc, {}).then((result) => result.faces));
  const removeFonts = () => {
    setEmbeddedFontLoader(null);
    removeEmbeddedFonts();
  };
  // Brand marks are read from the daemon by id, batched per tick, as rows draw them.
  setMarkLoader((ids) => client.rpc(markBitmapsRpc, { ids }).then((result) => result.bitmaps));
  // The host draws  rows itself; this only re-chromes them.
  const removeNoticeStyle = installHostNoticeStyle();
  // Paseo's Ctrl+F cannot reveal rows this plugin draws; this bar can.
  const removeChatFind = installChatFind();
  // A clicked row, chip or button keeps no focus ring; Tab focus does.
  const removeFocusRing = installPointerFocusRing();
  const removeRollupSpacing = installToolRollupSpacing();

  // Configuration lives in the host Settings area: one page, with the chat
  // options and the Tasks board's as its two halves.
  const removeSettings = contributeSettingsScreen(client);

  // Live chat timeline interception: render real tool calls, reasoning, and todos with enhanced UI.
  const removeToolTransformer = client.addTimelineTransformer({
    id: "omp-enhanced-tool-call",
    query: { itemType: "tool_call" },
    transform: transformToolCall,
  });

  // Drawn by the tool row renderer, as a row like a call's.
  const removeCompactionTransformer = client.addTimelineTransformer({
    id: "omp-enhanced-compaction",
    query: { itemType: "compaction" },
    transform: transformCompaction,
  });

  const removeToolRenderer = client.addTimelineRenderer({
    kind: "omp-tool-call",
    version: 1,
    schema: z.object({
      name: z.string(),
      status: z.string(),
      detail: z.record(z.string(), z.unknown()).optional(),
      callId: z.string().optional(),
      error: z.string().nullable().optional(),
      phase: z.string().optional(),
      approved: z.boolean().optional(),
      questionData: z.record(z.string(), z.unknown()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      agentMessage: agentMessageSchema.optional(),
    }),
    Component: LiveToolCallRenderer,
  });

  const removeReasoningTransformer = client.addTimelineTransformer({
    id: "omp-enhanced-reasoning",
    query: { itemType: "reasoning" },
    transform({ item, phase }) {
      if (item.type !== "reasoning") return undefined;
      return {
        items: [
          {
            type: "plugin" as const,
            kind: "omp-reasoning",
            version: 1,
            data: {
              text: item.text,
              phase,
            },
          },
        ],
      };
    },
  });

  const removeReasoningRenderer = client.addTimelineRenderer({
    kind: "omp-reasoning",
    version: 1,
    schema: z.object({
      text: z.string(),
      phase: z.string().optional(),
    }),
    Component: LiveReasoningRenderer,
  });

  const removeTodoTransformer = client.addTimelineTransformer({
    id: "omp-enhanced-todo",
    query: { itemType: "todo" },
    transform({ item, phase }) {
      if (item.type !== "todo") return undefined;
      return {
        items: [
          {
            type: "plugin" as const,
            kind: "omp-todo",
            version: 1,
            data: {
              items: toJsonValue(item.items),
              phase,
            },
          },
        ],
      };
    },
  });

  const removeTodoRenderer = client.addTimelineRenderer({
    kind: "omp-todo",
    version: 1,
    schema: z.object({
      items: z.array(z.record(z.string(), z.unknown())),
      phase: z.string().optional(),
    }),
    Component: LiveTodoRenderer,
  });

  // Registered again when the preference changes, so prompts already
  // projected follow it (see `followPreference`).
  const removeUserTransformer = followPreference("enhancedUserBubble", () =>
    client.addTimelineTransformer({
      id: "omp-enhanced-user-message",
      query: { itemType: "user_message" },
      transform({ item }) {
        if (item.type !== "user_message") return undefined;
        // The host strips images while mapping the stream item, so an enhanced
        // bubble would silently swallow a pasted screenshot. The preference lets
        // the reader trade the bubble for the host's image previews.
        if (!getEnhancerPreferences().enhancedUserBubble) return undefined;
        const images = extractPromptImages(item);
        // Replacing the item drops whatever this renderer does not carry, so a
        // message with an attachment it cannot show is left to the host.
        if (images.hasUnrenderable) return undefined;
        // Both message ids ride along so the renderer can mark the card with
        // the id the chat outline scrolls to (see `prompt-anchor.ts`).
        // Replacing the item leaves the outline nothing to find otherwise.
        return {
          items: [
            {
              type: "plugin" as const,
              kind: "omp-user-message",
              version: 1,
              data: toJsonValue({
                text: item.text,
                ...(images.uris.length > 0 ? { images: images.uris } : {}),
                ...(item.messageId ? { messageId: item.messageId } : {}),
                ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
              }),
            },
          ],
        };
      },
    }),
  );

  const removeUserRenderer = client.addTimelineRenderer({
    kind: "omp-user-message",
    version: 1,
    schema: z.object({
      text: z.string(),
      images: z.array(z.string()).optional(),
      messageId: z.string().optional(),
      clientMessageId: z.string().optional(),
    }),
    Component: LiveUserMessageRenderer,
  });

  // The assistant's reply. The preference is read inside `transform`, and the
  // transformer is registered again when it changes, so replies already shown
  // follow it too; a reply the plugin should not own is left to the host.
  const removeAssistantTransformer = followPreference("assistantMarkdown", () =>
    client.addTimelineTransformer({
      id: "omp-enhanced-assistant",
      query: { itemType: "assistant_message" },
      transform({ item, phase }) {
        if (item.type !== "assistant_message") return undefined;
        if (!getEnhancerPreferences().assistantMarkdown) return undefined;
        if (!item.text.trim()) return undefined;
        return { items: assistantRows(item.text, phase) };
      },
    }),
  );

  const removeAssistantRenderer = client.addTimelineRenderer({
    kind: "omp-assistant",
    version: 1,
    schema: z.object({ text: z.string(), phase: z.string().optional(),
      blockIndex: z.number().int().nonnegative().optional(), messageText: z.string().optional(),
      listContinuation: z.boolean().optional() }),
    Component: LiveAssistantRenderer,
  });

  // Only `error` is intercepted here. Paseo 0.8 accepts transformers for
  // user_message, assistant_message, reasoning, tool_call, todo, error, and
  // compaction; `notification` — the ⓘ row a finished background job produces —
  // is not on that list, and registering it throws. Every contribution in this
  // function shares one call frame, so that throw drops every renderer the
  // plugin installs and the whole chat falls back to native styling. Add the
  // notification transformer the day the host accepts the type, not before.

  const removeErrorTransformer = client.addTimelineTransformer({
    id: "omp-enhanced-error",
    query: { itemType: "error" },
    transform({ item }) {
      if (item.type !== "error") return undefined;
      return {
        items: [
          {
            type: "plugin" as const,
            kind: "omp-notice",
            version: 1,
            data: { level: "error", message: item.message, fatal: true },
          },
        ],
      };
    },
  });

  const removeNoticeRenderer = client.addTimelineRenderer({
    kind: "omp-notice",
    version: 1,
    schema: z.object({
      level: z.string(),
      message: z.string(),
      fatal: z.boolean().optional(),
    }),
    Component: LiveNoticeRenderer,
  });

  // Debug only: `/bc-perf on|off|reset|dump [label]` for hosts without a console.
  const removePerfCommand = client.addSlashCommand(perfSlashCommand);

  // The Tasks board: a screen, its sidebar entry and a Command Center item;
  // its options are the Tasks half of the settings page (docs/tasks-board.md).
  const removeTasks = contributeTasks(client);

  return () => {
    removeTasks();
    removeSettings();
    removePerfCommand();
    removeFonts();
    setMarkLoader(null);
    removeFocusRing();
    removeRollupSpacing();
    removeNoticeStyle();
    removeChatFind();
    removeToolTransformer();
    removeCompactionTransformer();
    removeToolRenderer();
    removeReasoningTransformer();
    removeReasoningRenderer();
    removeTodoTransformer();
    removeTodoRenderer();
    removeUserTransformer();
    removeUserRenderer();
    removeAssistantTransformer();
    removeAssistantRenderer();
    removeErrorTransformer();
    removeNoticeRenderer();
  };
}
