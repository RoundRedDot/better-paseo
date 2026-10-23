import { describe, expect, it } from "vitest";
import { subagentFacts, subagentModel, subagentType } from "../../client/tasks/subagent-type";

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

describe("subagentModel", () => {
  it("names the model and effort after the type, leaving the token count out", () => {
    expect(subagentModel("general-purpose · Sonnet 5.5 · High · 197.1k tokens", "general-purpose")).toEqual({ model: "Sonnet 5.5", thinking: "High" });
    expect(subagentModel("Explore · Haiku 5.5 · 1 token", "Explore")).toEqual({ model: "Haiku 5.5", thinking: null });
    expect(subagentModel("Plan · Opus 5.5", "Plan")).toEqual({ model: "Opus 5.5", thinking: null });
  });

  it("leaves the model out where the line names none, the subagent inheriting its parent's", () => {
    expect(subagentModel("general-purpose · High · 518k tokens", "general-purpose")).toEqual({ model: null, thinking: "High" });
    expect(subagentModel("Explore · Extra High", "Explore")).toEqual({ model: null, thinking: "Extra High" });
  });

  it("names none where the line does not open with the type or holds only it", () => {
    expect(subagentModel("Sonnet 5.5 · High", "Explore")).toBeNull();
    expect(subagentModel("Explore", "Explore")).toBeNull();
    expect(subagentModel("Explore · 12k tokens", "Explore")).toBeNull();
    expect(subagentModel(null, "Explore")).toBeNull();
  });
});

describe("subagentType", () => {
  it("takes the descriptor's title, or the known type its facts line opens with", () => {
    expect(subagentType("Explore", "general-purpose · High")).toBe("Explore");
    // A background Agent call's descriptor can carry no title.
    expect(subagentType(null, "general-purpose · High · 518k tokens")).toBe("general-purpose");
    expect(subagentType("  ", "Explore · Haiku 5.5")).toBe("Explore");
  });

  it("leaves a first name the timeline has no icon for unknown: it could be a model", () => {
    expect(subagentType(null, "Sonnet 5.5 · High")).toBeNull();
    expect(subagentType(null, null)).toBeNull();
  });
});
