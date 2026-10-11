/**
 * Mounts an element with `react-test-renderer` (over `rn-mock.ts`) and counts
 * the native views it creates. A Text nested in a Text is a span of its
 * parent on iOS and Android (no view of its own), so it is not counted.
 */
import React from "react";
import "./quiet-renderer";
import TestRenderer, { act } from "react-test-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type JsonNode = TestRenderer.ReactTestRendererJSON;

export interface HostCount {
  views: number;
  /** Deepest chain of counted views. */
  depth: number;
  byType: Record<string, number>;
}

function walk(
  node: JsonNode | string | null,
  insideText: boolean,
  level: number,
  out: HostCount,
): void {
  if (node === null || typeof node === "string") return;
  const isText = node.type === "Text" || node.type === "Animated.Text";
  const counted = !(isText && insideText);
  const next = counted ? level + 1 : level;
  if (counted) {
    out.views += 1;
    out.byType[node.type] = (out.byType[node.type] ?? 0) + 1;
    if (next > out.depth) out.depth = next;
  }
  for (const child of node.children ?? []) walk(child, insideText || isText, next, out);
}

export function countHostViews(element: React.ReactElement, os = "ios"): HostCount {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  const json = renderer!.toJSON();
  const out: HostCount = { views: 0, depth: 0, byType: {} };
  for (const node of Array.isArray(json) ? json : [json]) walk(node, false, 0, out);
  act(() => renderer!.unmount());
  return out;
}
