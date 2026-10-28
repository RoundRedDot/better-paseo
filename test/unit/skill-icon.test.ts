import { describe, expect, it } from "vitest";
import { skillIcon } from "../../client/tools/skill-icon";

describe("skillIcon", () => {
  it.each([
    ["bsk", "AppWindow"],
    ["browserskill", "AppWindow"],
    ["browser-skill", "AppWindow"],
    ["agent-browser", "AppWindow"],
    ["agent-browser:agent-browser", "AppWindow"],
    ["/Remotion-best-practices", "Film"],
    ["remotion-render", "Film"],
    ["video:remotion-best-practices", "Film"],
    ["impeccable", "Palette"],
    ["impeccable:polish", "Palette"],
    ["gstack", "Layers"],
    ["gstack:qa", "Layers"],
    ["gstack-qa", "Layers"],
    ["firecrawl", "Flame"],
    ["firecrawl:firecrawl", "Flame"],
    ["playwright-cli", "brand:playwright"],
    ["find-skills", "Blocks"],
    ["skills", "Blocks"],
    ["ui-taste", "PanelsTopLeft"],
    ["uizze-ui", "PanelsTopLeft"],
    ["uizze:ui-taste", "PanelsTopLeft"],
    ["hyperframes-animation", "Clapperboard"],
  ])("%s draws %s", (name, icon) => {
    expect(skillIcon(name)).toBe(icon);
  });

  it.each([undefined, "", "hand-off", "qa", "review", "polish", "my-remotion-helper", "gstacked", "skills-audit"])
    ("preserves the generic icon for %s", (name) => {
      expect(skillIcon(name)).toBe("Sparkles");
    });
});
