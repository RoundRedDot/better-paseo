import React from "react";
import { describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: (props: object) => React.createElement("Icon", props) }));
vi.mock("../../client/ui/fade-in", () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => children }));

const { NoticeCallout } = await import("../../client/components/notice-callout");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", foreground: "#111", foregroundMuted: "#777", accent: "#00f", accentForeground: "#fff", statusDanger: "#f00", border: "#ccc" } as Parameters<typeof buildThemeTokens>[0]);

describe("background job notice", () => {
  it.each([false, true])("separates the job and expands the complete message (compact %s)", (compact) => {
    const message = "Background job bg_1 (which pinky; echo ok) has completed.";
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<NoticeCallout data={{ id: "n", level: "info", message }} tokens={tokens} compact={compact} />); });
    const button = renderer.root.findByProps({ accessibilityRole: "button" });
    expect(button.props["aria-expanded"]).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain("bg_1");
    expect(JSON.stringify(renderer.toJSON())).toContain("Background job");
    act(() => { button.props.onPress(); });
    expect(button.props["aria-expanded"]).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain(message);
    act(() => { button.props.onPress(); });
    expect(button.props["aria-expanded"]).toBe(false);
    act(() => { renderer.unmount(); });
  });

  it("keeps ordinary and unstructured job notices intact", () => {
    for (const message of ["A normal notification", "Background job bg_4 has completed."]) {
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => { renderer = TestRenderer.create(<NoticeCallout data={{ id: "n", level: "info", message }} tokens={tokens} />); });
      expect(JSON.stringify(renderer.toJSON())).toContain(message);
      expect(renderer.root.findAllByProps({ name: "ChevronRight" })).toHaveLength(0);
      act(() => { renderer.unmount(); });
    }
  });
});
