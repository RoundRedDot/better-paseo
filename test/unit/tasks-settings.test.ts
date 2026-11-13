import { describe, expect, it } from "vitest";
import {
  CARD_PRESETS,
  TASKS_SETTINGS,
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
      enabled: true,
      density: "standard",
      card: { ...CARD_PRESETS.standard.fields, labelLimit: "2" },
      mobile: { compactCards: false },
      board: { doneWindow: "7d", hideSubtasks: false, laneWidth: "default", showArchived: true, showEmptyGroups: true },
      sidebar: { count: "all" },
    });
  });

  it.each(["minimal", "standard", "full"] as const)("migrates old %s without changing its density", async (density) => {
    const old = applyDensity(DEFAULT_TASKS_SETTINGS, density);
    const { plan: _plan, ...card } = old.card;
    const migrated = await TASKS_SETTINGS.migrate!({ ...old, card }, 1);
    const parsed = tasksSettingsSchema.parse(migrated);
    expect(parsed.card.plan).toBe(density !== "minimal");
    expect(parsed.density).toBe(density);
    expect(densityOf(parsed.card)).toBe(density);
  });

  it("migrates custom and missing density to an enabled plan", async () => {
    for (const density of ["custom", undefined]) {
      const parsed = tasksSettingsSchema.parse(await TASKS_SETTINGS.migrate!({ density, card: { model: false } }, 1));
      expect(parsed.card.plan).toBe(true);
      expect(parsed.card.model).toBe(false);
      expect(parsed.density).toBe(density ?? "standard");
    }
    expect(CARD_PRESETS.minimal.fields.plan).toBe(false);
    expect(CARD_PRESETS.standard.fields.plan).toBe(true);
    expect(CARD_PRESETS.full.fields.plan).toBe(true);
  });

  it("keeps the board on unless a record turns it off", () => {
    // A record without the key (or a bad value) reads on.
    expect(tasksSettingsSchema.parse({ density: "full", card: {} }).enabled).toBe(true);
    expect(tasksSettingsSchema.parse({ enabled: "no" }).enabled).toBe(true);
    expect(tasksSettingsSchema.parse({ enabled: false }).enabled).toBe(false);
    // Density presets never touch it.
    expect(applyDensity({ ...DEFAULT_TASKS_SETTINGS, enabled: false }, "minimal").enabled).toBe(false);
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
    expect(tasksSettingsSchema.parse({ board: { confirmStop: false } }).board).toEqual(DEFAULT_TASKS_SETTINGS.board);
    expect(tasksSettingsSchema.parse({ board: { doneWindow: "24h" } }).board.doneWindow).toBe("24h");
    expect(parsed.density).toBe("standard");
    expect(parsed.card.provider).toBe(false);
    expect(parsed.card.labelLimit).toBe("2");
    expect(parsed.board).toEqual({ doneWindow: "7d", hideSubtasks: false, laneWidth: "default", showArchived: true, showEmptyGroups: true });
    // A record saved before the lane width existed keeps its other board options.
    expect(tasksSettingsSchema.parse({ board: { doneWindow: "all", hideSubtasks: true } }).board).toEqual({
      doneWindow: "all",
      hideSubtasks: true,
      laneWidth: "default",
      showArchived: true,
      showEmptyGroups: true,
    });
    expect(tasksSettingsSchema.parse({ board: { laneWidth: "wide" } }).board.laneWidth).toBe("wide");
    // The archived lane shows unless a record turns it off: anything but false reads on.
    expect(tasksSettingsSchema.parse({ board: { showArchived: "no" } }).board.showArchived).toBe(true);
    expect(tasksSettingsSchema.parse({ board: { showArchived: false } }).board.showArchived).toBe(false);
    // Groups with no active task show unless a record turns them off.
    expect(tasksSettingsSchema.parse({ board: { showEmptyGroups: "no" } }).board.showEmptyGroups).toBe(true);
    expect(tasksSettingsSchema.parse({ board: { showEmptyGroups: false } }).board.showEmptyGroups).toBe(false);
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
