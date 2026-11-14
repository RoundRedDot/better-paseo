import React from "react";
import { Platform, Pressable, View, type GestureResponderEvent } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { MarkdownView } from "../../components/markdown/markdown-view";
import { useThemeTokens } from "../../components/theme-tokens";
import { useEnhancerPreferences } from "../../preferences";
import { HoverPreviewContext } from "../../ui/hover-preview";
import { useHover } from "../../ui/use-hover";
import { hoverFill } from "../hover-fill";
import type { TasksLanguage } from "../i18n";
import { TaskText as Text, HOST_FONT as F, useTasksFontAdjustment } from "../typography";
import { cardStrings } from "./strings";
import type { TaskTokens } from "./tokens";

/**
 * "View plan" beside a plan request's title: the card shows only the plan's
 * title, and this opens the whole plan. A press stops at the button, so the
 * card under it is not chosen too.
 */
export function PlanViewButton(props: {
  tokens: TaskTokens;
  language: TasksLanguage;
  /** The title line's height: the button sits on its first line. */
  lineHeight: number;
  onPress(): void;
  unifiedHover?: boolean;
  testID?: string;
}) {
  const { hovered, hoverProps } = useHover();
  const label = cardStrings(props.language).viewPlan;
  const color = hovered ? props.tokens.foreground : props.tokens.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={Platform.OS === "web" ? 4 : 10}
      onHoverIn={hoverProps.onHoverIn}
      onHoverOut={hoverProps.onHoverOut}
      onPress={(event: GestureResponderEvent) => {
        event.stopPropagation();
        props.onPress();
      }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, minHeight: props.lineHeight, flexShrink: 0, borderRadius: 6, backgroundColor: props.unifiedHover ? hoverFill(props.tokens.card.background, props.tokens.foreground, hovered, pressed, "transparent") : "transparent" })}
      testID={props.testID}
    >
      <Icon name="FileText" size={13} color={color} />
      <Text numberOfLines={1} style={{ fontSize: F.sm, fontWeight: "500", color }}>{label}</Text>
    </Pressable>
  );
}

/**
 * The whole plan, drawn as Markdown in the host's dialog. The dialog is named
 * "Plan": the plan's own first heading, its title, opens the text.
 */
export function TaskPlanDialog(props: {
  text: string;
  theme: PluginTheme;
  language: TasksLanguage;
  touch?: boolean;
  onClose(): void;
}) {
  const preferences = useEnhancerPreferences();
  const prose = useThemeTokens(props.theme, preferences);
  const adjustment = useTasksFontAdjustment();
  const size = Math.round(prose.typography.content.size * adjustment);
  return (
    <Modal title={cardStrings(props.language).planRequest} open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <Modal.Content>
        <View testID="task-plan-dialog">
          <HoverPreviewContext.Provider value>
            <MarkdownView text={props.text} tokens={prose} variant={preferences.markdownVariant} compact={props.touch === true} size={size} />
          </HoverPreviewContext.Provider>
        </View>
      </Modal.Content>
    </Modal>
  );
}
