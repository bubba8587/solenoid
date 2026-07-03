import { describe, it, expect } from "vitest";
import { extractEmbedNames, preprocessEmbeds } from "./reportEmbeds";

describe("report embeds", () => {
  it("extracts embed names in first-seen order, de-duplicated, trimmed", () => {
    const body = "Intro\n\n![[ Sales Q1 ]]\n\nmid ![[Costs]] end\n\n![[Sales Q1]] again";
    expect(extractEmbedNames(body)).toEqual(["Sales Q1", "Costs"]);
  });

  it("returns nothing when there are no embed tokens", () => {
    expect(extractEmbedNames("just prose with a `=ref` in it")).toEqual([]);
  });

  it("preprocessEmbeds swaps each token for a data-embed marker before markdown", () => {
    const html = preprocessEmbeds("a ![[My Note]] b");
    expect(html).toBe('a <span class="sol-embed-slot" data-embed="My Note"></span> b');
  });

  it("escapes an embed name so a quote/angle can't break the marker attribute", () => {
    const html = preprocessEmbeds('![[a"b<c]]');
    expect(html).toContain('data-embed="a&quot;b&lt;c"');
    expect(html).not.toContain('"b<c"');
  });

  it("leaves a plain `[[wiki link]]` (no leading !) untouched — embeds need the !", () => {
    expect(preprocessEmbeds("see [[elsewhere]]")).toBe("see [[elsewhere]]");
    expect(extractEmbedNames("see [[elsewhere]]")).toEqual([]);
  });
});
