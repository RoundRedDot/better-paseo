import React, { useContext, useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useThemeTokens } from "../components/theme-tokens";
import { createMessageTranslationBar } from "../components/selection-actions";
import { useEnhancerPreferences } from "../preferences";
import { selectionViewLoading, useSelectionTranslation } from "./selection";
import { openTranslationSettings, TranslationSettingsParentCloseContext } from "./navigation";
import { useTranslationSettingsState } from "./settings-store";
import type { TranslationSourceKind } from "./store";
import { holdReplyTranslation } from "./reply-pending";
import { SelectionTranslationPanel, TranslationSheet, TRANSLATE_ICON } from "./ui";
import { ToolbarItem } from "../ui/toolbar-button";
import { radiusV2 } from "../components/theme-tokens";
import { SpinnerRing } from "../tasks/cards/status-icon";

type Props = {
  agentId: string;
  kind: TranslationSourceKind;
  text: string;
  streaming: boolean;
  theme: PluginTheme;
  testID: string;
  size?: number;
  /** `replyTranslationKey` of the reply this translates: its text dims while the translation runs. */
  replyKey?: string;
  onOpenChange?(open: boolean): void;
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
  const { view, start } = useSelectionTranslation(props, text, true);
  const loading = text !== null && (!view || selectionViewLoading(view));
  // Once shown, the translation stays open through Retry; closing ends it.
  const [opened, setOpened] = useState(false);
  const shown = text !== null && view !== null && (opened || !loading);
  if (shown && !opened) setOpened(true);
  useEffect(() => { start(); }, [start]);
  const replyKey = props.replyKey;
  useEffect(() => replyKey && loading ? holdReplyTranslation(replyKey) : undefined, [replyKey, loading]);
  const anchor = useRef<View>(null);
  useEffect(() => () => props.onOpenChange?.(false), [props.onOpenChange]);
  const close = () => { setText(null); setOpened(false); props.onOpenChange?.(false); };
  const size = props.size ?? 32;
  // The toolbar's own item, so it names itself on hover like Copy and the metadata beside it.
  return <View ref={anchor} collapsable={false} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
    <ToolbarItem testID={props.testID} label="Translate" tokens={tokens} align="start"
      buttonStyle={{ width: 24, height: 24, borderRadius: radiusV2.block }}
      onPress={(event) => {
        event.stopPropagation();
        if (text !== null) return;
        setText(props.text);
        props.onOpenChange?.(true);
      }}>
      <View pointerEvents="none" testID={`${props.testID}-fill`}>
        {loading ? <SpinnerRing size={14} color={tokens.foregroundMuted} testID={`${props.testID}-spinner`} />
          : <Icon icon={TRANSLATE_ICON} size={14} color={tokens.foregroundMuted} />}
      </View>
    </ToolbarItem>
    {shown && view ? Platform.OS === "web"
      ? <WebMessageTranslation original={text!} anchor={anchor} view={view} tokens={tokens} retry={start} close={close} />
      : <TranslationSheet close={close}><SelectionTranslationPanel original={text!} view={view} tokens={tokens} onRetry={start} onClose={close} sheet /></TranslationSheet>
      : null}
  </View>;
}

function WebMessageTranslation(props: {
  original: string;
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
    }, current.current.original);
    popup.current = bar;
    bar.setView(current.current.view);
    return () => { popup.current = null; bar.dispose(); };
  }, [props.anchor, paseo, closeParent]);
  useEffect(() => { popup.current?.setView(props.view); }, [props.view]);
  useEffect(() => { popup.current?.setTheme(props.tokens); }, [props.tokens]);
  return null;
}
