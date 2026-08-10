import { describe, it, expect } from "vitest";
import { FORMULA_SIGNATURES, signatureFor, signatureParams, genericSignature } from "./formulaSignatures";
import { formulaFunctionNames, formulaSyntaxHint } from "./excelFormula";
import { EXCEL_IMPL_META, FRAME_SURFACE_NAMES } from "./excelFunctions";

describe("formula signatures (display hints)", () => {
  it("every curated signature names a REAL dispatchable function", () => {
    const known = new Set(formulaFunctionNames());
    const ghosts = Object.keys(FORMULA_SIGNATURES).filter((n) => !known.has(n));
    // A ghost entry hints a function the parser can't dispatch — a lie in the UI.
    expect(ghosts).toEqual([]);
  });

  it("signatureFor: curated first, synthesized named args for registered impls, null otherwise", () => {
    expect(signatureFor("INDEX")).toBe("array, row, [col]");
    expect(signatureFor("index")).toBe("array, row, [col]"); // case-insensitive
    expect(signatureFor("NOT_A_FUNCTION_XYZ")).toBeNull();
  });

  it("NO registered impl ever hints a bare argument count — every one names its args", () => {
    // The rule: a function's autocomplete hint is a named parameter list (optional
    // args in [brackets], variadic tail as `…`), never "3 args" / "2–255 args".
    for (const name of Object.keys(EXCEL_IMPL_META)) {
      if (FRAME_SURFACE_NAMES[name]) continue; // a refused frame verb redirects, no arg list
      const sig = signatureFor(name);
      expect(sig, `${name} has no hint`).not.toBeNull();
      expect(sig, `${name} hints a bare count "${sig}"`).not.toMatch(/^\d+(\+|–\d+)? args?$/);
    }
  });

  it("genericSignature (the arity fallback) names args with optional brackets and a variadic tail", () => {
    expect(genericSignature([2, 3])).toBe("arg1, arg2, [arg3]");
    expect(genericSignature([3, 3])).toBe("arg1, arg2, arg3");
    expect(genericSignature([1, 255])).toBe("arg1, …");
    expect(genericSignature([2, 255])).toBe("arg1, arg2, …");
    expect(genericSignature([0, 5])).toBe("[arg1], [arg2], [arg3], [arg4], [arg5]");
    expect(genericSignature([0, 0])).toBe("");
  });

  it("signatureParams splits curated params; a prose redirect returns null", () => {
    expect(signatureParams("array, row, [col]")).toEqual(["array", "row", "[col]"]);
    expect(signatureParams("")).toEqual([]);
    expect(signatureParams("frame verb — use the Join node")).toBeNull();
  });
});

describe("formulaSyntaxHint (why a formula fails to parse)", () => {
  it("names the actual problem for the common traps", () => {
    expect(formulaSyntaxHint("{ INDEX(c,row)*INDEX(c,col) }")).toMatch(/Braces/);
    expect(formulaSyntaxHint("=SUM(a, b)")).toMatch(/leading =/);
    expect(formulaSyntaxHint("SUM(a; b)")).toMatch(/commas/);
    expect(formulaSyntaxHint("SUM([Unit Price")).toMatch(/Unclosed \[/);
    // Balanced brackets are legal D24 structured references — the hint must NOT
    // blame them; the real problem here is the parenthesis.
    expect(formulaSyntaxHint("SUM([Unit Price]")).toMatch(/Missing 1 closing/);
    expect(formulaSyntaxHint("SUM(a, MAX(b")).toMatch(/Missing 2 closing/);
    expect(formulaSyntaxHint("SUM(a))")).toMatch(/extra closing/);
    expect(formulaSyntaxHint("a + b *")).toMatch(/mid-expression/);
  });
  it("stays quiet on a parseable formula and ignores braces inside strings", () => {
    expect(formulaSyntaxHint("INDEX(c,row)*INDEX(c,col)")).toBeNull();
    expect(formulaSyntaxHint('CONCAT("{", x, "}")')).toBeNull();
  });
});
