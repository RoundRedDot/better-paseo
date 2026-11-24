import React from "react";
import { describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
// The host's Lucide icon, as a box of its size so the layout tests measure it.
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const ReactModule = await import("react");
  return { Icon: (props: { size: number }) => ReactModule.createElement("View", { style: { width: props.size, height: props.size } }) };
});
import { seedMarkBitmaps } from "../../client/components/marks";
import { FileOpenChoices } from "../../client/settings-file-open";
import type { PageLook } from "../../client/settings-controls";
import type { FileOpenApp } from "../../shared/preferences-settings";
import { measureHostTree } from "./helpers/yoga-host-layout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const look = {
  compact: true,
  tokens: {
    accent: "#22c55e",
    foreground: "#fff",
    foregroundMuted: "#aaa",
    fontUi: "System",
    typography: { ui: { size: 16 } },
    v2: { border: "#333", surface0: "#111", surface2: "#222" },
  },
} as PageLook;

const logos: Record<string, string> = {
  "editor:system": "data:image/png;base64,system",
  "editor:cursor": "data:image/png;base64,cursor",
  "editor:vscode": "data:image/png;base64,vscode",
  "editor:zed": "data:image/png;base64,zed",
  "editor:sublime": "data:image/png;base64,sublime",
};

const installed: FileOpenApp[] = ["system", "cursor", "vscode", "zed", "sublime"];

function render(value: FileOpenApp = "system", compact = true, available: readonly FileOpenApp[] | null = installed) {
  seedMarkBitmaps(logos);
  const onChange = vi.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(FileOpenChoices, {
      label: "Open files with",
      systemLabel: "System app",
      value,
      available,
      onChange,
      look: { ...look, compact },
    }));
  });
  return { renderer, onChange };
}

function button(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === "Open files with");
}

function radios(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio");
}

function open(renderer: TestRenderer.ReactTestRenderer) {
  act(() => button(renderer).props.onPress());
}

describe("file open choices", () => {
  it("keeps the menu closed until the button is pressed", () => {
    const { renderer } = render("zed");
    const closed = button(renderer);
    expect(closed.props.accessibilityState.expanded).toBe(false);
    expect(closed.props.accessibilityValue.text).toBe("Zed");
    expect(closed.findByType("Image" as React.ElementType).props.source.uri).toBe(logos["editor:zed"]);
    expect(radios(renderer)).toEqual([]);
    open(renderer);
    const group = renderer.root.find((node) => node.props.accessibilityRole === "radiogroup");
    expect(group.props.accessibilityLabel).toBe("Open files with");
    const choices = radios(renderer);
    expect(choices.map((node) => node.props.accessibilityLabel)).toEqual(["System app", "Cursor", "VS Code", "Zed", "Sublime Text"]);
    expect(choices.map((node) => node.props.accessibilityState.checked)).toEqual([false, false, false, true, false]);
    expect(choices.map((node) => node.findByType("Image" as React.ElementType).props.source.uri)).toEqual([
      logos["editor:system"],
      logos["editor:cursor"],
      logos["editor:vscode"],
      logos["editor:zed"],
      logos["editor:sublime"],
    ]);
    act(() => renderer.unmount());
  });

  it("lists only the editors this host can launch", () => {
    const { renderer } = render("system", true, ["system", "vscode", "webstorm"]);
    open(renderer);
    expect(radios(renderer).map((node) => node.props.accessibilityLabel)).toEqual(["System app", "VS Code", "WebStorm"]);
    act(() => renderer.unmount());
  });

  it("offers the saved editor and System app while the scan has not returned", () => {
    const { renderer } = render("sublime", true, null);
    open(renderer);
    expect(radios(renderer).map((node) => node.props.accessibilityLabel)).toEqual(["System app", "Sublime Text"]);
    act(() => renderer.unmount());
  });

  it("chooses an editor and closes the menu", () => {
    const { renderer, onChange } = render("zed");
    open(renderer);
    act(() => radios(renderer)[0]!.props.onPress());
    expect(onChange).toHaveBeenCalledWith("system");
    expect(radios(renderer)).toEqual([]);
    expect(button(renderer).props.accessibilityValue.text).toBe("Zed");
    act(() => renderer.unmount());
  });

  it.each([320, 390])("sizes the closed control inside a %i-point phone row", (width) => {
    const { renderer } = render("system", true);
    const control = button(renderer);
    const frames = measureHostTree(control, { width });
    const box = frames.get(control)!;
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeLessThan(width);
    const name = control.findByType("Text" as React.ElementType);
    const nameFrame = frames.get(name)!;
    expect(nameFrame.left).toBeGreaterThanOrEqual(box.left);
    expect(nameFrame.left + nameFrame.width).toBeLessThanOrEqual(box.left + box.width + 0.5);
    act(() => renderer.unmount());
  });

  it("does not stretch into a full-width desktop bar", () => {
    const { renderer } = render("cursor", false);
    const control = button(renderer);
    const frames = measureHostTree(control, { width: 800 });
    const box = frames.get(control)!;
    expect(box.height).toBeGreaterThanOrEqual(36);
    expect(box.height).toBeLessThan(44);
    expect(box.width).toBeLessThan(400);
    act(() => renderer.unmount());
  });
});
