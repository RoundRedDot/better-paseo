import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  CARD_FIELDS,
  DENSITY_PRESETS,
  DONE_WINDOWS,
  LABEL_LIMITS,
  LANE_WIDTHS,
  SIDEBAR_COUNTS,
  applyDensity,
  setCardSetting,
  type CardField,
  type Density,
  type DoneWindow,
  type LabelLimit,
  type LaneWidth,
  type SidebarCount,
  type TasksSettings,
} from "../../../shared/tasks-settings";
import { mix, radiusV2, space } from "../../components/theme-tokens";
import { PlainButton, Section, Segmented, SettingRow, Toggle, controlStyles, type PageLook } from "../../settings-controls";
import { tasksBoardOpener } from "../board/enabled";
import { useTasksLanguage } from "../i18n";
import { TasksBoardPreview } from "./board-preview";
import { TASKS_SETTINGS_STRINGS, type TasksSettingsStrings } from "./strings";
import { dismissEnabledNotice, useTasksForm, type TasksForm } from "./use-tasks-form";

/**
 * The Tasks board on Better Paseo's settings page. `TasksEntrySection` heads
 * the chat half: the switch, what the board looks like while it is off, and
 * the way to the rest. `TasksSettingsPanel` is the Tasks half: the switch,
 * the preview of the board, and every option of it. Both edit the host's
 * Tasks settings record (`useTasksForm`), so the sidebar entry follows the
 * switch at once, whichever half flipped it.
 */

