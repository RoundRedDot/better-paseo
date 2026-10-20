import React from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { CardSettings } from "../../../shared/tasks-settings";
import type { PermissionButton, StopPhase } from "../actions";
import type { StatusKind, TaskCard } from "../model";

/**
 * The cards' public contract (slice B owns this directory).
 *
 * PLACEHOLDER: until slice B lands, a plain title row. The props here are
 * the contract the board renders against; slice B replaces the bodies, and
 * only extends the props.
 */

export interface StatusIconProps {
  kind: StatusKind;
  /** Box size; the ring and dots scale from Paseo's sidebar geometry. Default 16. */
  size?: number;
  theme: PluginTheme;
}

/** Paseo's sidebar status indicator. All running rings rotate in phase (900 ms per turn). */
export function StatusIcon(props: StatusIconProps) {
  return <View style={{ width: props.size ?? 16, height: props.size ?? 16 }} />;
}

export interface CardCallbacks {
  /** Jump to the agent's tab (`navigation.openAgent`). Absent on hosts without navigation: hide the jump button. */
  onOpen?(agentId: string): void;
  /** Scroll the board to a card and highlight it (child → parent link). */
  onReveal(agentId: string): void;
  /** Stop, if the card is stoppable and Stop is available. */
  onStop?(card: TaskCard, options?: { withChildren?: boolean }): void;
  onCancelStop?(agentId: string): void;
  onPermission?(card: TaskCard, button: PermissionButton): void;
  /** Long press on a phone, hover on desktop: the details sheet or popover. */
  onDetails?(card: TaskCard): void;
}

export interface TaskCardViewProps extends CardCallbacks {
  card: TaskCard;
  /** Field switches after `effectiveCard`. */
  fields: CardSettings;
  theme: PluginTheme;
  /** Phone layout (`layout.compact`): must/default/details-only tiers, 36 px jump button. */
  compact: boolean;
  /** The permission buttons for `card.permission` (from `permissionButtons`). */
  permissionButtons: PermissionButton[];
  stopPhase: StopPhase;
  /** Keyboard focus ring. */
  focused: boolean;
  /** The 1 s highlight after a parent link scrolled here. */
  highlighted: boolean;
  /** The board's clock (ms), ticking once a second while visible. */
  now: number;
}

export function TaskCardView(props: TaskCardViewProps) {
  const colors = props.theme.colors;
  return (
    <Pressable onPress={() => props.onOpen?.(props.card.id)}>
      <View style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface0 }}>
        <Text style={{ color: colors.foreground, fontWeight: "600" }}>{props.card.title}</Text>
      </View>
    </Pressable>
  );
}

/** The details shown on hover (desktop popover) or long press (phone sheet): cwd, created, mode, tokens and cost. */
export function TaskDetails(props: { card: TaskCard; theme: PluginTheme; now: number; onOpen?(agentId: string): void }) {
  return <Text style={{ color: props.theme.colors.foregroundMuted }}>{props.card.location.cwd}</Text>;
}
