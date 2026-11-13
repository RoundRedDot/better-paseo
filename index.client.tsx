import type { PluginClientContext, PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";
import { LiveTurnWorkRenderer } from "./client/components/turn-work";
import { followTurnWorkProjection, projectTurnWork, resetTurnWorkProjection, type TurnWorkSourceIdentity } from "./client/state/turn-work-projection";
import { configureTurnWorkObservations } from "./client/state/turn-footers";
import { contributeSettingsScreen } from "./client/settings-screen";
import { removeEmbeddedFonts, setEmbeddedFontLoader } from "./client/components/embed-fonts";
import { installChatFind } from "./client/components/chat-find";
import { installPointerFocusRing } from "./client/components/focus-ring";
import { extractPromptImages } from "./client/prompt-images";
import { getEnhancerPreferences } from "./client/preferences";
import { followPreference } from "./client/state/follow-preference";
import { readPreferencesAtStartup, watchPreferenceChanges } from "./client/state/preference-sync-slot";
import { perfSlashCommand } from "./client/debug/perf-command";
import { loadMark } from "./client/debug/load-marks";
import { scheduleLoadTraceDump } from "./client/debug/load-trace";
import { transformCompaction, transformToolCall } from "./client/tools/transform";
import { transformNotification } from "./client/notice-transform";
import { agentMessageSchema } from "./client/tools/agent-message";
import { assistantRows } from "./client/assistant-transform";
import { externalHistoryRows } from "./client/external-history";
import { embeddedFontsRpc } from "./shared/font-rpc";
import { markBitmapsRpc } from "./shared/mark-rpc";
import { setMarkLoader } from "./client/components/marks";
import { contributeTasks } from "./client/tasks/contribute";
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
  loadMark("contribute.start");
  // The daemon's preferences, asked for before anything else: iOS and Android
  // have no local copy, and a row's settings hook would ask only once rows
  // mount. A record that differs from the defaults reaches the transformers
  // below (`followPreference`) as soon as it answers, not one projection later.
  const stopPreferenceRead = readPreferencesAtStartup(client);
  // Other clients' changes, also while no plugin row or settings page is
  // mounted (the chat switch off): the switch must be able to come back on.
  const stopPreferenceWatch = watchPreferenceChanges(client);

  // Every chat contribution follows General → Enable Better Paseo chat. Off
  // leaves the whole timeline to Paseo; the Tasks board does not depend on it.
  const followChat = (install: () => () => void) =>
    followPreference("chatEnabled", () => (getEnhancerPreferences().chatEnabled ? install() : () => {}));
  const addChatTransformer = <ItemType extends PluginTimelineTransformerContribution["query"]["itemType"]>(
    contribution: PluginTimelineTransformerContribution<ItemType>,
  ) => followChat(() => client.addTimelineTransformer(contribution));
  const removeWorkObservations = followChat(() => followPreference("autoCollapseTurnWork", () => {
    configureTurnWorkObservations(getEnhancerPreferences().autoCollapseTurnWork);
    return () => configureTurnWorkObservations(false);
  }));

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
  // Paseo's Ctrl+F cannot reveal rows this plugin draws; this bar can.
  const removeChatFind = followChat(installChatFind);
  // A clicked row, chip or button keeps no focus ring; Tab focus does.
  const removeFocusRing = installPointerFocusRing();

  // Configuration lives in the host Settings area: one page, with the chat
  // options and the Tasks board's as its two halves.
  const removeSettings = contributeSettingsScreen(client);

  // Live chat timeline interception: render real tool calls, reasoning, and todos with enhanced UI.
  const removeToolTransformer = followTurnWorkProjection(() => addChatTransformer({
    id: "omp-enhanced-tool-call",
    query: { itemType: "tool_call" },
    transform(input) {
      const result = transformToolCall(input);
      return getEnhancerPreferences().autoCollapseTurnWork
        ? projectTurnWork(input.item, input.phase, result, input as typeof input & Partial<TurnWorkSourceIdentity>) : result;
    },
  }));

  // Drawn by the tool row renderer, as a row like a call's.
  const removeCompactionTransformer = addChatTransformer({
    id: "omp-enhanced-compaction",
    query: { itemType: "compaction" },
    transform: transformCompaction,
  });

  const removeToolRenderer = client.addTimelineRenderer({
    kind: "omp-tool-call",
    version: 1,
    schema: z.object({
      name: z.string(),
      workSource: z.object({ agentId: z.string(), sourceId: z.string(), sourceCursor: z.object({ epoch: z.string(), seq: z.number() }) }).optional(),
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

  const removeReasoningTransformer = followTurnWorkProjection(() => addChatTransformer({
    id: "omp-enhanced-reasoning",
    query: { itemType: "reasoning" },
    transform(input) {
      const { item, phase } = input;
      if (item.type !== "reasoning") return undefined;
      const result = {
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
      return getEnhancerPreferences().autoCollapseTurnWork
        ? projectTurnWork(item, phase, result, input as typeof input & Partial<TurnWorkSourceIdentity>) : result;
    },
  }));

  const removeReasoningRenderer = client.addTimelineRenderer({
    kind: "omp-reasoning",
    version: 1,
    schema: z.object({
      text: z.string(),
      workSource: z.object({ agentId: z.string(), sourceId: z.string(), sourceCursor: z.object({ epoch: z.string(), seq: z.number() }) }).optional(),
      phase: z.string().optional(),
    }),
    Component: LiveReasoningRenderer,
  });

  const removeWorkRenderer = client.addTimelineRenderer({
    kind: "omp-turn-work", version: 1,
    schema: z.object({ groupKey: z.string(), anchor: z.string(), count: z.number(), failed: z.number() }),
    Component: LiveTurnWorkRenderer,
  });

  const removeTodoTransformer = addChatTransformer({
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
    addChatTransformer({
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
    addChatTransformer({
      id: "omp-enhanced-assistant",
      query: { itemType: "assistant_message" },
      transform({ item, phase }) {
        if (item.type !== "assistant_message") return undefined;
        if (!getEnhancerPreferences().assistantMarkdown) return undefined;
        if (!item.text.trim()) return undefined;
        return { items: externalHistoryRows(item.text, phase, item.messageId) ?? assistantRows(item.text, phase) };
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

  // A host notice — the ⓘ row a finished background job produces — is the
  // same row the host draws for `error`: a level and a message, in its own
  // tinted rectangle. Paseo 0.14 lists `notification` among the transformable
  // item types, so both now go through `omp-notice` and read as the rest of
  // the timeline.

  const removeNotificationTransformer = addChatTransformer({
    id: "omp-enhanced-notification",
    query: { itemType: "notification" },
    transform: transformNotification,
  });

  const removeErrorTransformer = addChatTransformer({
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

  // Bench builds send this load's timing marks to the daemon machine.
  const stopLoadTrace = scheduleLoadTraceDump(client);
  loadMark("contribute.end");

  return () => {
    stopLoadTrace();
    stopPreferenceRead();
    stopPreferenceWatch();
    removeTasks();
    removeSettings();
    removePerfCommand();
    removeFonts();
    setMarkLoader(null);
    removeFocusRing();
    removeChatFind();
    removeNotificationTransformer();
    removeToolTransformer();
    removeCompactionTransformer();
    removeToolRenderer();
    removeReasoningTransformer();
    removeReasoningRenderer();
    removeWorkRenderer();
    removeWorkObservations();
    resetTurnWorkProjection();
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
