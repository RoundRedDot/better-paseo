import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { PREVIEW_MIN, type PreviewBox } from "../../client/ui/preview-frame";
import { edgeResponder, toolbarResponder } from "../../client/ui/preview-drag";

function session(box: PreviewBox) {
  const committed: PreviewBox[] = [];
  const drag = {
    box: () => box,
    bounds: () => ({ width: 390, height: 700 }),
    margin: 8,
    min: PREVIEW_MIN,
    commit: (next: PreviewBox) => {
      box = next;
      committed.push(next);
    },
  };
  return { drag, committed, get box() { return box; } };
}

const at = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y } });

describe("phone preview drags", () => {
  it("lets a tap through and moves from where the finger first touched", () => {
    const { drag, committed } = session({ x: 8, y: 190, width: 300, height: 280 });
    const props = toolbarResponder(drag);
    expect(props.onStartShouldSetResponderCapture(at(40, 200))).toBe(false);
    expect(props.onMoveShouldSetResponderCapture(at(42, 201))).toBe(false);
    expect(props.onMoveShouldSetResponderCapture(at(50, 210))).toBe(true);
    props.onResponderGrant(at(50, 210));
    expect(committed.at(-1)).toEqual({ x: 18, y: 200, width: 300, height: 280 });
    props.onResponderMove(at(80, 230));
    expect(committed.at(-1)).toEqual({ x: 48, y: 220, width: 300, height: 280 });
  });

  it("ignores a tap on an edge and resizes once the finger moves", () => {
    const { drag, committed } = session({ x: 8, y: 190, width: 300, height: 280 });
    const props = edgeResponder("e", drag);
    props.onResponderGrant(at(300, 200));
    props.onResponderMove(at(302, 200));
    expect(committed).toHaveLength(0);
    props.onResponderMove(at(340, 200));
    expect(committed.at(-1)).toEqual({ x: 8, y: 190, width: 340, height: 280 });
  });

  it("keeps the right edge put when the west edge is dragged", () => {
    const { drag, committed } = session({ x: 40, y: 190, width: 300, height: 280 });
    const props = edgeResponder("w", drag);
    props.onResponderGrant(at(40, 200));
    props.onResponderMove(at(80, 200));
    expect(committed.at(-1)).toEqual({ x: 80, y: 190, width: 260, height: 280 });
  });
});
