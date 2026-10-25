import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: Record<string, unknown>) => React.createElement("HostIcon", props),
  copyText: vi.fn(async () => {}),
  useToast: () => ({ show: vi.fn(), error: vi.fn() }),
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));

import { renderMarkIcon } from "../../client/components/mark-icon";
import { BrandMark, Glyph } from "../../client/components/glyph";
import { ProviderLogo } from "../../client/components/provider-logo";
import { seedMarkBitmaps } from "../../client/components/marks";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { RowIcon, RowPaletteContext } from "../../client/ui/disclosure-header";
import { DetailsHeader } from "../../client/details/chrome/details-header";
import type { DetailsShellValue } from "../../client/details/contracts";
import { StyleSheet } from "./helpers/rn-mock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
let renderer: ReturnType<typeof create> | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  delete (globalThis as { __beautifulChatMarkBitmaps?: unknown }).__beautifulChatMarkBitmaps;
});
function mount(element: React.ReactElement) {
  act(() => { renderer = create(element); });
  return renderer!.root;
}
const hosts = (root: ReactTestInstance, type: string) => root.findAll((node) => (node.type as unknown) === type);
const uri = "data:image/png;base64,AAAA";
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

describe("prefixed mark routing", () => {
  it("normalizes the brand id and forwards size and its chosen tint", () => {
    const mark = renderMarkIcon({ name: "brand:GitHub", size: 19, brandColor: "#123456", providerColor: "#abcdef" });
    expect(mark?.type).toBe(BrandMark);
    expect(mark?.props).toEqual({ id: "brand:github", size: 19, color: "#123456" });
    seedMarkBitmaps({ "brand:github": uri });
    const root = mount(mark!);
    // A loaded row mark remains a single native Image, without a Glyph box.
    expect(hosts(root, "View")).toHaveLength(0);
    expect(hosts(root, "Image")).toHaveLength(1);
    expect(hosts(root, "Image")[0]!.props).toMatchObject({
      source: { uri }, style: { width: 19, height: 19, tintColor: "#123456" }, accessibilityLabel: "brand:github",
    });
  });

  it.each([undefined, "#abcdef"])("strips the provider prefix and preserves provider tint %s", (providerColor) => {
    const mark = renderMarkIcon({ name: "provider:Claude", size: 18, brandColor: "#123456", providerColor });
    expect(mark?.type).toBe(ProviderLogo);
    expect(mark?.props).toEqual({ provider: "Claude", size: 18, color: providerColor });
  });

  it.each(["Plug", "GitHub", "devicon:python", "Brand:github", "Provider:codex"])("leaves %s to the caller", (name) => {
    expect(renderMarkIcon({ name, size: 14, brandColor: "#123456" })).toBeNull();
  });
});

describe("row tint ownership", () => {
  it("keeps the currentColor brand substitute and provider default distinct", () => {
    const root = mount(h(React.Fragment, null, h(RowIcon, { name: "brand:GitHub" }), h(RowIcon, { name: "provider:codex" })));
    expect(root.findByType(BrandMark).props).toEqual({ id: "brand:github", size: 14, color: "#94a3b8" });
    expect(root.findByType(ProviderLogo).props).toEqual({ provider: "codex", size: 14, color: undefined });
  });

  it.each([undefined, "#f00"])("uses the row palette unless explicitly overridden (%s)", (color) => {
    const palette = { icon: "#345", target: "#456", meta: "#567", diffAdd: "#678", diffDel: "#789" };
    const root = mount(h(RowPaletteContext.Provider, { value: palette },
      h(React.Fragment, null, h(RowIcon, { name: "brand:npm", size: 20, color }), h(RowIcon, { name: "provider:codex", size: 20, color }))));
    expect(root.findByType(BrandMark).props).toMatchObject({ size: 20, color: color ?? palette.icon });
    expect(root.findByType(ProviderLogo).props).toMatchObject({ size: 20, color: color ?? palette.icon });
  });

  it("keeps ordinary row icons bare and on the host SDK", () => {
    const root = mount(h(RowIcon, { name: "Plug", size: 17 }));
    expect(hosts(root, "HostIcon")[0]!.props).toEqual({ name: "Plug", size: 17, color: "currentColor" });
    expect(root.findAllByType(Glyph)).toHaveLength(0);
    expect(hosts(root, "View")).toHaveLength(0);
  });
});

describe("details tile routing", () => {
  function tile(name: string) {
    const shell: DetailsShellValue = {
      agentId: "agent", form: "drawer", detent: "fit", fullscreen: false, pointer: false,
      index: 0, count: 0, canStep: { previous: false, next: false },
      step() {}, close() {}, toggleFullscreen() {},
      entry: { id: "block", agentId: "agent", at: 1, kind: "tool", seq: 1, mounted: true,
        navigable: true, hasBody: true, title: "Tool", titleMono: false, subtitle: [],
        icon: name, iconColor: "#d00", readsImage: false, render: () => null, copies: () => [] },
    };
    return mount(h(DetailsHeader, { shell, tokens })).findByProps({ testID: "details-header-icon" });
  }

  it.each(["brand:npm", "provider:codex"])("retains the concrete tint, size and native tree for %s", (name) => {
    seedMarkBitmaps({ "brand:npm": uri, "lobe:codex": uri });
    const root = tile(name);
    const image = hosts(root, "Image")[0]!;
    expect(StyleSheet.flatten(image.props.style)).toEqual({ width: 16, height: 16, tintColor: "#d00" });
    expect(image.props.accessibilityLabel).toBe(name === "brand:npm" ? "brand:npm" : "Codex");
    // Existing tile, plus ProviderLogo's existing row only for a provider.
    expect(hosts(root, "View")).toHaveLength(name === "brand:npm" ? 1 : 2);
    expect(root.findAllByType(Glyph)).toHaveLength(0);
  });

  it("keeps an ordinary tile icon inside Glyph's existing box", () => {
    const root = tile("Plug");
    expect(root.findByType(Glyph).props).toEqual({ name: "Plug", size: 16, color: "#d00" });
    expect(hosts(root, "View")).toHaveLength(2);
    expect(hosts(root, "HostIcon")[0]!.props).toEqual({ name: "Plug", size: 16, color: "#d00" });
  });
});
