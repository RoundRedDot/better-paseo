import { describe, expect, it } from "vitest";
import { distinctHosts, faviconUrl, parseListedLinks, parseWebLink } from "../../client/tools/web-link";

describe("web links", () => {
  it("splits an address into site and the rest", () => {
    expect(parseWebLink("https://www.GitHub.com/getpaseo/paseo/pull/7543?tab=files#x")).toEqual({
      href: "https://www.GitHub.com/getpaseo/paseo/pull/7543?tab=files#x", host: "github.com", path: "/getpaseo/paseo/pull/7543?tab=files#x",
    });
    expect(parseWebLink("https://docs.expo.dev/")).toMatchObject({ host: "docs.expo.dev", path: "" });
    expect(parseWebLink("http://localhost:8081/a")).toMatchObject({ host: "localhost", path: "/a" });
  });

  it("reads an address in quotes, as a search query arrives", () => {
    expect(parseWebLink('"https://chatgpt.com/s/t_6b06f0de15fc"')).toMatchObject({ host: "chatgpt.com", path: "/s/t_6b06f0de15fc" });
  });

  it("is not a link for words, other schemes or several addresses", () => {
    expect(parseWebLink("react native fabric")).toBeNull();
    expect(parseWebLink("javascript:alert(1)")).toBeNull();
    expect(parseWebLink("file:///etc/passwd")).toBeNull();
    expect(parseWebLink("https://a.com https://b.com")).toBeNull();
    expect(parseWebLink(undefined)).toBeNull();
  });

  it("asks the site itself for its favicon", () => {
    expect(faviconUrl("docs.expo.dev")).toBe("https://docs.expo.dev/favicon.ico");
  });

  it("lists each site once, in order", () => {
    expect(distinctHosts(["https://github.com/a", "https://www.github.com/b", "https://npmjs.com/x", "not a url"]))
      .toEqual(["github.com", "npmjs.com"]);
  });
});

describe("listed links", () => {
  const omp = [
    "Note: answered by Exa after Parallel failed (rate limit)",
    "[1] LayoutEvent Object Type · React Native",
    "    https://reactnative.dev/docs/layoutevent",
    "[2] View · React Native",
    "    https://reactnative.dev/docs/view",
    "[7] N/A",
    "    https://raw.githubusercontent.com/DefinitelyTyped/react-native.d.ts",
    "[8] View again",
    "    https://reactnative.dev/docs/view",
  ].join("\n");

  it("reads a numbered title over its address, as Oh My Pi prints its hits", () => {
    expect(parseListedLinks(omp)).toEqual([
      { title: "LayoutEvent Object Type · React Native", url: "https://reactnative.dev/docs/layoutevent" },
      { title: "View · React Native", url: "https://reactnative.dev/docs/view" },
      { title: "https://raw.githubusercontent.com/DefinitelyTyped/react-native.d.ts", url: "https://raw.githubusercontent.com/DefinitelyTyped/react-native.d.ts" },
    ]);
    // A second call starts over: the pattern keeps no state between texts.
    expect(parseListedLinks(omp)).toHaveLength(3);
  });

  it("finds nothing in prose or a plain list of addresses", () => {
    expect(parseListedLinks("Searched for onLayout; nothing useful.")).toEqual([]);
    expect(parseListedLinks("https://a.dev\nhttps://b.dev")).toEqual([]);
    expect(parseListedLinks(undefined)).toEqual([]);
  });
});
