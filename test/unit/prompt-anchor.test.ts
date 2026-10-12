/**
 * The chat outline finds a prompt by `data-message-id`, and the id it looks
 * for is the prompt's `clientMessageId` or its `messageId` depending on where
 * the prompt came from. Each distinct id gets one marker.
 */
import { expect, it } from "vitest";
import { promptAnchorIds, promptAnchorMarker } from "../../client/components/prompt-anchor";
import { userMessagePropsEqual } from "../../client/state/render-equality";

it("marks both ids a prompt can be found by, once each", () => {
  expect(promptAnchorIds("m1", "c1")).toEqual(["m1", "c1"]);
  expect(promptAnchorIds("m1", "m1")).toEqual(["m1"]);
  expect(promptAnchorIds(undefined, "c1")).toEqual(["c1"]);
  expect(promptAnchorIds("m1", undefined)).toEqual(["m1"]);
  // An optimistic echo with neither id has nothing the outline could ask for.
  expect(promptAnchorIds(undefined, undefined)).toEqual([]);
  expect(promptAnchorIds("", "")).toEqual([]);
});

it("stamps the host's message id attribute on an empty marker outside the layout", () => {
  const props = promptAnchorMarker("m1") as unknown as {
    dataSet: Record<string, string>;
    style: Record<string, unknown>;
    pointerEvents: string;
  };
  // react-native-web writes `dataSet.messageId` as `data-message-id`.
  expect(props.dataSet).toEqual({ messageId: "m1" });
  // Not `data-history-row-id`: Paseo 0.11 reads every element carrying it as
  // a transcript row when it keeps the reading position.
  expect(props.dataSet).not.toHaveProperty("historyRowId");
  expect(props.style).toMatchObject({ position: "absolute", top: 0, width: 0, height: 0 });
  expect(props.pointerEvents).toBe("none");
});

it("re-renders the prompt when the id it is found by changes", () => {
  const frame = {
    agentId: "a",
    host: { id: "h" },
    layout: { platform: "web", compact: false },
    theme: { colors: {} },
    timestamp: new Date(0),
  };
  const props = (data: Record<string, unknown>) =>
    ({ ...frame, item: { type: "plugin", kind: "omp-user-message", version: 1, data } }) as never;
  const prompt = { text: "hi", messageId: "m1", clientMessageId: "c1" };
  expect(userMessagePropsEqual(props(prompt), props({ ...prompt }))).toBe(true);
  expect(userMessagePropsEqual(props(prompt), props({ ...prompt, clientMessageId: "c2" }))).toBe(false);
});
