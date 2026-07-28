import { describe, it, expect, afterEach } from "vitest";
import * as FX from "@formulajs/formulajs";
import {
  FAMILY_BACKING,
  FUNCTION_FAMILY,
  excelFunctionInfo,
  resolveExcelFunction,
  registerInternal,
  internalFunctionNames,
  ELIMINATED_FUNCTIONS,
  EXCEL_IMPL_META,
  numberToText,
  type FuncFamily,
  unregisterInternal,
} from "./excelFunctions";
import { compileEvaluator, formulaFunctionNames } from "./excelFormula";
import { isSolError, type SolError } from "./errorValue";
import { jsDateToSerial, serialToJsDate } from "./nodes/date";

describe("numberToText — 15 significant digits, trailing zeros stripped", () => {
  it("strips IEEE representation noise", () => {
    expect(numberToText(0.1 + 0.2)).toBe("0.3");
    expect(numberToText(1 / 3)).toBe("0.333333333333333"); // 15 sig digits
  });
  it("leaves clean values alone", () => {
    expect(numberToText(42)).toBe("42");
    expect(numberToText(-0)).toBe("0");
    expect(numberToText(1234567.5)).toBe("1234567.5");
    expect(numberToText(0)).toBe("0");
  });
  it("falls back to String for non-finite (guardFinite normally tags these first)", () => {
    expect(numberToText(Infinity)).toBe("Infinity");
    expect(numberToText(NaN)).toBe("NaN");
  });
});

describe("FAMILY_BACKING (the audit's per-family verdict)", () => {
  it("keeps the families a difference-that-matters dictates internal", () => {
    // "complex" flipped verify → internal with the D23-amendment tranche: the
    // tagged Cx (VAL-15) IS the difference that matters — Formula.js's IM* speak
    // text complexes, a different currency.
    for (const fam of ["statistics", "distributions", "datetime", "lookup", "matrix", "units", "finance-iterative", "complex"] as const) {
      expect(FAMILY_BACKING[fam].backing).toBe("internal");
    }
  });

  it("backs the boring half with Formula.js", () => {
    for (const fam of ["arithmetic", "scalar-math", "finance", "text"] as const) {
      expect(FAMILY_BACKING[fam].backing).toBe("formulajs");
    }
  });

  it("marks the verify-then-decide families", () => {
    for (const fam of ["rounding", "combinatorics"] as const) {
      expect(FAMILY_BACKING[fam].backing).toBe("verify");
    }
  });

  it("gives every family a non-empty reason", () => {
    for (const v of Object.values(FAMILY_BACKING)) expect(v.why.length).toBeGreaterThan(0);
  });
});

describe("excelFunctionInfo", () => {
  it("routes representative functions to the right family + backing", () => {
    expect(excelFunctionInfo("STDEV")).toMatchObject({ family: "statistics", backing: "internal" });
    expect(excelFunctionInfo("abs")).toMatchObject({ family: "scalar-math", backing: "formulajs" }); // case-insensitive
    expect(excelFunctionInfo("IRR")).toMatchObject({ family: "finance-iterative", backing: "internal" });
    expect(excelFunctionInfo("PMT")).toMatchObject({ family: "finance", backing: "formulajs" });
    expect(excelFunctionInfo("CONVERT")).toMatchObject({ family: "lookup", backing: "internal" });
    expect(excelFunctionInfo("ROUND")).toMatchObject({ family: "rounding", backing: "verify" });
  });

  it("returns null for a Formula.js-only name (not part of the overlap surface)", () => {
    expect(excelFunctionInfo("NONEXISTENTFN")).toBeNull();
  });

  it("classifies every entry in FUNCTION_FAMILY into a known family", () => {
    for (const fam of Object.values(FUNCTION_FAMILY)) {
      expect(FAMILY_BACKING[fam as FuncFamily]).toBeDefined();
    }
  });
});

