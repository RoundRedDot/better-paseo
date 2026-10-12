/**
 * The daemon writes a tool's image output to disk and adds a reply holding
 * only `![Image](file:///…)`. That paragraph is drawn as the image; any other
 * image keeps its alt-text link.
 */
import { describe, expect, it } from "vitest";
import type { Tokens } from "../../client/vendor/marked";
import { lexBlock } from "../../client/components/markdown/lex";
import { isImagePath } from "../../client/image-file";
import { localImagePath, soleLocalImage } from "../../client/components/markdown/render/local-image-path";

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
    expect(localImagePath("/tmp/a.png")).toBeNull();
  });
});

describe("soleLocalImage", () => {
  it("finds the daemon's image reply", () => {
    expect(soleLocalImage(paragraphTokens("![Image](file:///tmp/shot.png)"))).toBe("/tmp/shot.png");
  });

  it("leaves an image inside prose, and a remote image, to the inline link", () => {
    expect(soleLocalImage(paragraphTokens("See ![Image](file:///tmp/shot.png) here"))).toBeNull();
    expect(soleLocalImage(paragraphTokens("![Logo](https://example.com/logo.png)"))).toBeNull();
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