const options = <Value extends string>(values: readonly Value[], labels: Record<Value, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

function useStrings(): { strings: TasksSettingsStrings; language: "en" | "zh" } {
  const language = useTasksLanguage();
  return { strings: TASKS_SETTINGS_STRINGS[language], language };
}

/** A block inside a section's card, under a 1pt rule, padded like a row. */
function RowBlock({ look, children, testID, tint }: { look: PageLook; children: React.ReactNode; testID?: string; tint?: string }) {
  return (
    <View
      testID={testID}
      style={[
        styles.block,
        { borderTopColor: look.tokens.v2.border },
        tint ? { backgroundColor: tint } : null,
      ]}
    >
      {children}
    </View>
  );
}

function Note({ text, look, danger = false }: { text: string; look: PageLook; danger?: boolean }) {
  const { tokens, compact } = look;
  return (
    <Text
      style={[
        controlStyles.rowNote,
        compact ? controlStyles.sectionTitleInset : controlStyles.sectionTitleDesktop,
        { color: danger ? tokens.warning : tokens.foregroundMuted, fontFamily: tokens.fontUi },
      ]}
    >
      {text}
    </Text>
  );
}

/** Saving, a refused save, a failed one: one line over the options. */
function FormNotes({ form, strings, look }: { form: TasksForm; strings: TasksSettingsStrings; look: PageLook }) {
  const { settings } = form;
  if (settings.saveError) return <Note text={strings.saveError(settings.saveError)} look={look} danger />;
  if (form.conflict) return <Note text={strings.conflict} look={look} />;
  return null;
}

/** Said once the switch went on here: where the entry is, and the board one press away. */
function EnabledNotice({ strings, look }: { strings: TasksSettingsStrings; look: PageLook }) {
  const { tokens } = look;
  const open = tasksBoardOpener();
  return (
    <RowBlock look={look} testID="tasks-enabled-notice" tint={mix(tokens.v2.surface1, tokens.accent, tokens.isDark ? 0.14 : 0.07)}>
      <View accessibilityLiveRegion="polite" style={styles.noticeLine}>
        <View style={[styles.noticeDot, { backgroundColor: tokens.accent }]} />
        <View style={styles.noticeText}>
          <Text style={[look.compact ? controlStyles.rowTitleCompact : controlStyles.rowTitleDesktop, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
            {strings.enabledConfirm}
          </Text>
          <Text style={[controlStyles.rowNote, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
            {strings.enabledConfirmHint}
          </Text>
        </View>
        {open ? (
          <PlainButton
            label={strings.openBoard}
            onPress={() => {
              dismissEnabledNotice();
              open();
            }}
            look={look}
          />
        ) : null}
      </View>
    </RowBlock>
  );
}

/** The switch row, the same on both halves. */
function EnabledRow({ form, strings, look }: { form: TasksForm; strings: TasksSettingsStrings; look: PageLook }) {
  const { settings } = form;
  const ready = settings.status === "ready";
  let description = strings.enabledHint;
  if (settings.status === "loading") description = strings.loading;
  else if (settings.status === "error") description = strings.error(settings.error);
  else if (settings.status === "invalid") description = strings.invalid(settings.error);
  return (
    <SettingRow
      title={strings.enabled}
      description={description}
      control={
        <Toggle
          value={ready ? settings.values.enabled : false}
          onChange={form.setEnabled}
          label={strings.enabled}
          look={look}
        />
      }
      look={look}
      first
      disabled={!ready}
    />
  );
}

/** The preview in its frame: a title, what it shows, the board. */
function PreviewCard(props: {
  look: PageLook;
  theme: PluginTheme;
  values: TasksSettings;
  strings: TasksSettingsStrings;
  language: "en" | "zh";
  hostId?: string;
  /** Inside a section's card rather than a frame of its own. */
  inline?: boolean;
}) {
  const { look, strings, values } = props;
  const { tokens, compact } = look;
  const header = (
    <View style={styles.previewHeader}>
      <View style={styles.previewHeaderText}>
        <Text style={[controlStyles.rowTitleDesktop, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
          {strings.previewTitle}
        </Text>
        <Text style={[controlStyles.rowNote, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
          {values.enabled ? strings.previewOnHint : strings.previewOffHint}
        </Text>
      </View>
      {values.enabled ? null : (
        <Text style={[styles.tag, { color: tokens.foregroundMuted, borderColor: tokens.v2.border, fontFamily: tokens.fontUi }]}>
          {strings.previewOffTag}
        </Text>
      )}
    </View>
  );
  const board = (
    <View style={[styles.previewBoard, { backgroundColor: props.theme.colors.surface0, borderColor: tokens.v2.border }]}>
      <TasksBoardPreview theme={props.theme} values={values} language={props.language} phone={compact} hostId={props.hostId} />
    </View>
  );
  if (props.inline) {
    return (
      <RowBlock look={look} testID="tasks-preview-card">
        {header}
        {board}
      </RowBlock>
    );
  }
  return (
    <View
      testID="tasks-preview-card"
      style={[
        styles.previewCard,
        compact ? styles.previewCardInset : null,
        { borderColor: tokens.v2.border, backgroundColor: tokens.v2.surface1 },
      ]}
    >
      {header}
      {board}
    </View>
  );
}

/**
 * The head of the chat half: the board's switch with one line on what it
 * adds; while the board is off, the board it would draw; the way to the rest
 * of its options.
 */
export function TasksEntrySection({ look, theme, hostId, onShowTasks }: { look: PageLook; theme: PluginTheme; hostId?: string; onShowTasks(): void }) {
  const { strings, language } = useStrings();
  const form = useTasksForm();
  const { settings } = form;
  const off = settings.status === "ready" && !settings.values.enabled;
  return (
    <View style={styles.section}>
      <Section title={strings.enabledTitle} look={look}>
        <EnabledRow form={form} strings={strings} look={look} />
        {off ? <PreviewCard look={look} theme={theme} values={settings.values} strings={strings} language={language} hostId={hostId} inline /> : null}
        {form.turnedOn ? <EnabledNotice strings={strings} look={look} /> : null}
        <SettingRow
          title={strings.moreOptions}
          description={strings.moreOptionsHint}
          control={<PlainButton label={strings.moreOptionsAction} onPress={onShowTasks} look={look} />}
          look={look}
        />
      </Section>
      <FormNotes form={form} strings={strings} look={look} />
    </View>
  );
}

/** A field switch as a chip: a row of them fits beside the preview where fifteen switch rows would not. */
function FieldChip({ label, on, onPress, look }: { label: string; on: boolean; onPress(): void; look: PageLook }) {
  const { tokens } = look;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      aria-checked={on}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={look.compact ? 4 : 0}
      style={({ pressed }) => [
        styles.chip,
        look.compact ? styles.chipCompact : null,
        {
          borderColor: on ? tokens.accent : tokens.v2.border,
          backgroundColor: on ? mix(tokens.v2.surface0, tokens.accent, tokens.isDark ? 0.2 : 0.1) : pressed ? tokens.v2.surface2 : tokens.v2.surface0,
        },
      ]}
    >
      <Text style={[styles.chipMark, { color: on ? tokens.accent : tokens.foregroundSubtle }]}>{on ? "\u2713" : "+"}</Text>
      <Text style={[styles.chipLabel, { color: on ? tokens.foreground : tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>{label}</Text>
    </Pressable>
  );
}

/** Restore asks a second time, in place. */
function ResetRows({ strings, look, hint, onRestore }: { strings: TasksSettingsStrings; look: PageLook; hint: string; onRestore(): void }) {
  const [armed, setArmed] = useState(false);
  return (
    <Section title={strings.resetTitle} look={look}>
      <SettingRow
        title={strings.reset}
        description={armed ? strings.resetConfirmHint : hint}
        control={
          <View style={styles.buttons}>
            {armed ? <PlainButton label={strings.resetCancel} onPress={() => setArmed(false)} look={look} /> : null}
            <PlainButton
              label={armed ? strings.resetConfirm : strings.resetAction}
              onPress={() => {
                if (!armed) return setArmed(true);
                setArmed(false);
                onRestore();
              }}
              look={look}
            />
          </View>
        }
        look={look}
        first
      />
    </Section>
  );
}

/**
 * The Tasks half of the settings page: the switch, the preview, and the
 * options. Wide, the card options sit beside the board and sidebar ones under
 * the preview, so a switch and its effect share a screen.
 */
export function TasksSettingsPanel({ look, theme, side, hostId }: { look: PageLook; theme: PluginTheme; side: boolean; hostId?: string }) {
  const { strings, language } = useStrings();
  const form = useTasksForm();
  const { settings, commit } = form;

  const switchSection = (
    <View style={styles.section}>
      <Section title={strings.enabledTitle} look={look}>
        <EnabledRow form={form} strings={strings} look={look} />
        {form.turnedOn ? <EnabledNotice strings={strings} look={look} /> : null}
      </Section>
      <FormNotes form={form} strings={strings} look={look} />
    </View>
  );

  if (settings.status === "invalid") {
    return (
      <View style={styles.panel} testID="tasks-settings-panel">
        {switchSection}
        <ResetRows strings={strings} look={look} hint={strings.resetInvalidHint} onRestore={() => void form.restoreDefaults()} />
      </View>
    );
  }
  if (settings.status !== "ready") {
    return (
      <View style={styles.panel} testID="tasks-settings-panel">
        {switchSection}
      </View>
    );
  }

  const values = settings.values;
  const card = values.card;
  const densities: Density[] = values.density === "custom" ? [...DENSITY_PRESETS, "custom"] : [...DENSITY_PRESETS];

  const cards = (
    <Section title={strings.cardTitle} look={look}>
      <SettingRow
        title={strings.density}
        description={strings.densityHint}
        control={
          <Segmented<Density>
            label={strings.density}
            value={values.density}
            options={options(densities, strings.densities)}
            onChange={(next) => {
              if (next !== "custom") void commit(applyDensity(values, next));
            }}
            look={look}
          />
        }
        look={look}
        first
        stacked
      />
      <SettingRow
        title={strings.fieldsTitle}
        description={strings.fieldsHint}
        control={
          <View accessibilityLabel={strings.fieldsTitle} style={styles.chips} testID="tasks-field-chips">
            {CARD_FIELDS.map((field: CardField) => (
              <FieldChip
                key={field}
                label={strings.fields[field]}
                on={card[field]}
                onPress={() => void commit(setCardSetting(values, field, !card[field]))}
                look={look}
              />
            ))}
          </View>
        }
        look={look}
        stacked
      />
      <SettingRow
        title={strings.labelLimit}
        control={
          <Segmented<LabelLimit>
            label={strings.labelLimit}
            value={card.labelLimit}
            options={options(LABEL_LIMITS, strings.labelLimits)}
            onChange={(next) => void commit(setCardSetting(values, "labelLimit", next))}
            look={look}
          />
        }
        look={look}
        stacked={look.compact}
        disabled={!card.labels}
      />
    </Section>
  );

  const rest = (
    <>
      <Section title={strings.boardTitle} look={look}>
        <SettingRow
          title={strings.doneWindow}
          control={
            <Segmented<DoneWindow>
              label={strings.doneWindow}
              value={values.board.doneWindow}
              options={options(DONE_WINDOWS, strings.doneWindows)}
              onChange={(next) => void commit({ ...values, board: { ...values.board, doneWindow: next } })}
              look={look}
            />
          }
          look={look}
          first
          stacked
        />
        <SettingRow
          title={strings.laneWidth}
          description={strings.laneWidthHint}
          control={
            <Segmented<LaneWidth>
              label={strings.laneWidth}
              value={values.board.laneWidth}
              options={options(LANE_WIDTHS, strings.laneWidths)}
              onChange={(next) => void commit({ ...values, board: { ...values.board, laneWidth: next } })}
              look={look}
            />
          }
          look={look}
          stacked
        />
        <SettingRow
          title={strings.hideSubtasks}
          description={strings.hideSubtasksHint}
          control={
            <Toggle
              value={values.board.hideSubtasks}
              onChange={(next) => void commit({ ...values, board: { ...values.board, hideSubtasks: next } })}
              label={strings.hideSubtasks}
              look={look}
            />
          }
          look={look}
        />
        <SettingRow
          title={strings.confirmStop}
          control={
            <Toggle
              value={values.board.confirmStop}
              onChange={(next) => void commit({ ...values, board: { ...values.board, confirmStop: next } })}
              label={strings.confirmStop}
              look={look}
            />
          }
          look={look}
        />
      </Section>

      <Section title={strings.sidebarTitle} look={look}>
        <SettingRow
          title={strings.sidebarCount}
          control={
            <Segmented<SidebarCount>
              label={strings.sidebarCount}
              value={values.sidebar.count}
              options={options(SIDEBAR_COUNTS, strings.sidebarCounts)}
              onChange={(next) => void commit({ ...values, sidebar: { count: next } })}
              look={look}
            />
          }
          look={look}
          first
          stacked
        />
      </Section>

      <Section title={strings.phoneTitle} look={look}>
        <SettingRow
          title={strings.compactCards}
          description={strings.compactCardsHint}
          control={
            <Toggle
              value={values.mobile.compactCards}
              onChange={(next) => void commit({ ...values, mobile: { ...values.mobile, compactCards: next } })}
              label={strings.compactCards}
              look={look}
            />
          }
          look={look}
          first
        />
      </Section>

      <ResetRows strings={strings} look={look} hint={strings.resetHint} onRestore={() => void form.restoreDefaults()} />
    </>
  );

  return (
    <View style={styles.panel} testID="tasks-settings-panel">
      {switchSection}
      <PreviewCard look={look} theme={theme} values={values} strings={strings} language={language} hostId={hostId} />
      {side ? (
        <View style={styles.columns}>
          <View style={styles.column}>{cards}</View>
          <View style={styles.column}>{rest}</View>
        </View>
      ) : (
        <>
          {cards}
          {rest}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.xl },
  section: { gap: space.sm },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: space.xl },
  column: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: space.xl },
  block: { borderTopWidth: 1, paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.md },
  noticeLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.md },
  noticeDot: { width: 8, height: 8, borderRadius: 4 },
  noticeText: { flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 0, gap: 2 },
  previewCard: { borderWidth: 1, borderRadius: radiusV2.card, overflow: "hidden" },
  previewCardInset: { marginHorizontal: space.lg },
  previewHeader: { flexDirection: "row", alignItems: "center", gap: space.md, paddingTop: space.md, paddingHorizontal: space.lg },
  previewHeaderText: { flex: 1, minWidth: 0, gap: 2 },
  previewBoard: { margin: space.md, marginTop: space.md, padding: space.sm, borderWidth: 1, borderRadius: radiusV2.block },
  tag: { fontSize: 12, lineHeight: 16, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderRadius: radiusV2.chip },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: radiusV2.pill,
  },
  chipCompact: { minHeight: 34, paddingHorizontal: 12 },
  chipMark: { fontSize: 12, lineHeight: 16, width: 10, textAlign: "center", fontWeight: "600" },
  chipLabel: { fontSize: 13, lineHeight: 18 },
  buttons: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