describe("resolveExcelFunction (the resolution seam)", () => {
  afterEach(() => {
    // registerInternal mutates module state — WITHDRAW what tests added. (The old
    // cleanup registered `undefined` as the impl, which the duplicate-registration
    // guard now correctly refuses — registering a hole is not unregistering.)
    unregisterInternal("ABS");
  });

  it("falls through to the Formula.js impl today (no internals registered)", () => {
    const abs = resolveExcelFunction("ABS");
    expect(typeof abs).toBe("function");
    expect(abs?.(-3)).toBe(FX.ABS(-3));
  });

  it("is case-insensitive on the name (a non-registered fn still falls through)", () => {
    expect(resolveExcelFunction("cos")?.(0)).toBe(FX.COS(0)); // COS isn't in the first wave
  });

  it("returns null when neither an internal nor a Formula.js impl exists", () => {
    expect(resolveExcelFunction("DEFINITELYNOTAFUNCTION")).toBeNull();
  });

  it("prefers a registered internal impl over Formula.js", () => {
    const sentinel = (...a: unknown[]) => `internal:${String(a[0])}`;
    registerInternal("ABS", sentinel);
    expect(resolveExcelFunction("ABS")?.(-3)).toBe("internal:-3");
  });
});

describe("first wave of native impls (registered through the seam)", () => {
  const fn = (name: string) => resolveExcelFunction(name)!;

  it("ROUND rounds half AWAY from zero (Excel), unlike JS Math.round", () => {
    expect(fn("ROUND")(2.5, 0)).toBe(3);
    expect(fn("ROUND")(-2.5, 0)).toBe(-3); // Math.round(-2.5) would be -2
    expect(fn("ROUND")(3.14159, 2)).toBe(3.14);
  });
  it("SQRT mints a tagged #DOMAIN! on a negative (vs Formula.js's Error object)", () => {
    expect(fn("SQRT")(9)).toBe(3);
    const neg = fn("SQRT")(-1);
    expect(isSolError(neg)).toBe(true);
    expect((neg as SolError).code).toBe("#DOMAIN!");
  });
  it("STANDARDIZE = (x-mean)/sd, #DOMAIN! on a non-positive sd", () => {
    expect(fn("STANDARDIZE")(8, 5, 3)).toBe(1);
    expect(isSolError(fn("STANDARDIZE")(8, 5, 0))).toBe(true);
  });
  it("YEAR + EOMONTH operate on the Solenoid date serial", () => {
    const serial = jsDateToSerial(new Date(Date.UTC(2026, 2, 15))); // 2026-03-15
    expect(fn("YEAR")(serial)).toBe(2026);
    const d = serialToJsDate(fn("EOMONTH")(serial, 0) as number);
    expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]).toEqual([2026, 2, 31]); // 2026-03-31
  });
  it("LEN is string → number", () => {
    expect(fn("LEN")("hello")).toBe(5);
  });
  it("the datetime extractors read OUR serial, matching DatePartNode (getUTC*)", () => {
    // 2026-03-15 14:25:36 UTC
    const serial = jsDateToSerial(new Date(Date.UTC(2026, 2, 15, 14, 25, 36)));
    expect(fn("MONTH")(serial)).toBe(3);
    expect(fn("DAY")(serial)).toBe(15);
    expect(fn("HOUR")(serial)).toBe(14);
    expect(fn("MINUTE")(serial)).toBe(25);
    expect(fn("SECOND")(serial)).toBe(36);
    // non-number arg → tagged #VALUE!
    expect(isSolError(fn("MONTH")("nope"))).toBe(true);
  });
  it("declares each impl's output socket type + arity (EXCEL_IMPL_META)", () => {
    expect(EXCEL_IMPL_META.EOMONTH.returns).toBe("date");
    expect(EXCEL_IMPL_META.LEN.returns).toBe("number");
    expect(EXCEL_IMPL_META.ROUND.arity).toEqual([2, 2]);
    expect(EXCEL_IMPL_META.STANDARDIZE.family).toBe("statistics");
  });
});

