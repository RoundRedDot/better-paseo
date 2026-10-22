import { describe, expect, it } from "vitest";
import {
  CARD_PRESETS,
  DEFAULT_TASKS_SETTINGS,
  applyDensity,
  densityOf,
  doneWindowMs,
  effectiveCard,
  labelLimitCount,
  setCardSetting,
  tasksSettingsSchema,
} from "../../shared/tasks-settings";

describe("tasks settings", () => {
  it("defaults to the spec's values", () => {
    expect(DEFAULT_TASKS_SETTINGS).toEqual({
      enabled: false,
      density: "standard",
      card: { ...CARD_PRESETS.standard.fields, labelLimit: "2" },
      mobile: { compactCards: false },
      board: { doneWindow: "24h", hideSubtasks: false, confirmStop: true, laneWidth: "default" },
      sidebar: { count: "all" },
    });
  });

  it("keeps the board off unless a record turns it on", () => {
    // A record saved before the switch existed has no key: still version 1, read as off.
    expect(tasksSettingsSchema.parse({ density: "full", card: {} }).enabled).toBe(false);
    expect(tasksSettingsSchema.parse({ enabled: "yes" }).enabled).toBe(false);
    expect(tasksSettingsSchema.parse({ enabled: true }).enabled).toBe(true);
    // Density presets never touch it.
    expect(applyDensity({ ...DEFAULT_TASKS_SETTINGS, enabled: true }, "minimal").enabled).toBe(true);
  });

  it("reads the old two-count sidebar choice as the three counts", () => {
    expect(tasksSettingsSchema.parse({ sidebar: { count: "running-and-input" } }).sidebar.count).toBe("all");
    expect(tasksSettingsSchema.parse({ sidebar: { count: "input-only" } }).sidebar.count).toBe("input-only");
  });

  it("degrades one bad value without losing the rest", () => {
    const parsed = tasksSettingsSchema.parse({
      density: "loud",
      card: { provider: false, labelLimit: "9" },
      board: { doneWindow: "7d", confirmStop: "yes", laneWidth: "huge" },
    });
    expect(parsed.density).toBe("standard");
    expect(parsed.card.provider).toBe(false);
    expect(parsed.card.labelLimit).toBe("2");
    expect(parsed.board).toEqual({ doneWindow: "7d", hideSubtasks: false, confirmStop: true, laneWidth: "default" });
    // A record saved before the lane width existed keeps its other board options.
    expect(tasksSettingsSchema.parse({ board: { doneWindow: "all", hideSubtasks: true } }).board).toEqual({
      doneWindow: "all",
      hideSubtasks: true,
      confirmStop: true,
      laneWidth: "default",
    });
    expect(tasksSettingsSchema.parse({ board: { laneWidth: "wide" } }).board.laneWidth).toBe("wide");
  });

  it("writes every switch from a preset", () => {
    const minimal = applyDensity(DEFAULT_TASKS_SETTINGS, "minimal");
    expect(minimal.density).toBe("minimal");
    expect(minimal.card.provider).toBe(false);
    expect(minimal.card.timer).toBe(true);
    const full = applyDensity(DEFAULT_TASKS_SETTINGS, "full");
    expect(full.card.labelLimit).toBe("all");
    expect(full.card.gitStatus).toBe(true);
  });

  it("turns custom after a hand edit and back when the switches match a preset again", () => {
    const edited = setCardSetting(DEFAULT_TASKS_SETTINGS, "gitStatus", true);
    expect(edited.density).toBe("custom");
    expect(setCardSetting(edited, "gitStatus", false).density).toBe("standard");
  });

  it("ignores the label limit while labels are off", () => {
    const minimal = applyDensity(DEFAULT_TASKS_SETTINGS, "minimal");
    expect(densityOf({ ...minimal.card, labelLimit: "all" })).toBe("minimal");
    expect(densityOf({ ...DEFAULT_TASKS_SETTINGS.card, labelLimit: "3" })).toBe("custom");
  });

  it("uses the minimal card on a phone only when the phone switch is on", () => {
    expect(effectiveCard(DEFAULT_TASKS_SETTINGS, true)).toBe(DEFAULT_TASKS_SETTINGS.card);
    const phone = { ...DEFAULT_TASKS_SETTINGS, mobile: { compactCards: true } };
    expect(effectiveCard(phone, false)).toBe(phone.card);
    expect(effectiveCard(phone, true).provider).toBe(false);
  });

  it("converts limits and windows", () => {
    expect(labelLimitCount("2")).toBe(2);
    expect(labelLimitCount("all")).toBe(Number.POSITIVE_INFINITY);
    expect(doneWindowMs("24h")).toBe(86_400_000);
    expect(doneWindowMs("all")).toBeNull();
  });
});
