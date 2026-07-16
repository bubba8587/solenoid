import { describe, it, expect } from "vitest";
import { FORMULA_SIGNATURES, signatureFor, signatureParams } from "./formulaSignatures";
import { FORMULA_FUNCTION_NAMES, formulaSyntaxHint } from "./excelFormula";

describe("formula signatures (display hints)", () => {
  it("every curated signature names a REAL dispatchable function", () => {
    const known = new Set(FORMULA_FUNCTION_NAMES);
    const ghosts = Object.keys(FORMULA_SIGNATURES).filter((n) => !known.has(n));
    // A ghost entry hints a function the parser can't dispatch — a lie in the UI.
    expect(ghosts).toEqual([]);
  });

  it("signatureFor: curated first, arity fallback for registered impls, null otherwise", () => {
    expect(signatureFor("INDEX")).toBe("array, row, [col]");
    expect(signatureFor("index")).toBe("array, row, [col]"); // case-insensitive
    expect(signatureFor("NOT_A_FUNCTION_XYZ")).toBeNull();
  });

  it("signatureParams splits curated params; bare-count fallbacks return null", () => {
    expect(signatureParams("array, row, [col]")).toEqual(["array", "row", "[col]"]);
    expect(signatureParams("")).toEqual([]);
    expect(signatureParams("2 args")).toBeNull();
    expect(signatureParams("1–255 args")).toBeNull();
    expect(signatureParams("3+ args")).toBeNull();
  });
});

describe("formulaSyntaxHint (why a formula fails to parse)", () => {
  it("names the actual problem for the common traps", () => {
    expect(formulaSyntaxHint("{ INDEX(c,row)*INDEX(c,col) }")).toMatch(/Braces/);
    expect(formulaSyntaxHint("=SUM(a, b)")).toMatch(/leading =/);
    expect(formulaSyntaxHint("SUM(a; b)")).toMatch(/commas/);
    expect(formulaSyntaxHint("INDEX(c, [2])")).toMatch(/Square brackets/);
    expect(formulaSyntaxHint("SUM(a, MAX(b")).toMatch(/Missing 2 closing/);
    expect(formulaSyntaxHint("SUM(a))")).toMatch(/extra closing/);
    expect(formulaSyntaxHint("a + b *")).toMatch(/mid-expression/);
  });
  it("stays quiet on a parseable formula and ignores braces inside strings", () => {
    expect(formulaSyntaxHint("INDEX(c,row)*INDEX(c,col)")).toBeNull();
    expect(formulaSyntaxHint('CONCAT("{", x, "}")')).toBeNull();
  });
});