describe("Solenoid-only functions — the registry ADDS what Formula.js lacks", () => {
  const fn = (name: string) => resolveExcelFunction(name)!;

  it("CLAMP / ORDINAL / BETWEEN don't exist in Formula.js but ARE in the autocomplete list", () => {
    for (const name of ["CLAMP", "ORDINAL", "BETWEEN"]) {
      expect((FX as Record<string, unknown>)[name]).toBeUndefined();   // not from Formula.js
      expect(formulaFunctionNames()).toContain(name);                  // but offered + highlighted
    }
  });
  it("CLAMP bounds a number (number type)", () => {
    expect(fn("CLAMP")(15, 0, 10)).toBe(10);
    expect(fn("CLAMP")(-4, 0, 10)).toBe(0);
    expect(fn("CLAMP")(5, 0, 10)).toBe(5);
  });
  it("ORDINAL is number → string (covers the string output type)", () => {
    expect([1, 2, 3, 11, 22, 113].map((n) => fn("ORDINAL")(n)))
      .toEqual(["1st", "2nd", "3rd", "11th", "22nd", "113th"]);
  });
  it("BETWEEN is a real boolean (covers the logical output type)", () => {
    expect(fn("BETWEEN")(5, 0, 10)).toBe(true);
    expect(fn("BETWEEN")(11, 0, 10)).toBe(false);
  });
  it("EXCEL_IMPL_META tags them native + their output type", () => {
    expect(EXCEL_IMPL_META.CLAMP).toMatchObject({ returns: "number", native: true });
    expect(EXCEL_IMPL_META.ORDINAL).toMatchObject({ returns: "string", native: true });
    expect(EXCEL_IMPL_META.BETWEEN).toMatchObject({ returns: "logical", native: true });
  });
  it("each registered impl declares an output type that matches the audit families", () => {
    // Every meta entry has a known ExcelReturn ("any" = type-neutral passthrough).
    for (const m of Object.values(EXCEL_IMPL_META)) {
      expect(["number", "string", "logical", "date", "complex", "any"]).toContain(m.returns);
    }
  });
  it("every registered internal declares its meta (FX-3, the registered→declared direction)", () => {
    // The reverse direction (declared→dispatches) lives in formulaTier3; without
    // THIS one, 28 registrations had no entry and the rule was fiction.
    const meta = new Set(Object.keys(EXCEL_IMPL_META));
    // The D10 redirect stubs are the GATE, not implementations — their whole
    // contract is answering #NAME? — so the blocklist is out of scope here.
    const undeclared = internalFunctionNames().filter((n) => !meta.has(n) && !ELIMINATED_FUNCTIONS.has(n));
    expect(undeclared, `registerInternal names with no EXCEL_IMPL_META entry: ${undeclared.join(", ")}`).toEqual([]);
  });
});

describe("the typed-formula path now resolves the registry, not Formula.js", () => {
  it("SQRT(-1) in a formula surfaces our tagged #DOMAIN!", () => {
    const r = compileEvaluator("SQRT(x)")!({ x: -1 });
    expect(isSolError(r)).toBe(true);
    expect((r as SolError).code).toBe("#DOMAIN!");
  });
  it("ROUND through a formula uses our Excel rounding", () => {
    expect(compileEvaluator("ROUND(x, 0)")!({ x: -2.5 })).toBe(-3);
  });
  it("an owned scalar fn still broadcasts element-wise over a list", () => {
    expect(compileEvaluator("LEN(s)")!({ s: ["a", "bcd"] })).toEqual([1, 3]);
  });
  it("a Solenoid-only function is now callable in a formula (Formula.js alone would throw)", () => {
    expect(compileEvaluator("CLAMP(x, 0, 10)")!({ x: 42 })).toBe(10);
    expect(compileEvaluator("BETWEEN(x, 1, 5)")!({ x: 3 })).toBe(true);
    expect(compileEvaluator("ORDINAL(n)")!({ n: 2 })).toBe("2nd");
  });
});

