/**
 * General → Agent steps, one tap from the chat: a composer pill that shows
 * the current level and switches it, and `/bp-timeline` as the fallback.
 *
 * Paseo hangs a composer pill on one agent, and tells a plugin neither which
 * agent is open nor when one opens. A timeline row this plugin draws does
 * know its agent, so the first such row asks for the agent's pill
 * (`useTimelineLevelPill`), once the host knows the agent's workspace; the
 * pill then stays for the session. An agent
 * whose timeline has no plugin row gets none, and keeps the slash command.
 *
 * The level is the shared preference, so every pill, the settings page and
 * the other clients follow one switch; the transformers re-register on it
 * (`followPreference`).
 */
import { useEffect } from "react";
import type {
  PluginButton,
  PluginButtonMenuEntry,
  PluginButtonRegistration,
  PluginClientContext,
  PluginClientSlashCommandContribution,
} from "@getpaseo/plugin/client";
import { useAgent } from "@getpaseo/plugin/client";
import { useToast, type ToastApi } from "@getpaseo/plugin/client/ui";
import {
  getEnhancerPreferences,
  subscribeEnhancerPreferences,
  updateEnhancerPreferences,
  type EnhancerPreferences,
  type TimelineLevel,
} from "./preferences";
import { resolveLanguage, type SettingsLanguage } from "./i18n/settings-strings";

export const TIMELINE_LEVELS: readonly TimelineLevel[] = ["simple", "standard", "detailed"];

const STRINGS: Readonly<Record<SettingsLanguage, { title: string; levels: Record<TimelineLevel, string>; command: string; hint: string; switched: string }>> = {
  en: {
    title: "Agent steps",
    levels: { simple: "Simple", standard: "Standard", detailed: "Detailed" },
    command: "Switch how many agent steps the chat shows",
    hint: "1 simple | 2 standard | 3 detailed",
    switched: "Agent steps: {level}",
  },
  zh: {
    title: "工作过程",
    levels: { simple: "简洁", standard: "标准", detailed: "详细" },
    command: "切换对话里显示多少工作过程",
    hint: "1 简洁 | 2 标准 | 3 详细",
    switched: "工作过程：{level}",
  },
};

const PILL_ID = "better-paseo-timeline-level";

function strings(preferences: EnhancerPreferences) {
  // A partial record from the daemon can leave the language unset.
  return STRINGS[resolveLanguage(preferences.language)] ?? STRINGS.en;
}

export function nextTimelineLevel(level: TimelineLevel): TimelineLevel {
  return level === "simple" ? "standard" : level === "standard" ? "detailed" : "simple";
}

/**
 * A `/bp-timeline` argument: empty cycles, 1, 2 or 3 picks a level (the menu's
 * order), as does a level name in either language; anything else is null.
 */
export function parseTimelineLevelArgument(args: string, current: TimelineLevel): TimelineLevel | null {
  const word = args.trim().toLowerCase();
  if (!word) return nextTimelineLevel(current);
  const match = TIMELINE_LEVELS.find((level, index) => word === String(index + 1) || level === word || STRINGS.zh.levels[level] === word || STRINGS.en.levels[level].toLowerCase() === word);
  return match ?? null;
}

function setLevel(level: TimelineLevel): void {
  if (getEnhancerPreferences().timelineLevel !== level) updateEnhancerPreferences({ timelineLevel: level });
}

/** One, two, three lines: each level's icon in the menu. */
export const TIMELINE_LEVEL_ICONS: Readonly<Record<TimelineLevel, string>> = {
  simple: "Minus",
  standard: "Equal",
  detailed: "Menu",
};

