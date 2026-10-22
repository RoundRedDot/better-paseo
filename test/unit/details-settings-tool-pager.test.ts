import React from "react";
import { describe, expect, it, vi } from "vitest";

const paging = vi.hoisted(() => ({ bind: vi.fn(() => () => {}) }));

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const React = await import("react");
  return {
    ...rn,
    View: React.forwardRef((props: Record<string, unknown>, ref: React.ForwardedRef<unknown>) =>
      React.createElement("View", { ...props, ref })),
  };
});
vi.mock("../../client/ui/hover-preview", () => ({ usePreviewPanel: () => ({ maximized: true }) }));
vi.mock("../../client/ui/toolbar-button", () => ({ ToolbarButton: () => null }));
vi.mock("../../client/components/selection", () => ({ unselectable: {} }));
vi.mock("../../client/web", () => ({ bindPreviewPaging: paging.bind }));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { ToolPager } = await import("../../client/ui/tool-pager");
const { getEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("details setting and legacy preview paging", () => {
  it("uses arrows with details off and brackets with details on", () => {
    const previous = getEnhancerPreferences().blockDetails;
    try {
      for (const [blockDetails, keys] of [[false, "arrows"], [true, "brackets"]] as const) {
        updateEnhancerPreferences({ blockDetails });
        paging.bind.mockClear();
        let renderer!: ReturnType<typeof TestRenderer.create>;
        act(() => {
          renderer = TestRenderer.create(React.createElement(ToolPager, {
            index: 0, count: 2, onChange() {}, tokens: {
              foregroundMuted: "#666", fontUi: "system", typography: { block: { caption: { size: 12 } } },
            } as never,
          }));
        });
        expect(paging.bind).toHaveBeenCalledWith(null, expect.any(Function), keys);
        act(() => renderer.unmount());
      }
    } finally {
      updateEnhancerPreferences({ blockDetails: previous });
    }
  });
});
