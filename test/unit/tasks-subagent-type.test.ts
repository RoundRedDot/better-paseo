import { describe, expect, it } from "vitest";
import { subagentFacts } from "../../client/tasks/subagent-type";

describe("subagentFacts", () => {
  it("draws a type the timeline has an icon for as the icon alone", () => {
    expect(subagentFacts("general-purpose · Sonnet 5.5 · High · 185.4k tokens", "general-purpose")).toEqual({
      icon: "Shapes",
      text: "Sonnet 5.5 · High · 185.4k tokens",
      full: "general-purpose · Sonnet 5.5 · High · 185.4k tokens",
    });
    const icon = (type: string) => subagentFacts(`${type} · Opus 5.5`, type).icon;
    expect(["Explore", "Plan", "Workflow", "fork", "claude"].map(icon)).toEqual(["Search", "ListChecks", "Workflow", "Split", "Bot"]);
    // OpenCode names its types in lower case.
    expect(subagentFacts("explore · claude-sonnet-5", "explore")).toMatchObject({ icon: "Search", text: "claude-sonnet-5" });
  });

  it("keeps any other name beside the subagent icon", () => {
    expect(subagentFacts("ocx-gpt-6-astra · Sonnet 5.5 · 12.4k tokens", "ocx-gpt-6-astra")).toMatchObject({ icon: "Bot", text: "ocx-gpt-6-astra · Sonnet 5.5 · 12.4k tokens" });
    expect(subagentFacts("general", "general")).toMatchObject({ icon: "Bot", text: "general" });
  });

  it("leaves a type alone with no facts after it as the icon", () => {
    expect(subagentFacts("Explore", "Explore")).toEqual({ icon: "Search", text: null, full: "Explore" });
  });

  it("draws the line as written when it does not open with the type, or the type is unknown", () => {
    expect(subagentFacts("Sonnet 5.5 · High", "Explore")).toEqual({ icon: null, text: "Sonnet 5.5 · High", full: "Sonnet 5.5 · High" });
    expect(subagentFacts("Explorer · Sonnet 5.5", "Explore")).toMatchObject({ icon: null, text: "Explorer · Sonnet 5.5" });
    expect(subagentFacts("general-purpose · Sonnet 5.5", null)).toMatchObject({ icon: null, text: "general-purpose · Sonnet 5.5" });
    expect(subagentFacts(null, "Explore")).toEqual({ icon: null, text: null, full: null });
  });
});