/** The pill as the preferences have it now; a complete button, so `update` replaces the menu too. */
export function timelineLevelButton(preferences: EnhancerPreferences): PluginButton {
  const text = strings(preferences);
  const items: PluginButtonMenuEntry[] = TIMELINE_LEVELS.map((level) => ({
    kind: "item",
    id: level,
    // A menu item has only a leading icon and no checked state, so the
    // current level is marked in its title.
    title: level === preferences.timelineLevel ? `${text.levels[level]} ✓` : text.levels[level],
    icon: TIMELINE_LEVEL_ICONS[level],
    behavior: { kind: "action", onPress: () => setLevel(level) },
  }));
  return {
    title: text.title,
    label: text.levels[preferences.timelineLevel],
    icon: "ListCollapse",
    // The level only shapes the chat this plugin draws.
    visible: preferences.chatEnabled,
    behavior: { kind: "menu", items },
  };
}

/** What the pill shows; a change in anything else leaves the pills alone. */
function buttonKey(preferences: EnhancerPreferences): string {
  return `${preferences.timelineLevel}|${preferences.chatEnabled}|${resolveLanguage(preferences.language)}`;
}

export interface TimelineLevelControl {
  /** Adds the agent's pill once. Repeated calls cost a map lookup. */
  request(agentId: string, workspaceId: string): void;
  remove(): void;
}

export function createTimelineLevelControl(client: Pick<PluginClientContext, "addComposerPill">): TimelineLevelControl {
  const pills = new Map<string, PluginButtonRegistration>();
  let removed = false;
  let key = buttonKey(getEnhancerPreferences());

  const unsubscribe = subscribeEnhancerPreferences(() => {
    const preferences = getEnhancerPreferences();
    const next = buttonKey(preferences);
    if (next === key) return;
    key = next;
    const button = timelineLevelButton(preferences);
    pills.forEach((pill) => pill.update(button));
  });

  return {
    request(agentId, workspaceId) {
      if (removed || pills.has(agentId)) return;
      pills.set(agentId, client.addComposerPill({ id: PILL_ID, workspaceId, agentId, button: timelineLevelButton(getEnhancerPreferences()) }));
    },
    remove() {
      removed = true;
      unsubscribe();
      pills.forEach((pill) => pill.remove());
      pills.clear();
    },
  };
}

let active: TimelineLevelControl | null = null;
// A slash command runs outside React, so it borrows the toast of a mounted plugin row.
let rowToast: ToastApi | null = null;

export function timelineLevelSlashCommand(control: TimelineLevelControl): PluginClientSlashCommandContribution {
  const text = strings(getEnhancerPreferences());
  return {
    name: "bp-timeline",
    description: text.command,
    argumentHint: text.hint,
    context: "agent",
    onSubmit(context) {
      const level = parseTimelineLevelArgument(context.args, getEnhancerPreferences().timelineLevel);
      control.request(context.agent.id, context.agent.workspaceId);
      const now = strings(getEnhancerPreferences());
      if (!level) {
        rowToast?.error(`/bp-timeline ${now.hint}`);
        return;
      }
      setLevel(level);
      // Nothing on screen may change, so say what the chat shows now.
      rowToast?.show(now.switched.replace("{level}", now.levels[level]));
    },
  };
}

/** Installs the pills and `/bp-timeline`. Returns the cleanup. */
export function installTimelineLevelControl(client: Pick<PluginClientContext, "addComposerPill" | "addSlashCommand">): () => void {
  const control = createTimelineLevelControl(client);
  active = control;
  const removeCommand = client.addSlashCommand(timelineLevelSlashCommand(control));
  return () => {
    removeCommand();
    control.remove();
    if (active === control) active = null;
  };
}

/** A plugin row's request for its agent's pill; it also lends `/bp-timeline` its toast. */
export function useTimelineLevelPill(agentId: string): void {
  const workspaceId = useAgent(agentId, (agent) => agent.workspaceId);
  const toast = useToast();
  useEffect(() => {
    if (workspaceId) active?.request(agentId, workspaceId);
  }, [agentId, workspaceId]);
  useEffect(() => {
    rowToast = toast;
  }, [toast]);
}

/** Tests: the toast a command would use. */
export function setTimelineLevelToast(toast: ToastApi | null): void {
  rowToast = toast;
}
