import React, { useEffect, useRef, useState } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useThemeTokens } from "../../components/theme-tokens";
import { toolbarLabel } from "../../i18n/toolbar-strings";
import { useEnhancerPreferences } from "../../preferences";
import { useSelectionTranslation } from "../../translation/selection";
import { useTranslationSettingsState } from "../../translation/settings-store";
import type { TranslationSourceKind } from "../../translation/store";
import { SelectionTranslationPanel, TranslationSheet, TRANSLATE_ICON } from "../../translation/ui";
import { AnchoredToolbarDetails } from "../../ui/toolbar-button";
import { HoverControl } from "../hover-control";
import { tipProps } from "./card-hints";

type Props = {
  agentId: string;
  kind: TranslationSourceKind;
  text: string;
  streaming: boolean;
  theme: PluginTheme;
  testID: string;
  size?: number;
};

/** One explicit whole-message translation, with the same controller as text selections. */
export function MessageTranslateButton(props: Props) {
  const settings = useTranslationSettingsState();
  if (settings.status === "ready" && !settings.values.enabled) return null;
  return <MessageTranslationButton key={JSON.stringify([props.agentId, props.kind])} {...props} />;
}

function MessageTranslationButton(props: Props) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(props.theme, preferences);
  const [text, setText] = useState<string | null>(null);
  const anchor = useRef<View>(null);
  const close = () => setText(null);
  const label = toolbarLabel("Translate", preferences.language);
  return <View ref={anchor} collapsable={false}>
    <HoverControl base={tokens.surface0} foreground={tokens.foreground} accessibilityRole="button" accessibilityLabel={label}
      {...tipProps(label)} testID={props.testID} hitSlop={4}
      onPress={(event) => { event.stopPropagation(); setText(props.text); }}
      style={{ width: props.size ?? 32, height: props.size ?? 32, alignItems: "center", justifyContent: "center", borderRadius: 16 }}>
      <Icon icon={TRANSLATE_ICON} size={14} color={tokens.foregroundMuted} />
    </HoverControl>
    {text !== null ? <MessageTranslationResult {...props} text={text} anchor={anchor} close={close} /> : null}
  </View>;
}

function MessageTranslationResult(props: Props & { anchor: React.RefObject<View | null>; close(): void }) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(props.theme, preferences);
  const { view, start } = useSelectionTranslation({ agentId: props.agentId, kind: props.kind, streaming: props.streaming }, props.text);
  const window = useWindowDimensions();
  useEffect(() => { start(); }, [start]);
  if (!view) return null;
  const panel = <SelectionTranslationPanel view={view} tokens={tokens} onRetry={start} onClose={props.close} sheet={Platform.OS !== "web"} />;
  const width = Math.min(420, window.width - 16);
  return Platform.OS === "web"
    ? <AnchoredToolbarDetails anchor={props.anchor} close={props.close} tokens={tokens} width={width}>{panel}</AnchoredToolbarDetails>
    : <TranslationSheet close={props.close}>{panel}</TranslationSheet>;
}
