import React, { memo, useCallback, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { withAlpha, type ExtendedThemeTokens } from "./theme-tokens";
import { projectIconRadius } from "../tasks/cards/project-icon";
import { faviconUrl, parseWebLink } from "../tools/web-link";
import { truncateMiddle } from "../paths/truncate-middle";
import { DISCLOSURE_HEADER, RowIcon, RowText } from "../ui/disclosure-header";
import { openLink } from "./open-link";
import { unselectable } from "./selection";

/** Hosts whose favicon failed or loaded this session: later rows skip the wait. */
const failedHosts = new Set<string>();
const loadedHosts = new Set<string>();

/**
 * A site's favicon, asked of the site itself. A globe stands in while it
 * loads and stays when the site has none; the favicon replaces it only once
 * drawn, so a transparent icon never shows the globe through it.
 */
export const Favicon = memo(function Favicon({ host, size, tokens }: {
  host: string; size: number; tokens: ExtendedThemeTokens;
}) {
  const [failed, setFailed] = useState(() => failedHosts.has(host));
  const [loaded, setLoaded] = useState(() => loadedHosts.has(host));
  const onError = useCallback(() => {
    failedHosts.add(host);
    setFailed(true);
  }, [host]);
  const onLoad = useCallback(() => {
    loadedHosts.add(host);
    setLoaded(true);
  }, [host]);
  const radius = projectIconRadius(size);
  const frame = { width: size, height: size };
  const globe = (
    <View testID="web-favicon-globe" accessible={false} style={[styles.tile, frame, !failed ? styles.under : null]}>
      <RowIcon name="Globe" size={size} color={tokens.foregroundMuted} />
    </View>
  );
  if (failed) return globe;
  return (
    <View accessible={false} style={frame}>
      {loaded ? null : globe}
      <Image testID="web-favicon-image" accessible={false} source={{ uri: faviconUrl(host) }} onError={onError} onLoad={onLoad}
        resizeMode="contain" style={{ width: size, height: size, borderRadius: radius, opacity: loaded ? 1 : 0 }} />
    </View>
  );
});

const STACK_MAX = 3;

/** Up to three sites a search drew from, as a row's meta lead. */
export const FaviconStack = memo(function FaviconStack({ hosts, tokens }: {
  hosts: readonly string[]; tokens: ExtendedThemeTokens;
}) {
  if (hosts.length === 0) return null;
  return (
    <View testID="web-favicon-stack" accessible={false} style={styles.stack}>
      {hosts.slice(0, STACK_MAX).map((host) => <Favicon key={host} host={host} size={14} tokens={tokens} />)}
    </View>
  );
});

/**
 * A row target for a web address: the domain, then the rest of the address
 * clipped in the middle, so the site and the page's end both show. The row's
 * icon slot carries the site's favicon.
 */
export function WebLinkTarget({ href, tokens, budget, fontSize, lineHeight }: {
  href: string; tokens: ExtendedThemeTokens; budget: number; fontSize: number; lineHeight: number;
}) {
  const link = parseWebLink(href);
  if (!link) return null;
  const pathBudget = Math.max(8, budget - link.host.length);
  return (
    <View testID="web-link-target" style={styles.target}>
      <RowText part="target" selectable={false} numberOfLines={1}
        style={[unselectable, styles.host, { fontFamily: tokens.fontUi, fontSize, lineHeight }]}>
        {link.host}
      </RowText>
      {link.path ? (
        <RowText part="meta" selectable={false} numberOfLines={1}
          style={[unselectable, styles.path, { fontFamily: tokens.fontMono, fontSize, lineHeight }]}>
          {truncateMiddle(link.path, pathBudget)}
        </RowText>
      ) : null}
    </View>
  );
}

/**
 * The row's own way out to the page: an up-right arrow that opens the address
 * in the system browser. It takes the press, so the row does not toggle.
 */
export function OpenLinkButton({ href, compact }: { href: string; compact: boolean }) {
  const link = parseWebLink(href);
  if (!link) return null;
  // A phone's finger needs 44pt; the arrow itself stays row-sized.
  const slop = compact ? 8 : 0;
  return (
    <Pressable testID="web-link-open" accessibilityRole="link" accessibilityLabel={`Open ${link.host} in browser`}
      onPress={(event) => { event.stopPropagation(); openLink(link.href); }}
      hitSlop={slop > 0 ? { top: slop, bottom: slop, left: slop, right: slop } : undefined}
      style={({ pressed }) => [styles.open, compact ? styles.openCompact : null, pressed ? { opacity: 0.5 } : null]}>
      <RowIcon name="ArrowUpRight" size={DISCLOSURE_HEADER.icon} />
    </Pressable>
  );
}

/**
 * One search result: favicon and title, then its domain and path, and the
 * same up-right arrow an address row ends with. The whole row opens it.
 */
export const WebResultRow = memo(function WebResultRow({ title, url, tokens, titleStyle, metaSize }: {
  title: string; url: string; tokens: ExtendedThemeTokens; titleStyle: object; metaSize: number;
}) {
  const link = parseWebLink(url);
  const onPress = useCallback(() => openLink(url), [url]);
  const shownTitle = title && title !== url ? title : link ? link.host : url;
  return (
    <Pressable testID="web-result-row" accessibilityRole="link" accessibilityLabel={`${shownTitle} ${link?.host ?? url}`}
      onPress={onPress} style={({ pressed }) => [styles.result, pressed && { backgroundColor: tokens.row.hover }]}>
      {link ? <View style={styles.resultIcon}><Favicon host={link.host} size={16} tokens={tokens} /></View> : null}
      <View style={styles.resultText}>
        <Text selectable={false} numberOfLines={1} style={[unselectable, titleStyle]}>{shownTitle}</Text>
        <Text selectable={false} numberOfLines={1} style={[unselectable, { fontSize: metaSize, lineHeight: Math.round(metaSize * 1.4) }]}>
          <Text style={{ fontFamily: tokens.fontUi, fontWeight: "500", color: withAlpha(tokens.foreground, 0.78) }}>{link?.host ?? url}</Text>
          {link?.path ? (
            <Text style={{ fontFamily: tokens.fontMono, fontSize: metaSize - 0.5, color: tokens.foregroundMuted }}>{link.path}</Text>
          ) : null}
        </Text>
      </View>
      <View testID="web-result-open" accessible={false} style={styles.resultArrow}>
        <RowIcon name="ArrowUpRight" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
  under: { position: "absolute", left: 0, top: 0 },
  stack: { flexDirection: "row", alignItems: "center", gap: 3, marginRight: 6 },
  target: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
  // The weight a result row gives its domain, so both read as one style.
  host: { flexShrink: 0, maxWidth: "60%", fontWeight: "500" },
  path: { flexShrink: 1, minWidth: 0 },
  open: { width: 24, height: 24, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  openCompact: { width: 28, height: 28 },
  result: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 6, borderRadius: 6 },
  resultIcon: { paddingTop: 2 },
  resultText: { flex: 1, minWidth: 0, gap: 1 },
  resultArrow: { alignSelf: "center", width: 28, alignItems: "center" },
});
