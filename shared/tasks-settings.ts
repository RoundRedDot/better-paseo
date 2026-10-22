import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Settings of the Tasks board (docs/tasks-board.md, "插件设置").
 *
 * Host-scoped like the presentation settings, so every client of one daemon
 * shares them; phones get their own switch (`mobileCompactCards`) instead of
 * their own record. Every field degrades to its default on its own (`catch`),
 * so one unusable value never invalidates the whole record.
 *
 * A density preset writes every card switch at once; any hand edit afterwards
 * makes the density `custom` (see `densityOf`). Bump `version` and add a
 * `migrate` when a field is renamed or removed.
 */

export const CARD_FIELDS = [
  "provider",
  "model",
  "thinking",
  "project",
  "projectIcon",
  "workspace",
  "branch",
  "gitStatus",
  "folder",
  "path",
  "labels",
  "pullRequest",
  "timer",
  "context",
  "subtasks",
] as const;
export type CardField = (typeof CARD_FIELDS)[number];

/** How many labels a card shows before folding the rest into +N. */
export const LABEL_LIMITS = ["1", "2", "3", "all"] as const;
export type LabelLimit = (typeof LABEL_LIMITS)[number];

export const DENSITY_PRESETS = ["minimal", "standard", "full"] as const;
export type DensityPreset = (typeof DENSITY_PRESETS)[number];
export const DENSITIES = [...DENSITY_PRESETS, "custom"] as const;
export type Density = (typeof DENSITIES)[number];

export const DONE_WINDOWS = ["24h", "7d", "all"] as const;
export type DoneWindow = (typeof DONE_WINDOWS)[number];

/** How wide the desktop board draws its lanes; `default` is Linear's. Phones draw one lane at a time and ignore it. */
export const LANE_WIDTHS = ["narrow", "default", "wide"] as const;
export type LaneWidth = (typeof LANE_WIDTHS)[number];

/** `all` draws needs input, running and review; records saved as "running-and-input" read as the default, `all`. */
export const SIDEBAR_COUNTS = ["all", "input-only", "none"] as const;
export type SidebarCount = (typeof SIDEBAR_COUNTS)[number];

export type CardFieldSwitches = Record<CardField, boolean>;
export type CardSettings = CardFieldSwitches & { labelLimit: LabelLimit };

export interface CardFieldPreset {
  fields: CardFieldSwitches;
  labelLimit: LabelLimit;
}

/**
 * The density table of the spec, one column per preset. One deliberate
 * difference: minimal turns `project` off. The spec's table has it on, but its
 * own collapse rule ("精简密度只留头部组和计时") and the prototype both keep
 * only the header and the timer.
 */
export const CARD_PRESETS: Readonly<Record<DensityPreset, CardFieldPreset>> = {
  minimal: {
    fields: {
      provider: false,
      model: true,
      thinking: true,
      project: false,
      projectIcon: false,
      workspace: false,
      branch: false,
      gitStatus: false,
      folder: false,
      path: false,
      labels: false,
      pullRequest: false,
      timer: true,
      context: false,
      subtasks: false,
    },
    labelLimit: "2",
  },
  standard: {
    fields: {
      provider: true,
      model: true,
      thinking: true,
      project: true,
      projectIcon: true,
      workspace: true,
      branch: true,
      gitStatus: false,
      folder: true,
      path: false,
      labels: true,
      pullRequest: false,
      timer: true,
      context: true,
      subtasks: true,
    },
    labelLimit: "2",
  },
  full: {
    fields: {
      provider: true,
      model: true,
      thinking: true,
      project: true,
      projectIcon: true,
      workspace: true,
      branch: true,
      gitStatus: true,
      folder: true,
      path: true,
      labels: true,
      pullRequest: true,
      timer: true,
      context: true,
      subtasks: true,
    },
    labelLimit: "all",
  },
};

const flag = (fallback: boolean) => z.boolean().catch(fallback);