// The flat stat names Formula.js hides behind namespaced objects (STDEV.S, …) used to
// THROW "Unknown function" in a formula (the tokenizer can't read a dotted name). The
// registry exposes the flat Excel name, so they now compute.
describe("statistics flat names — registered so a formula can call them at all", () => {
  const ev = (expr: string, env: Record<string, unknown>) => compileEvaluator(expr)!(env);
  const X = { x: [2, 4, 4, 4, 5, 5, 7, 9] };

  it("STDEV / VAR / MODE / PERCENTILE / QUARTILE / COVAR resolve (were Unknown function)", () => {
    expect(resolveExcelFunction("STDEV")).toBeTypeOf("function");
    expect(resolveExcelFunction("VAR")).toBeTypeOf("function");
    expect(resolveExcelFunction("MODE")).toBeTypeOf("function");
    expect(resolveExcelFunction("PERCENTILE")).toBeTypeOf("function");
    expect(resolveExcelFunction("QUARTILE")).toBeTypeOf("function");
    expect(resolveExcelFunction("COVAR")).toBeTypeOf("function");
    expect(resolveExcelFunction("PERCENTRANK")).toBeTypeOf("function");
  });

  it("STDEV defaults to sample, VAR to sample, MODE to single", () => {
    expect(ev("STDEV(x)", X)).toBeCloseTo(2.13809, 4);   // sample stdev (sum sq dev 32 / 7)
    expect(ev("VAR(x)", X)).toBeCloseTo(4.57143, 4);      // sample variance 32/7
    expect(ev("MODE(x)", X)).toBe(4);                      // MODE.SNGL
    expect(ev("PERCENTILE(x, 0.5)", X)).toBe(4.5);         // .INC, = median
    expect(ev("QUARTILE(x, 2)", X)).toBe(4.5);
  });

  it("RANK uses OUR Excel-correct impl: #N/A for a value not in the list (FX returns 0)", () => {
    expect(ev("RANK(7, x)", X)).toBe(2);                   // 9 is rank 1, 7 is rank 2 (descending)
    const miss = ev("RANK(6, x)", X);
    expect(isSolError(miss) && (miss as SolError).code).toBe("#N/A");
  });

  it("TRIMMEAN uses OUR Excel-correct impl: 0.2 trims nothing here (FX over-trims to 4.83)", () => {
    expect(ev("TRIMMEAN(x, 0.2)", X)).toBe(5);             // floor(8*0.2/2)=0 → mean of all = 40/8
  });

  it("PERCENTRANK interpolates + truncates (formula path == PercentrankNode)", () => {
    expect(ev("PERCENTRANK(x, 4)", { x: [1.5, 2.5, 3.5, 10.25] })).toBe(0.691);
    expect(ev("PERCENTRANK(x, 4)", X)).toBe(0.142);        // duplicates → first occurrence, truncated
  });
});

