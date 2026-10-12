import { afterEach, expect, it } from "vitest";
import { followPreference } from "../../client/state/follow-preference";
import { applyStoredPreferences, getEnhancerPreferences, storedPart, updateEnhancerPreferences } from "../../client/preferences";

const initial = storedPart(getEnhancerPreferences());
afterEach(() => applyStoredPreferences(initial));

it("registers again when its preference changes, and only then", () => {
  const log: string[] = [];
  let count = 0;
  const stop = followPreference("enhancedUserBubble", () => {
    const id = ++count;
    log.push(`add ${id}`);
    return () => log.push(`remove ${id}`);
  });
  expect(log).toEqual(["add 1"]);

  updateEnhancerPreferences({ accent: "rose" });
  expect(log).toEqual(["add 1"]);

  // The daemon's settings arriving after the first items were projected.
  applyStoredPreferences({ ...storedPart(getEnhancerPreferences()), enhancedUserBubble: true });
  expect(log).toEqual(["add 1", "remove 1", "add 2"]);

  stop();
  expect(log).toEqual(["add 1", "remove 1", "add 2", "remove 2"]);
  updateEnhancerPreferences({ enhancedUserBubble: false });
  expect(log).toHaveLength(4);
});
