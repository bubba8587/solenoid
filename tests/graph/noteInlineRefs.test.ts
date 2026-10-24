// [[C68]] knapIsTheDocumentSyntax
import { describe, it, expect } from "vitest";
import { substituteRefCodes } from "../../src/graph/noteInlineRefs";

/** The names `substituteRefCodes` asks to render, in order, a highlighted one marked with `!`. */
const refs = (html: string) => {
  const names: string[] = [];
  substituteRefCodes(html, (name, highlight) => { names.push(highlight ? `${name}!` : name); return null; });
  return names;
};

describe("substituteRefCodes", () => {
  it("finds every ref in source order", () => {
    expect(refs("<code>=a</code> then <code>=b</code> then <code>=a</code> again.")).toEqual(["a", "b", "a"]);
  });

  it("ignores a plain code span (not a ref)", () => {
    expect(refs("Run <code>npm install</code> first.")).toEqual([]);
  });

  it("ignores a bare `=` with no identifier", () => {
    expect(refs("<code>=</code> and <code>= </code> are not refs.")).toEqual([]);
  });

  it("requires the identifier grammar (letters/digits/underscore, no leading digit)", () => {
    expect(refs("<code>=1abc</code> is not a ref, but <code>=abc1</code> is.")).toEqual(["abc1"]);
  });

  it("the `!` highlight flag is display-only: the name is the bare one", () => {
    expect(refs("Rate is <code>=rate!</code> (target <code>=rate</code>).")).toEqual(["rate!", "rate"]);
  });

  it("a block result that fills its paragraph replaces the paragraph; null leaves the span", () => {
    const render = (name: string) => (name === "t" ? { html: "<table></table>", block: true } : null);
    expect(substituteRefCodes("<p><code>=t</code></p>", render)).toBe("<table></table>");
    expect(substituteRefCodes("<p>see <code>=t</code></p>", render)).toBe("<p>see <table></table></p>");
    expect(substituteRefCodes("<p><code>=u</code></p>", render)).toBe("<p><code>=u</code></p>");
  });
});
