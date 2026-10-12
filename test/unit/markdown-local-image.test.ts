/**
 * The daemon writes a tool's image output to disk and adds a reply holding
 * only `![Image](file:///…)`. That paragraph is drawn as the image; any other
 * image keeps its alt-text link.
 */
import { describe, expect, it } from "vitest";
import type { Tokens } from "../../client/vendor/marked";
import { lexBlock } from "../../client/components/markdown/lex";
import { isImagePath } from "../../client/image-file";
import { localImagePath, localPath, splitLocalImages } from "../../client/components/markdown/render/local-path";

function paragraphTokens(markdown: string) {
  const [block] = lexBlock(markdown);
  expect(block?.type).toBe("paragraph");
  return (block as Tokens.Paragraph).tokens;
}

describe("localImagePath", () => {
  it("reads the path out of a file address, decoding what the daemon encoded", () => {
    expect(localImagePath("file:///tmp/bc-shots/rows/light/shot-tools-v2-light.png")).toBe(
      "/tmp/bc-shots/rows/light/shot-tools-v2-light.png",
    );
    expect(localImagePath("file:///Users/me/My%20Shots/a%23b.png")).toBe("/Users/me/My Shots/a#b.png");
    expect(localImagePath("file://localhost/tmp/a.jpg")).toBe("/tmp/a.jpg");
    expect(localImagePath("file:///C:/Users/me/a.png")).toBe("C:/Users/me/a.png");
  });

  it("refuses other schemes, non-images and broken escapes", () => {
    expect(localImagePath("https://example.com/a.png")).toBeNull();
    expect(localImagePath("file:///tmp/notes.txt")).toBeNull();
    expect(localImagePath("file:///tmp/%E0%A4%A.png")).toBeNull();
  });
});

describe("localPath", () => {
  it("takes a path link as the file it names", () => {
    expect(localPath("/Users/me/.agents/handoffs/handoff-20261012-083930.md")).toBe(
      "/Users/me/.agents/handoffs/handoff-20261012-083930.md",
    );
    expect(localPath("~/notes/plan.md")).toBe("~/notes/plan.md");
    expect(localPath("docs/My%20Plan.md")).toBe("docs/My Plan.md");
    expect(localPath("./README.md")).toBe("./README.md");
    expect(localPath("README.md")).toBe("README.md");
    expect(localPath("C:\\work\\a.ts")).toBe("C:\\work\\a.ts");
    expect(localPath("file:///tmp/notes.txt")).toBe("/tmp/notes.txt");
    expect(localPath("/tmp/a.png")).toBe("/tmp/a.png");
  });

  it("leaves web, mail and in-page links alone", () => {
    expect(localPath("https://example.com/a.md")).toBeNull();
    expect(localPath("mailto:me@example.com")).toBeNull();
    expect(localPath("javascript:alert(1)")).toBeNull();
    expect(localPath("//cdn.example.com/a.js")).toBeNull();
    expect(localPath("#usage")).toBeNull();
    expect(localPath("here")).toBeNull();
    expect(localPath("/tmp/%E0%A4%A.md")).toBeNull();
  });
});

describe("splitLocalImages", () => {
  const A = "file:///var/folders/T/paseo-attachments-Px59tw/3b00a7.png";
  const B = "file:///var/folders/T/paseo-attachments-Px59tw/40e4f6.png";
  const shape = (markdown: string) =>
    splitLocalImages(paragraphTokens(markdown)).map((part) =>
      part.kind === "image" ? `img:${part.path}` : `text:${part.tokens.map((token) => token.raw).join("")}`,
    );

  it("draws the daemon's image reply as the image", () => {
    expect(shape(`![Image](${A})`)).toEqual(["img:/var/folders/T/paseo-attachments-Px59tw/3b00a7.png"]);
  });

  it("splits images the host joined with nothing between them", () => {
    expect(shape(`![Image](${A})![Image](${B})`)).toEqual([
      "img:/var/folders/T/paseo-attachments-Px59tw/3b00a7.png",
      "img:/var/folders/T/paseo-attachments-Px59tw/40e4f6.png",
    ]);
  });

  it("keeps the prose a reply ran into its images", () => {
    expect(shape(`对比改动前后的截图：![Image](${A})![Image](${B})`)).toEqual([
      "text:对比改动前后的截图：",
      "img:/var/folders/T/paseo-attachments-Px59tw/3b00a7.png",
      "img:/var/folders/T/paseo-attachments-Px59tw/40e4f6.png",
    ]);
    expect(shape("See ![Image](file:///tmp/shot.png) here")).toEqual([
      "text:See ",
      "img:/tmp/shot.png",
      "text: here",
    ]);
  });

  it("leaves a paragraph without a local image whole", () => {
    expect(shape("![Logo](https://example.com/logo.png) and text")).toEqual([
      "text:![Logo](https://example.com/logo.png) and text",
    ]);
  });
});

describe("isImagePath", () => {
  it("keeps a space or # that belongs to the name, and still cuts a selector", () => {
    expect(isImagePath("/Users/me/My Shots/a#b.png")).toBe(true);
    expect(isImagePath("shot.png:1-20")).toBe(true);
    expect(isImagePath("/tmp/notes.txt")).toBe(false);
    expect(isImagePath("/tmp/a.png.d/notes")).toBe(false);
  });
});
