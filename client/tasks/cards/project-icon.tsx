import React from "react";
import { Image, Text, View } from "react-native";
import type { TaskLocation } from "../model";

/**
 * Paseo's project icon (v0.12.0 `components/project-icon-view.tsx`,
 * `styles/identity-colors.ts`, `utils/project-display-name.ts`): the
 * project's uploaded image, never rounded, or a rounded square in the
 * project's identity colour carrying a white initial.
 */

/** Paseo's identity fills, in its order: the hash indexes into this list. */
export const IDENTITY_COLORS = [
  "#7a6aa8", // violet
  "#3d7ea6", // sky
  "#388068", // emerald
  "#a4673a", // orange
  "#b05c80", // pink
  "#6a70b8", // indigo
  "#368080", // teal
  "#b06260", // red
  "#8f7838", // amber
  "#5179b0", // blue
] as const;

/** The identity colour of a key, hashed as Paseo does. */
export function identityColor(key: string): string {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return IDENTITY_COLORS[hash % IDENTITY_COLORS.length]!;
}

/** The generated icon's corner: a quarter of the box, rounded. */
export function projectIconRadius(size: number): number {
  return Math.round(size * 0.25);
}

/** The initial: the first letter of the display name's last "/" segment. */
export function projectInitial(displayName: string): string {
  const trimmed = displayName.trim();
  const segments = trimmed.split("/").filter(Boolean);
  return (segments[segments.length - 1] || trimmed).charAt(0).toUpperCase();
}

/**
 * The project's view key, which picks its colour: the data layer's
 * `projectKey` when it has one, else Paseo's `[hostId, projectId]`, else the
 * project id alone.
 */
export function projectViewKey(location: ProjectIconLocation, hostId?: string | null): string {
  if (location.projectKey) return location.projectKey;
  if (hostId && location.projectId) return JSON.stringify([hostId, location.projectId]);
  return location.projectId ?? location.projectName ?? "";
}

/** What the icon reads: a card's location, or a filter row's project. */
export type ProjectIconLocation = Pick<TaskLocation, "projectId" | "projectKey" | "projectName" | "projectIcon">;

export function ProjectIcon(props: { location: ProjectIconLocation; size: number; hostId?: string | null }) {
  const { location, size } = props;
  if (location.projectIcon) {
    return <Image source={{ uri: location.projectIcon }} style={{ width: size, height: size }} testID="project-icon-image" />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: projectIconRadius(size),
        backgroundColor: identityColor(projectViewKey(location, props.hostId)),
        alignItems: "center",
        justifyContent: "center",
      }}
      testID="project-icon-generated"
    >
      <Text style={{ fontSize: Math.round(size * 0.66), lineHeight: size, fontWeight: "600", color: "#ffffff" }}>
        {projectInitial(location.projectName ?? "")}
      </Text>
    </View>
  );
}
