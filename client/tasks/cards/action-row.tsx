import React, { Children, Fragment, createContext, isValidElement, useCallback, useContext, useId, useLayoutEffect, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";

interface ActionSize {
  full: number;
  icon: number;
}

/** Drop whole labels from left to right; never truncate a word or shrink an icon. */
export function actionIconOnly(width: number, sizes: readonly ActionSize[], gap: number): boolean[] {
  let total = sizes.reduce((sum, size) => sum + size.full, 0) + Math.max(0, sizes.length - 1) * gap;
  return sizes.map((size) => {
    if (total <= width + 0.5 || size.full <= size.icon) return false;
    total -= size.full - size.icon;
    return true;
  });
}

type Entry = ActionSize & { id: string; index: number };
const ActionContext = createContext<{ index: number; folded: ReadonlySet<string>; register(entry: Entry): () => void } | null>(null);

function actions(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? actions(child.props.children) : [child],
  );
}

/** One measured row, shared by cards, the details header and the phone sheet. */
export function ActionRow(props: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const [width, setWidth] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const register = useCallback((entry: Entry) => {
    setEntries((current) => [...current.filter((item) => item.id !== entry.id), entry]);
    return () => setEntries((current) => current.filter((item) => item.id !== entry.id));
  }, []);
  const gap = props.gap ?? 8;
  const authored = StyleSheet.flatten(props.style);
  const padding = (authored?.paddingLeft ?? authored?.paddingHorizontal ?? authored?.padding ?? 0) as number;
  const endPadding = (authored?.paddingRight ?? authored?.paddingHorizontal ?? authored?.padding ?? 0) as number;
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  const modes = width === null ? [] : actionIconOnly(width, sorted, gap);
  const folded = new Set(sorted.filter((_, index) => modes[index]).map((item) => item.id));
  return (
    <View testID={props.testID} onLayout={(event) => setWidth(Math.max(0, event.nativeEvent.layout.width - padding - endPadding))} style={[{ flexDirection: "row", width: "100%", minWidth: 0, alignSelf: "stretch", gap }, props.style]}>
      {actions(props.children).map((child, index) => (
        <ActionContext.Provider key={index} value={{ index, folded, register }}>{child}</ActionContext.Provider>
      ))}
    </View>
  );
}

/** Measure the untruncated label once per text/typography change, retaining it while icon-only. */
export function useActionFit(label: string, typography: string, iconWidth: number, chromeWidth: number, square = false) {
  const context = useContext(ActionContext);
  const id = useId();
  const key = `${label}|${typography}`;
  const [measured, setMeasured] = useState<{ key: string; width: number } | null>(null);
  const labelWidth = measured?.key === key ? measured.width : null;
  const full = square ? iconWidth : labelWidth === null ? null : Math.max(iconWidth, labelWidth + chromeWidth);
  const register = context?.register;
  const index = context?.index ?? 0;
  useLayoutEffect(() => {
    if (register && full !== null) return register({ id, index, full, icon: iconWidth });
  }, [register, id, index, full, iconWidth]);
  const iconOnly = square || (full !== null && context?.folded.has(id) === true);
  const labelLayout = context ? (event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setMeasured((old) => old?.key === key && old.width === width ? old : { key, width });
  } : undefined;
  const style: ViewStyle | undefined = context ? iconOnly
    ? { width: iconWidth, minWidth: iconWidth, flexGrow: 0, flexShrink: 0, paddingHorizontal: 0 }
    : { minWidth: full ?? iconWidth, flexShrink: 0 } : undefined;
  return { iconOnly, labelLayout, style, labelStyle: context ? { flexShrink: 0 as const } : undefined };
}
