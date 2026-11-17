import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { FILE_OPEN_APPS, FILE_OPEN_LABELS, type FileOpenApp } from "../shared/file-open-apps";
import { useMarkBitmap } from "./components/marks";
import { ChoiceMenuSelect, type MenuChoice } from "./settings-choice-menu";
import type { PageLook } from "./settings-controls";

/**
 * One editor choice. The closed control shows the saved editor. The menu lists
 * System app and the editors this host can launch, so a name the host cannot
 * open does not take a row. Colour rasters stay out of the monochrome marks.
 */
const LOGO = 20;

function visibleApps(available: readonly FileOpenApp[] | null, value: FileOpenApp): FileOpenApp[] {
  if (available === null) return FILE_OPEN_APPS.filter((app) => app === "system" || app === value);
  const allowed = new Set<FileOpenApp>(available);
  allowed.add("system");
  return FILE_OPEN_APPS.filter((app) => allowed.has(app));
}

function EditorLogo({ app }: { app: FileOpenApp }) {
  const uri = useMarkBitmap(`editor:${app}`);
  if (!uri) return <View style={styles.logo} />;
  return <Image accessible={false} source={{ uri }} resizeMode="contain" style={styles.logo} />;
}

function editorChoice(app: FileOpenApp, systemLabel: string): MenuChoice {
  return { value: app, name: app === "system" ? systemLabel : FILE_OPEN_LABELS[app], logo: <EditorLogo app={app} /> };
}

export function FileOpenChoices({
  value,
  onChange,
  look,
  label,
  systemLabel,
  available = null,
}: {
  value: FileOpenApp;
  onChange(next: FileOpenApp): void;
  look: PageLook;
  /** The control's name, the setting title. */
  label: string;
  systemLabel: string;
  /**
   * Editors this host can launch, including `system` once known.
   * Null while the scan has not returned: the menu keeps the saved choice.
   */
  available?: readonly FileOpenApp[] | null;
}) {
  const saved = FILE_OPEN_APPS.includes(value) ? value : FILE_OPEN_APPS[0]!;
  return (
    <ChoiceMenuSelect
      value={value}
      selected={editorChoice(saved, systemLabel)}
      choices={visibleApps(available, value).map((app) => editorChoice(app, systemLabel))}
      onChange={(next) => onChange(next as FileOpenApp)}
      look={look}
      label={label}
    />
  );
}

const styles = StyleSheet.create({
  logo: { width: LOGO, height: LOGO },
});