const STANDARD_CARD: CardSettings = { ...CARD_PRESETS.standard.fields, labelLimit: CARD_PRESETS.standard.labelLimit };

const cardSchema = z
  .object({
    ...(Object.fromEntries(
      CARD_FIELDS.map((field) => [field, flag(CARD_PRESETS.standard.fields[field])]),
    ) as Record<CardField, z.ZodCatch<z.ZodBoolean>>),
    labelLimit: z.enum(LABEL_LIMITS).catch(STANDARD_CARD.labelLimit),
  })
  .catch({ ...STANDARD_CARD });

/** Keys follow the spec: `card.provider`, `board.doneWindow`, `mobile.compactCards`, `sidebar.count`. */
export const tasksSettingsSchema = z.object({
  /**
   * The board is opt-in: off, there is no sidebar entry, no Command Center
   * item and no agent subscription. A record saved before this switch
   * existed has no key and reads off.
   */
  enabled: flag(false),
  /** The density the card switches were last set from; `custom` after a hand edit. */
  density: z.enum(DENSITIES).catch("standard"),
  card: cardSchema,
  mobile: z.object({ compactCards: flag(false) }).catch({ compactCards: false }),
  board: z
    .object({
      doneWindow: z.enum(DONE_WINDOWS).catch("24h"),
      hideSubtasks: flag(false),
      confirmStop: flag(true),
      laneWidth: z.enum(LANE_WIDTHS).catch("default"),
    })
    .catch({ doneWindow: "24h", hideSubtasks: false, confirmStop: true, laneWidth: "default" }),
  sidebar: z.object({ count: z.enum(SIDEBAR_COUNTS).catch("all") }).catch({ count: "all" }),
});

export type TasksSettings = z.output<typeof tasksSettingsSchema>;

export const DEFAULT_TASKS_SETTINGS: TasksSettings = tasksSettingsSchema.parse({});

export const TASKS_SETTINGS = defineSettings({
  id: "tasks",
  scope: "host",
  version: 1,
  schema: tasksSettingsSchema,
});

/** The settings with every card switch and the label limit set from a preset. */
export function applyDensity(settings: TasksSettings, density: DensityPreset): TasksSettings {
  const preset = CARD_PRESETS[density];
  return { ...settings, density, card: { ...preset.fields, labelLimit: preset.labelLimit } };
}

/** The preset the card switches match exactly, else `custom`. The label limit only counts while labels show. */
export function densityOf(card: CardSettings): Density {
  for (const density of DENSITY_PRESETS) {
    const preset = CARD_PRESETS[density];
    const sameFields = CARD_FIELDS.every((field) => preset.fields[field] === card[field]);
    if (sameFields && (!card.labels || preset.labelLimit === card.labelLimit)) return density;
  }
  return "custom";
}

/** The settings after one card setting changes; the density follows the switches. */
export function setCardSetting<Key extends keyof CardSettings>(
  settings: TasksSettings,
  key: Key,
  value: CardSettings[Key],
): TasksSettings {
  const card = { ...settings.card, [key]: value };
  return { ...settings, card, density: densityOf(card) };
}

/** The card a client draws: the minimal preset on a compact layout when `mobile.compactCards` is on. */
export function effectiveCard(settings: TasksSettings, compact: boolean): CardSettings {
  if (compact && settings.mobile.compactCards) {
    return { ...CARD_PRESETS.minimal.fields, labelLimit: CARD_PRESETS.minimal.labelLimit };
  }
  return settings.card;
}

/** The label limit as a count; `Infinity` for all. */
export function labelLimitCount(limit: LabelLimit): number {
  return limit === "all" ? Number.POSITIVE_INFINITY : Number(limit);
}

/** How far back the done lane reaches, in milliseconds; null for no window. */
export function doneWindowMs(window: DoneWindow): number | null {
  if (window === "24h") return 24 * 60 * 60 * 1000;
  if (window === "7d") return 7 * 24 * 60 * 60 * 1000;
  return null;
}
