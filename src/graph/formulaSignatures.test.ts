import { describe, it, expect } from "vitest";
import { FORMULA_SIGNATURES, signatureFor, signatureParams, genericSignature } from "./formulaSignatures";
import { formulaFunctionNames, formulaSyntaxHint } from "./excelFormula";
import { EXCEL_IMPL_META, FRAME_SURFACE_NAMES } from "./excelFunctions";
import { initPackFormulas } from "./formulaExtensions";

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

  it("every hint agrees with its impl's declared arity — the hint IS the contract", () => {
    // A hint promising an argument the impl ignores (or hiding one it takes) lies in
    // the UI exactly like a wrong result would. Rule: unbracketed params = arity min;
    // total named params = arity max, unless a `…` tail makes the family variadic, in
    // which case max must genuinely exceed the named prefix. Runs through
    // signatureFor(), so curated, pack-declared and synthesized hints are all held
    // to it. Formula.js-backed names carry no declared arity and stay uncheckable.
    initPackFormulas();
    // LAMBDA is a special FORM — "parameter1, …, calculation" shows the common shape;
    // its mid-signature ellipsis doesn't parse as a variadic tail.
    const SPECIAL_FORMS = new Set(["LAMBDA"]);
    const bad: string[] = [];
    for (const [name, meta] of Object.entries(EXCEL_IMPL_META)) {
      if (FRAME_SURFACE_NAMES[name] || SPECIAL_FORMS.has(name)) continue;
      const sig = signatureFor(name);
      const params = sig === null ? null : signatureParams(sig);
      if (params === null) continue; // prose redirect
      const [min, max] = meta.arity;
      const variadic = params.length > 0 && params[params.length - 1].includes("…");
      const named = variadic ? params.slice(0, -1) : params;
      const required = named.filter((p) => !p.startsWith("[")).length;
      const ok = required === min && (variadic ? max > named.length : named.length === max);
      if (!ok) bad.push(`${name}: "${sig}" (${required} required, ${named.length}${variadic ? "+…" : ""} named) vs arity [${min}, ${max}]`);
    }
    expect(bad).toEqual([]);
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
    // Balanced brackets are legal tableRefSemantics structured references — the hint must NOT
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
