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
import { settingsTextStyle, type PageLook } from "../settings-controls";
import { SelectOption, SelectTrigger, selectMenuSurface } from "../settings-select";

/** The menu's chrome around its list: padding, border, search box and gap. */
const MENU_CHROME = 8 * 2 + 1 * 2 + 36 + 1 + 8;
const MENU_GAP = 6;
const MENU_EDGE = 8;
const LIST_MAX = 340;
const LIST_MIN = 96;

export interface LanguageMenuPlacement {
  /** Set when the menu opens below the control. */
  top?: number;
  /** Set when it opens above: measured from the window's bottom, so the menu grows up from the control. */
  bottom?: number;
  left: number;
  width: number;
  listMaxHeight: number;
}

/**
 * Where the web menu sits, in window coordinates: below the control when
 * there is room for a useful list, else on the roomier side, its list sized
 * to what that side holds.
 */
export function placeLanguageMenu(
  rect: { top: number; bottom: number; right: number; width: number },
  viewport: { width: number; height: number },
): LanguageMenuPlacement {
  const width = Math.min(Math.max(rect.width, 280), viewport.width - MENU_EDGE * 2);
  const left = Math.max(MENU_EDGE, Math.min(rect.right - width, viewport.width - width - MENU_EDGE));
  const roomBelow = viewport.height - rect.bottom - MENU_GAP - MENU_EDGE;
  const roomAbove = rect.top - MENU_GAP - MENU_EDGE;
  const below = roomBelow >= MENU_CHROME + 160 || roomBelow >= roomAbove;
  const listMaxHeight = Math.max(LIST_MIN, Math.min(LIST_MAX, (below ? roomBelow : roomAbove) - MENU_CHROME));
  return below
    ? { top: rect.bottom + MENU_GAP, left, width, listMaxHeight }
    : { bottom: viewport.height - rect.top + MENU_GAP, left, width, listMaxHeight };
}

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
      <View style={styles.searchBox}>
        <Icon name="Search" size={14} color={tokens.foregroundMuted} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onQueryChange}
          placeholder={searchPlaceholder}
          accessibilityLabel={searchPlaceholder}
          placeholderTextColor={tokens.foregroundSubtle ?? tokens.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.searchInput,
            settingsTextStyle(tokens, -1),
            { color: tokens.foreground, fontFamily: tokens.fontUi },
            Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
          ]}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => { onQueryChange(""); inputRef.current?.focus(); }}
            hitSlop={6}
            style={styles.clearButton}
          >
            <Icon name="X" size={13} color={tokens.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: tokens.v2.border }} />

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
            <SelectOption
              key={entry.code}
              look={look}
              name={formatTranslationLanguageLabel(entry, language)}
              trailing={entry.code === FOLLOW_INTERFACE_LANGUAGE_CODE ? "auto" : entry.code}
              selected={entry.code === value}
              onPress={() => onSelect(entry.code)}
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
  const { tokens } = look;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<View>(null);
  const menuRef = useRef<View>(null);
  const [placement, setPlacement] = useState<LanguageMenuPlacement | null>(null);

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
      const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
      const vh = typeof window !== "undefined" ? window.innerHeight : 768;
      const next = placeLanguageMenu(anchor.getBoundingClientRect(), { width: vw, height: vh });
      setPlacement((previous) =>
        previous && previous.top === next.top && previous.bottom === next.bottom &&
        previous.left === next.left && previous.width === next.width && previous.listMaxHeight === next.listMaxHeight
          ? previous : next);
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuEl?.contains(event.target)) return;
      updatePosition();
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
      // The settings page scrolls under the fixed menu: follow the control.
      window.addEventListener("scroll", onScroll, true);
    }

    return () => {
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("mousedown", onPointerDown, true);
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", onScroll, true);
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
      <SelectTrigger
        look={look}
        label={label}
        text={displayLabel}
        open={open}
        disabled={disabled}
        onPress={() => {
          if (disabled) return;
          if (open) close();
          else setOpen(true);
        }}
        style={styles.trigger}
      />

      {open && Platform.OS === "web" ? (
        <View
          ref={menuRef}
          style={[
            styles.popoverCard,
            selectMenuSurface(tokens),
            {
              // Reset the popover UA inset and centered margins.
              top: placement?.bottom !== undefined ? "auto" : (placement?.top ?? 36),
              bottom: placement?.bottom ?? "auto",
              left: placement?.left ?? 0,
              right: "auto",
              margin: 0,
              width: placement?.width ?? 300,
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
            maxListHeight={placement?.listMaxHeight ?? 300}
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
    minWidth: 0,
    maxWidth: 260,
  },
  // The language names run longer than the other selects' choices.
  trigger: { minWidth: 168 },
  popoverCard: {
    position: "fixed" as unknown as "absolute",
    zIndex: 1000,
    // Vertical only: the rows and the search box carry the same side inset as the choice menu's rows.
    paddingVertical: 8,
  },
  listRoot: {
    gap: 4,
  },
  searchBox: {
    marginHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    minHeight: 36,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
  },
  clearButton: {
    padding: 2,
  },
  optionsScroll: {
    gap: 2,
  },
  emptyState: {
    paddingVertical: 20,
    alignItems: "center",
  },
  emptyText: {},
});
