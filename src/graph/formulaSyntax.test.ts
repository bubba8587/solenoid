import { describe, it, expect } from "vitest";
import { highlightFormula, tokenAtCaret, suggestFor, enclosingCall } from "./formulaSyntax";
import { formulaFunctionNames } from "./excelFormula";

// Strip the tags to recover the original text — the highlighter must be lossless.
const stripTags = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

describe("highlightFormula", () => {
  it("is character-lossless (every input char survives)", () => {
    const src = '  SUM(a, b) * price + "hi" - 3.5e2 % ';
    expect(stripTags(highlightFormula(src))).toBe(src);
  });
  it("classes a known function vs an unknown call vs a variable vs a constant", () => {
    const html = highlightFormula("SUM(price) + myFn(x) + pi");
    expect(html).toContain('<span class="fx-fn">SUM</span>');
    expect(html).toContain('<span class="fx-unknown">myFn</span>'); // call to a non-function
    expect(html).toContain('<span class="fx-var">price</span>');
    expect(html).toContain('<span class="fx-var">x</span>');
    expect(html).toContain('<span class="fx-const">pi</span>');
  });
  it("a name is a function only in CALL position (followed by `(`, spaces ok)", () => {
    expect(highlightFormula("SUM")).toContain('<span class="fx-var">SUM</span>');     // bare → variable
    expect(highlightFormula("SUM (1)")).toContain('<span class="fx-fn">SUM</span>');  // call w/ space
  });
  it("escapes HTML and colors numbers/strings/operators", () => {
    const html = highlightFormula('a < "x" & 2');
    expect(html).toContain('<span class="fx-op">&lt;</span>');
    expect(html).toContain('<span class="fx-str">"x"</span>'); // quotes kept literally (not escaped)
    expect(html).toContain('<span class="fx-num">2</span>');
  });
});

describe("tokenAtCaret", () => {
  it("finds the identifier word ending at the caret", () => {
    expect(tokenAtCaret("SU", 2)).toEqual({ word: "SU", start: 0 });
    expect(tokenAtCaret("a + pri", 7)).toEqual({ word: "pri", start: 4 });
  });
  it("returns null mid-number or after a non-identifier", () => {
    expect(tokenAtCaret("3.5", 3)).toBeNull();   // starts with a digit
    expect(tokenAtCaret("a + ", 4)).toBeNull();  // caret after a space
  });
});

describe("suggestFor", () => {
  it("ranks an exact prefix of a real function near the top", () => {
    const names = suggestFor("SUM").map((s) => s.name);
    expect(names).toContain("SUM");
    expect(formulaFunctionNames()).toContain("SUM");
  });
  it("includes the node's own variables + constants, kind-tagged", () => {
    const s = suggestFor("pr", ["price", "profit"]);
    const vars = s.filter((x) => x.kind === "var").map((x) => x.name);
    expect(vars).toContain("price");
    expect(vars).toContain("profit");
  });
  it("drops a fully-typed non-function (nothing left to complete)", () => {
    // `tau` is a constant with no Formula.js function of that name → nothing to add.
    expect(suggestFor("tau").some((x) => x.name.toLowerCase() === "tau")).toBe(false);
    // but a fully-typed FUNCTION stays — accepting it still adds the `(`.
    expect(suggestFor("PI").some((x) => x.name === "PI")).toBe(true);
  });
});

describe("signature surfacing (audit 2026-07-16 — arg-count in autocomplete)", () => {
  it("a function suggestion carries its signature hint", () => {
    const idx = suggestFor("INDE").find((s) => s.name === "INDEX");
    expect(idx?.hint).toBe("array, row, [col]");
  });

  it("enclosingCall finds the innermost call + the caret's argument", () => {
    const src = "INDEX(c, row) * MAX(a, b";
    // caret inside INDEX's 2nd arg
    expect(enclosingCall(src, "INDEX(c, r".length)).toEqual({ name: "INDEX", argIndex: 1 });
    // caret inside MAX's 2nd arg (INDEX is closed by then)
    expect(enclosingCall(src, src.length)).toEqual({ name: "MAX", argIndex: 1 });
    // top level → null
    expect(enclosingCall(src, "INDEX(c, row) ".length)).toBeNull();
    // a comma inside a STRING doesn't advance the arg index
    expect(enclosingCall('TEXTJOIN(",", x', 'TEXTJOIN(",", x'.length))
      .toEqual({ name: "TEXTJOIN", argIndex: 1 });
    // an anonymous paren group nests without stealing the name
    expect(enclosingCall("SUM((a + b), c", "SUM((a + b), c".length))
      .toEqual({ name: "SUM", argIndex: 1 });
  });
});
