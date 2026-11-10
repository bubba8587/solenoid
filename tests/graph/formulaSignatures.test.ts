// [[C51]] formulaNaming, [[formula-language#Editor support]], [[formula-language#Syntax hints]]
import { describe, it, expect } from "vitest";
import { FORMULA_SIGNATURES, signatureFor, signatureParams, genericSignature } from "../../src/graph/formulaSignatures";
import { syntaxHint } from "./coreVerbs";
import { FUNCTION_ARITY, FRAME_SURFACE_NAMES, formulaFunctionNames } from "../../src/graph/excelFunctions";
import { initPackFormulas } from "../../src/graph/formulaExtensions";

describe("formula signatures (display hints)", () => {
  it("every curated signature names a REAL dispatchable function", () => {
    const known = new Set(formulaFunctionNames());
    const ghosts = Object.keys(FORMULA_SIGNATURES).filter((n) => !known.has(n));
    expect(ghosts).toEqual([]);
  });

  it("signatureFor: curated first, synthesized named args for registered impls, null otherwise", () => {
    expect(signatureFor("index")).toBe("array, [row], [col]"); // case-insensitive
    expect(signatureFor("NOT_A_FUNCTION_XYZ")).toBeNull();
  });

  it("NO registered impl ever hints a bare argument count — every one names its args", () => {
    for (const name of Object.keys(FUNCTION_ARITY)) {
      if (FRAME_SURFACE_NAMES[name]) continue; // a refused frame verb redirects, no arg list
      const sig = signatureFor(name);
      expect(sig, `${name} has no hint`).not.toBeNull();
      expect(sig, `${name} hints a bare count "${sig}"`).not.toMatch(/^\d+(\+|–\d+)? args?$/);
    }
  });

  it("every hint agrees with its impl's declared arity — the hint IS the contract", () => {
    initPackFormulas();
    const SPECIAL_FORMS = new Set(["LAMBDA"]);
    const bad: string[] = [];
    for (const [name, arity] of Object.entries(FUNCTION_ARITY)) {
      if (FRAME_SURFACE_NAMES[name] || SPECIAL_FORMS.has(name)) continue;
      const sig = signatureFor(name);
      const params = sig === null ? null : signatureParams(sig);
      if (params === null) continue; // prose redirect
      const [min, max] = arity;
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
    expect(signatureParams(signatureFor("TEXTFILTER")!)).toBeNull();
  });
});

describe("the syntax hint (why a formula fails to parse)", () => {
  it("names the actual problem for the common traps", () => {
    expect(syntaxHint("{ INDEX(c,row)*INDEX(c,col) }")).toMatch(/Braces/);
    expect(syntaxHint("=SUM(a, b)")).toMatch(/leading =/);
    expect(syntaxHint("SUM(a; b)")).toMatch(/commas/);
    expect(syntaxHint("SUM([Unit Price")).toMatch(/Unclosed \[/);
    // A balanced `[...]` is a column reference, so the hint names the parenthesis.
    expect(syntaxHint("SUM([Unit Price]")).toMatch(/Missing 1 closing/);
    expect(syntaxHint("SUM(a, MAX(b")).toMatch(/Missing 2 closing/);
    expect(syntaxHint("SUM(a))")).toMatch(/extra closing/);
    expect(syntaxHint("a + b *")).toMatch(/mid-expression/);
  });
  it("stays quiet on a parseable formula and ignores braces inside strings", () => {
    expect(syntaxHint("INDEX(c,row)*INDEX(c,col)")).toBeNull();
    expect(syntaxHint('CONCAT("{", x, "}")')).toBeNull();
  });
});