// The full scalar-math sweep (node vs Formula.js) caught value bugs in Formula.js that
// the registry now overrides so the formula path matches Excel + the visual node.
describe("scalar-math — formula path overrides Formula.js where it's wrong", () => {
  const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
  it("MOD takes the divisor's sign (Excel); Formula.js gets it wrong", () => {
    expect(ev("MOD(10, -3)")).toBe(-2);   // FX gives -1
    expect(ev("MOD(-10, -3)")).toBe(-1);  // FX gives 4
    expect(ev("MOD(10, 3)")).toBe(1);
  });
  it("ATAN2 follows Excel's (x, y) order = atan2(y, x); Formula.js does not", () => {
    expect(ev("ATAN2(3, 2)")).toBeCloseTo(Math.atan2(2, 3), 9); // FX gives atan2(3,2)
  });
  it("a domain miss tags #DOMAIN! instead of going blank (LN/LOG10/SQRTPI/ASIN/ACOS/ATANH)", () => {
    for (const expr of ["LN(-1)", "LOG10(0)", "SQRTPI(-1)", "ASIN(2)", "ACOS(2)", "ATANH(1)"]) {
      const r = ev(expr);
      expect(isSolError(r) && (r as SolError).code).toBe("#DOMAIN!");
    }
  });
  it("MOD / QUOTIENT by zero is #DIV/0!", () => {
    expect(isSolError(ev("MOD(5, 0)")) && (ev("MOD(5, 0)") as SolError).code).toBe("#DIV/0!");
    expect(isSolError(ev("QUOTIENT(5, 0)")) && (ev("QUOTIENT(5, 0)") as SolError).code).toBe("#DIV/0!");
  });

  it("CONVERT uses our unit system (handles C->F, which Formula.js can't)", () => {
    expect(ev('CONVERT(100, "C", "F")', {})).toBeCloseTo(212, 6);
    expect(ev('CONVERT(1, "m", "ft")', {})).toBeCloseTo(3.280839895, 6);
    expect(isSolError(ev('CONVERT(1, "m", "kg")', {}))).toBe(true); // cross-category → #N/A
  });

  it("cashflow functions pass the list whole (range functions), matching the nodes", () => {
    const cf = { c: [-1000, 300, 400, 500, 200] };
    expect(ev("NPV(0.1, c)", cf)).toBeCloseTo(105.0599, 3);
    expect(ev("IRR(c)", cf)).toBeCloseTo(0.15322, 4);
    expect(ev("MIRR(c, 0.1, 0.12)", cf)).toBeCloseTo(0.13903, 4);
  });

  it("XLOOKUP / XMATCH (exact match) work in a formula — Formula.js lacks them", () => {
    const env = { k: 20, ks: [10, 20, 30], vs: [100, 200, 300] };
    expect(ev("XLOOKUP(k, ks, vs)", env)).toBe(200);
    expect(ev("XMATCH(k, ks)", env)).toBe(2);
    expect(ev("XLOOKUP(99, ks, vs, -1)", env)).toBe(-1);           // if-not-found
    expect(isSolError(ev("XMATCH(99, ks)", env))).toBe(true);      // no match → #N/A
  });

  it("DOTTED function names parse + resolve (the tokenizer + namespace walk)", () => {
    // Previously these THREW: the tokenizer split on '.', and Formula.js hides them
    // behind namespaced objects. Now both the parser and resolveExcelFunction handle dots.
    expect(ev("STDEV.S(x)", { x: [2, 4, 4, 4, 5, 5, 7, 9] })).toBeCloseTo(2.13809, 4);
    expect(ev("PERCENTILE.INC(x, 0.5)", { x: [1, 2, 3, 4, 5] })).toBe(3);
    expect(ev("RANK.EQ(4, x)", { x: [1, 2, 3, 4, 5] })).toBe(2);
    expect(ev("NORM.DIST(0, 0, 1, 1)", {})).toBe(0.5);
  });

  it("date-returning functions emit our SERIAL (a number), not a Formula.js Date object", () => {
    const serial = ev("DATE(2026, 3, 15)");           // 2026-03-15
    expect(typeof serial).toBe("number");
    expect(serial).toBe(46096);
    expect(ev("EDATE(DATE(2026, 3, 15), 2)")).toBe(46157);    // 2026-05-15, still a number
    expect(typeof ev("DATEVALUE(\"2026-03-15\")")).toBe("number");
  });
});

describe("the duplicate-registration guard (FX-4's registry half)", () => {
  it("a second claim on a live name throws instead of silently overwriting", () => {
    registerInternal("GUARDTESTNAME", () => 1);
    expect(() => registerInternal("GUARDTESTNAME", () => 2)).toThrow(/Duplicate formula registration/);
    unregisterInternal("GUARDTESTNAME");
    // A REVOCABLE name may return after withdrawal — the pack-rebuild path.
    expect(() => registerInternal("GUARDTESTNAME", () => 3)).not.toThrow();
    unregisterInternal("GUARDTESTNAME");
  });
});
