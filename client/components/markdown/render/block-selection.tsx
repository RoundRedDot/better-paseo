import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { Token, Tokens } from "../../../vendor/marked";
import type { ExtendedThemeTokens } from "../../theme-tokens";
import { useCopy } from "../../../ui/use-copy";
import { useScrollDismiss } from "../../../ui/scroll-anchor";
import { FLOAT, floatPressed } from "../../../ui/tokens/float";
import { useEnhancerPreferences } from "../../../preferences";
import { toolbarLabel } from "../../../i18n/toolbar-strings";
import { inlineText } from "./inline";
import { localImagePath } from "./local-path";

const DOUBLE_TAP_MS = 300;
const TAP_MS = 250;
const MOVE_SLOP = 10;
interface Tap { time: number; x: number; y: number }

let active: { cancel(): void } | null = null;
/** A touch elsewhere in Markdown retires the previous block's selection. */
export function dismissBlockSelection(): void { active?.cancel(); }

export const BlockSelectionContext = createContext<{ selected: boolean; cancel(): void } | null>(null);

/** Interactive code, tables and images retain their dedicated gestures. */
export function selectableBlock(blocks: readonly Token[]): boolean {
  const allowed = (block: Token): boolean => {
    switch (block.type) {
      case "space": return true;
      case "paragraph": case "text": case "heading":
        return !(block.tokens ?? []).some((run) => run.type === "image" && localImagePath(run.href) !== null);
      case "list": return (block as Tokens.List).items.every((item) => item.tokens.every(allowed));
      case "blockquote": return (block as Tokens.Blockquote).tokens.every(allowed);
      case "html": case "math": return true;
      default: return false;
    }
  };
  return blocks.filter((block) => block.type !== "space").length === 1 && blocks.every(allowed);
}

/** Visible prose only: formatting delimiters, link targets and UI labels stay out. */
export function blockSelectionText(blocks: readonly Token[]): string {
  return blocks.map((block): string => {
    switch (block.type) {
      case "space": return "";
      case "paragraph": case "text": case "heading": return inlineText(block.tokens ?? [block]);
      case "blockquote": return blockSelectionText((block as Tokens.Blockquote).tokens);
      case "list": return (block as Tokens.List).items.map((item) => blockSelectionText(item.tokens)).join("\n");
      case "html": return block.raw.replace(/\n+$/, "");
      case "math": return String((block as Tokens.Generic).text ?? "");
      default: return "";
    }
  }).filter(Boolean).join("\n\n");
}

const point = ({ nativeEvent: event }: GestureResponderEvent): Tap => ({ time: event.timestamp, x: event.pageX, y: event.pageY });
const near = (a: Tap, b: Tap) => Math.hypot(a.x - b.x, a.y - b.y) <= MOVE_SLOP;

/** Observe short taps without taking the responder from native text or the scroller. */
export function BlockSelection({ source, blocks, tokens, children }: {
  source: string; blocks: readonly Token[]; tokens: ExtendedThemeTokens; children: React.ReactNode;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = chosen === source;
  const press = useRef<Tap | null>(null);
  const previous = useRef<Tap | null>(null);
  const dismiss = useCallback(() => { setChosen(null); }, []);
  const cancel = useCallback(() => {
    press.current = null;
    previous.current = null;
    dismiss();
    if (active?.cancel === cancel) active = null;
  }, [dismiss]);
  useEffect(() => { cancel(); return cancel; }, [source, cancel]);
  const context = useMemo(() => ({ selected, cancel }), [selected, cancel]);
  return <BlockSelectionContext.Provider value={context}>
    <View testID="markdown-block-selection" style={styles.block}
      onTouchStart={(event) => {
        // Do not let the Markdown root dismiss a selection a second time.
        event.stopPropagation();
        if (active?.cancel !== cancel) dismissBlockSelection();
        else dismiss();
        active = { cancel };
        press.current = null;
        if (event.nativeEvent.touches.length !== 1) { previous.current = null; return; }
        press.current = point(event);
      }}
      onTouchMove={(event) => {
        if (event.nativeEvent.touches.length !== 1 || (press.current && !near(press.current, point(event)))) cancel();
      }}
      onTouchCancel={cancel}
      onTouchEnd={(event) => {
        const start = press.current;
        press.current = null;
        if (!start) return;
        const end = point(event);
        if (end.time < start.time || end.time - start.time > TAP_MS || !near(start, end)) { previous.current = null; return; }
        const last = previous.current;
        if (last && end.time >= last.time && end.time - last.time <= DOUBLE_TAP_MS && near(last, end)) {
          previous.current = null;
          setChosen(source);
        } else previous.current = end;
      }}>
      {children}
      {selected ? <>
        <View pointerEvents="none" testID="markdown-block-highlight"
          style={[StyleSheet.absoluteFill, { backgroundColor: tokens.accentBg }]} />
        <BlockCopyMenu text={blockSelectionText(blocks)} tokens={tokens} dismiss={cancel} />
      </> : null}
    </View>
  </BlockSelectionContext.Provider>;
}

function BlockCopyMenu({ text, tokens, dismiss }: { text: string; tokens: ExtendedThemeTokens; dismiss(): void }) {
  // Only a selected block observes the list: idle blocks keep their streamed reuse.
  useScrollDismiss(true, dismiss);
  const { copy } = useCopy();
  const { language } = useEnhancerPreferences();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <View style={styles.slot} onTouchStart={(event) => event.stopPropagation()}>
    <Pressable accessibilityRole="button" accessibilityLabel="Copy selected block"
      style={({ pressed }) => [styles.menu, tokens.v2.elevation.overlay, {
        backgroundColor: pressed ? floatPressed(tokens) : tokens.surface0, borderColor: tokens.v2.border,
      }]}
      onPress={() => { void copy(text, { feedback: "toast" }).then((ok) => { if (ok && mounted.current) dismiss(); }); }}>
      <Icon name="Copy" size={FLOAT.iconSize} color={tokens.foregroundMuted} />
      <Text selectable={false} style={[styles.label, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
        {toolbarLabel("Copy selected", language)}
      </Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  block: { position: "relative" },
  slot: { position: "absolute", top: 0, right: 0, zIndex: 2 },
  menu: { minHeight: 40, borderWidth: 1, borderRadius: FLOAT.radius, paddingHorizontal: 12,
    flexDirection: "row", alignItems: "center", gap: FLOAT.iconText },
  label: { fontSize: 13, fontWeight: "500" },
});
