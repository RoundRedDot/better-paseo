import React, { useContext, useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useThemeTokens } from "../../components/theme-tokens";
import { createMessageTranslationBar } from "../../components/selection-actions";
import { toolbarLabel } from "../../i18n/toolbar-strings";
import { useEnhancerPreferences } from "../../preferences";
import { selectionViewLoading, useSelectionTranslation } from "../../translation/selection";
import { openTranslationSettings, TranslationSettingsParentCloseContext } from "../../translation/navigation";
import { useTranslationSettingsState } from "../../translation/settings-store";
import type { TranslationSourceKind } from "../../translation/store";
import { SelectionTranslationPanel, TranslationSheet, TRANSLATE_ICON } from "../../translation/ui";
import { iconHoverSize } from "../../ui/icon-hover-size";
import { useHover } from "../../ui/use-hover";
import { hoverFill } from "../hover-fill";
import { tipProps } from "./card-hints";
import { SpinnerRing } from "./status-icon";

type Props = {
  agentId: string;
  kind: TranslationSourceKind;
  text: string;
  streaming: boolean;
  theme: PluginTheme;
  testID: string;
  size?: number;
  onOpenChange?(open: boolean): void;
  base?: string;
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
  const { view, start } = useSelectionTranslation(props, text);
  const loading = text !== null && (!view || selectionViewLoading(view));
  useEffect(() => { start(); }, [start]);
  const anchor = useRef<View>(null);
  useEffect(() => () => props.onOpenChange?.(false), [props.onOpenChange]);
  const close = () => { setText(null); props.onOpenChange?.(false); };
  const { hovered, hoverProps } = useHover();
  const label = toolbarLabel("Translate", preferences.language);
  const iconSize = 14;
  const fillSize = iconHoverSize(iconSize);
  return <View ref={anchor} collapsable={false}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy: loading }}
      {...tipProps(label)} {...hoverProps} testID={props.testID} hitSlop={4}
      onPress={(event) => {
        event.stopPropagation();
        if (text !== null) return;
        setText(props.text);
        props.onOpenChange?.(true);
      }}
      style={{ width: props.size ?? 32, height: props.size ?? 32, alignItems: "center", justifyContent: "center" }}>
      {({ pressed }) => <View pointerEvents="none" testID={`${props.testID}-fill`} style={{ width: fillSize, height: fillSize, borderRadius: fillSize / 2, alignItems: "center", justifyContent: "center", backgroundColor: hoverFill(props.base ?? tokens.surface0, tokens.foreground, hovered, pressed, "transparent") }}>
        {loading ? <SpinnerRing size={iconSize} color={tokens.foregroundMuted} testID={`${props.testID}-spinner`} />
          : <Icon icon={TRANSLATE_ICON} size={iconSize} color={tokens.foregroundMuted} />}
      </View>}
    </Pressable>
    {view && !loading ? Platform.OS === "web"
      ? <WebMessageTranslation anchor={anchor} view={view} tokens={tokens} retry={start} close={close} />
      : <TranslationSheet close={close}><SelectionTranslationPanel view={view} tokens={tokens} onRetry={start} onClose={close} sheet /></TranslationSheet>
      : null}
  </View>;
}

function WebMessageTranslation(props: {
  anchor: React.RefObject<View | null>;
  view: NonNullable<ReturnType<typeof useSelectionTranslation>["view"]>;
  tokens: ReturnType<typeof useThemeTokens>;
  retry(): void;
  close(): void;
}) {
  const paseo = usePaseo();
  const closeParent = useContext(TranslationSettingsParentCloseContext);
  const current = useRef(props);
  current.current = props;
  const popup = useRef<ReturnType<typeof createMessageTranslationBar> | null>(null);
  useEffect(() => {
    const anchor = props.anchor.current as unknown as HTMLElement | null;
    if (!anchor || typeof document === "undefined") return;
    const bar = createMessageTranslationBar(anchor, current.current.tokens, {
      close: () => current.current.close(),
      retry: () => current.current.retry(),
      settings: () => {
        current.current.close();
        if (!closeParent) { openTranslationSettings(paseo); return; }
        closeParent();
        requestAnimationFrame(() => openTranslationSettings(paseo));
      },
    });
    popup.current = bar;
    bar.setView(current.current.view);
    return () => { popup.current = null; bar.dispose(); };
  }, [props.anchor, paseo, closeParent]);
  useEffect(() => { popup.current?.setView(props.view); }, [props.view]);
  useEffect(() => { popup.current?.setTheme(props.tokens); }, [props.tokens]);
  return null;
}
