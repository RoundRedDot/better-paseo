import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import {
  filterTranslationLanguages,
  findTranslationLanguage,
  FOLLOW_INTERFACE_LANGUAGE_CODE,
  formatTranslationLanguageLabel,
  TRANSLATION_LANGUAGES,
  type TranslationLanguageEntry,
} from "../../shared/translation-languages";
import { radiusV2, space } from "../components/theme-tokens";
import { settingsTextStyle, type PageLook } from "../settings-controls";

export interface SearchableLanguageSelectProps {
  value: string;
  onChange: (code: string) => void;
  language: "en" | "zh";
  look: PageLook;
  disabled?: boolean;
  label: string;
  searchPlaceholder: string;
  emptyLabel: string;
}

function LanguageOptionRow({
  entry,
  active,
  language,
  look,
  onSelect,
}: {
  entry: TranslationLanguageEntry;
  active: boolean;
  language: "en" | "zh";
  look: PageLook;
  onSelect: (code: string) => void;
}) {
  const { tokens } = look;
  const [hovered, setHovered] = useState(false);
  const title = formatTranslationLanguageLabel(entry, language);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => onSelect(entry.code)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.optionRow,
        (hovered || pressed || active) && { backgroundColor: tokens.v2.surface2 },
      ]}
    >
      <View style={styles.optionTextWrap}>
        <Text
          numberOfLines={1}
          style={[
            styles.optionTitle,
            settingsTextStyle(tokens, -1),
            {
              color: active ? tokens.accent : tokens.foreground,
              fontFamily: tokens.fontUi,
              fontWeight: active ? "500" : "400",
            },
          ]}
        >
          {title}
        </Text>
      </View>
      <View style={styles.optionRight}>
        <Text
          numberOfLines={1}
          style={[
            styles.optionCode,
            {
              color: active ? tokens.accent : tokens.foregroundMuted,
              fontFamily: tokens.fontMono,
            },
          ]}
        >
          {entry.code === FOLLOW_INTERFACE_LANGUAGE_CODE ? "auto" : entry.code}
        </Text>
        <View style={styles.checkSlot}>
          {active ? <Icon name="Check" size={14} color={tokens.accent} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function LanguageOptionList({
  value,
  query,
  onQueryChange,
  onSelect,
  language,
  look,
  searchPlaceholder,
  emptyLabel,
  maxListHeight,
}: {
  value: string;
  query: string;
  onQueryChange: (next: string) => void;
  onSelect: (code: string) => void;
  language: "en" | "zh";
  look: PageLook;
  searchPlaceholder: string;
  emptyLabel: string;
  maxListHeight?: number;
}) {
  const { tokens } = look;
  const inputRef = useRef<TextInput>(null);
  const items = useMemo(() => filterTranslationLanguages(query), [query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        inputRef.current?.focus?.();
      } catch {
        // Ignore in headless test environments.
      }
    }, 10);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.listRoot}>
      <View
        style={[
          styles.searchBox,
          {
            borderColor: tokens.v2.border,
            backgroundColor: tokens.v2.surface0,
          },
        ]}
      >
        <Icon name="Search" size={14} color={tokens.foregroundMuted} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onQueryChange}
          placeholder={searchPlaceholder}
          placeholderTextColor={tokens.foregroundSubtle ?? tokens.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.searchInput,
            settingsTextStyle(tokens, -1),
            { color: tokens.foreground, fontFamily: tokens.fontUi },
          ]}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => onQueryChange("")}
            hitSlop={6}
            style={styles.clearButton}
          >
            <Icon name="X" size={13} color={tokens.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Text
            style={[
              styles.emptyText,
              settingsTextStyle(tokens, -1),
              { color: tokens.foregroundMuted, fontFamily: tokens.fontUi },
            ]}
          >
            {emptyLabel}
          </Text>
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={maxListHeight ? { maxHeight: maxListHeight } : undefined}
          contentContainerStyle={styles.optionsScroll}
        >
          {items.map((entry: TranslationLanguageEntry) => (
            <LanguageOptionRow
              key={entry.code}
              entry={entry}
              active={entry.code === value}
              language={language}
              look={look}
              onSelect={onSelect}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export function SearchableLanguageSelect({
  value,
  onChange,
  language,
  look,
  disabled = false,
  label,
  searchPlaceholder,
  emptyLabel,
}: SearchableLanguageSelectProps) {
  const { tokens, compact } = look;
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<View>(null);
  const menuRef = useRef<View>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const selected =
    findTranslationLanguage(value) ??
    TRANSLATION_LANGUAGES[0]!;
  const displayLabel = formatTranslationLanguageLabel(selected, language);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const selectCode = useCallback((code: string) => {
    onChange(code);
    close();
  }, [onChange, close]);

  useLayoutEffect(() => {
    if (!open || Platform.OS !== "web") {
      setPlacement(null);
      return;
    }
    const anchor = triggerRef.current as unknown as HTMLElement | null;
    const menuEl = menuRef.current as unknown as (HTMLElement & {
      showPopover?: () => void;
      hidePopover?: () => void;
    }) | null;
    if (menuEl && typeof menuEl.setAttribute === "function") {
      menuEl.setAttribute("popover", "manual");
      try {
        menuEl.showPopover?.();
      } catch {
        // Ignore if popover API is unavailable in test DOM.
      }
    }

    const updatePosition = () => {
      if (!anchor || typeof anchor.getBoundingClientRect !== "function") return;
      const rect = anchor.getBoundingClientRect();
      const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
      const vh = typeof window !== "undefined" ? window.innerHeight : 768;
      const desiredWidth = Math.max(rect.width, 280);
      const width = Math.min(desiredWidth, vw - 16);
      const left = Math.max(8, Math.min(rect.right - width, vw - width - 8));
      const spaceBelow = vh - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
      const maxHeight = Math.max(160, Math.min(340, (openBelow ? spaceBelow : spaceAbove) - 8));
      const top = openBelow ? rect.bottom + 6 : Math.max(8, rect.top - maxHeight - 48);
      setPlacement({ top, left, width, maxHeight });
    };

    updatePosition();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (anchor?.contains(target)) return;
      if (menuEl?.contains(target)) return;
      close();
    };
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("mousedown", onPointerDown, true);
      window.addEventListener("resize", updatePosition);
    }

    return () => {
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("mousedown", onPointerDown, true);
        window.removeEventListener("resize", updatePosition);
      }
      try {
        menuEl?.hidePopover?.();
      } catch {
        // Ignore
      }
    };
  }, [open, close]);

  return (
    <View ref={triggerRef} style={styles.anchorWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => {
          if (disabled) return;
          if (open) close();
          else setOpen(true);
        }}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={({ pressed }) => [
          styles.trigger,
          compact ? styles.triggerCompact : null,
          {
            borderColor: open ? tokens.accent : tokens.v2.border,
            backgroundColor: hovered || pressed ? tokens.v2.surface2 : tokens.v2.surface0,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.triggerText,
            settingsTextStyle(tokens, -1),
            { color: tokens.foreground, fontFamily: tokens.fontUi },
          ]}
        >
          {displayLabel}
        </Text>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} color={tokens.foregroundMuted} />
      </Pressable>

      {open && Platform.OS === "web" ? (
        <View
          ref={menuRef}
          style={[
            styles.popoverCard,
            {
              backgroundColor: tokens.v2.surface0,
              borderColor: tokens.v2.border,
              top: placement?.top ?? 36,
              left: placement?.left ?? 0,
              width: placement?.width ?? 300,
              boxShadow: tokens.isDark ? "0px 8px 32px rgba(0,0,0,0.5)" : "0px 8px 32px rgba(0,0,0,0.12)",
            } as never,
          ]}
        >
          <LanguageOptionList
            value={value}
            query={query}
            onQueryChange={setQuery}
            onSelect={selectCode}
            language={language}
            look={look}
            searchPlaceholder={searchPlaceholder}
            emptyLabel={emptyLabel}
            maxListHeight={placement?.maxHeight ?? 300}
          />
        </View>
      ) : null}

      {open && Platform.OS !== "web" ? (
        <Modal title={label} open={open} onOpenChange={(next) => { if (!next) close(); }}>
          <Modal.Content scrollable={false}>
            <LanguageOptionList
              value={value}
              query={query}
              onQueryChange={setQuery}
              onSelect={selectCode}
              language={language}
              look={look}
              searchPlaceholder={searchPlaceholder}
              emptyLabel={emptyLabel}
              maxListHeight={420}
            />
          </Modal.Content>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  anchorWrap: {
    position: "relative",
    flexShrink: 1,
    maxWidth: 260,
  },
  trigger: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    minHeight: 36,
    minWidth: 168,
    maxWidth: 260,
    paddingHorizontal: space.md,
    borderRadius: radiusV2.block,
    borderWidth: 1,
  },
  triggerCompact: {
    minHeight: 44,
  },
  triggerText: {
    fontWeight: "500",
    flexShrink: 1,
  },
  popoverCard: {
    position: "fixed" as unknown as "absolute",
    zIndex: 1000,
    borderWidth: 1,
    borderRadius: radiusV2.overlay,
    padding: 8,
  },
  listRoot: {
    gap: 8,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radiusV2.block,
    paddingHorizontal: 8,
    minHeight: 34,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 6,
  },
  clearButton: {
    padding: 2,
  },
  optionsScroll: {
    gap: 2,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: radiusV2.block,
  },
  optionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {},
  optionRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  optionCode: {
    fontSize: 11,
    lineHeight: 14,
  },
  checkSlot: {
    width: 14,
    alignItems: "center",
  },
  emptyState: {
    paddingVertical: 20,
    alignItems: "center",
  },
  emptyText: {},
});
