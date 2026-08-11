import { describe, it, expect } from "vitest";
import {
  extractVariables,
  compilePositional,
  compileEvaluator,
  RANGE_FUNCTIONS,
  formulaToLatex,
  evaluateSteps,
} from "./excelFormula";
import { isSolError, solError } from "./errorValue";

describe("extractVariables", () => {
  it("collects bare names in first-appearance order", () => {
    expect(extractVariables("a * b + 1")).toEqual(["a", "b"]);
    expect(extractVariables("price * qty - price")).toEqual(["price", "qty"]);
  });

  it("dedupes repeated names", () => {
    expect(extractVariables("x + x * x")).toEqual(["x"]);
  });

  it("does not treat function names as variables", () => {
    expect(extractVariables("SQRT(a) + SIN(b)")).toEqual(["a", "b"]);
    expect(extractVariables("PI()")).toEqual([]);
  });

  it("does not treat TRUE/FALSE as variables", () => {
    expect(extractVariables("IF(TRUE, a, b)")).toEqual(["a", "b"]);
  });

  it("does not treat math constants (pi/tau/e/phi) as variables", () => {
    expect(extractVariables("2 * pi")).toEqual([]);
    expect(extractVariables("PI + tau")).toEqual([]);
    expect(extractVariables("e ^ x")).toEqual(["x"]);
    expect(extractVariables("phi * r")).toEqual(["r"]);
  });

  it("returns [] for empty or unparseable input", () => {
    expect(extractVariables("")).toEqual([]);
    expect(extractVariables("   ")).toEqual([]);
    expect(extractVariables("a +")).toEqual([]);
    expect(extractVariables("@#$")).toEqual([]);
  });

  it("collects names inside nested calls", () => {
    expect(extractVariables("MAX(a, MIN(b, c))")).toEqual(["a", "b", "c"]);
  });
});

describe("compilePositional (the one evaluation core — scalar semantics pinned here since the codegen retirement)", () => {
  const evalF = (expr: string, params: string[], ...args: number[]) => {
    const fn = compilePositional(expr, params);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn(...args);
  };

  it("evaluates basic arithmetic with Excel precedence", () => {
    expect(evalF("a + b", ["a", "b"], 2, 3)).toBe(5);
    expect(evalF("a * b + 1", ["a", "b"], 2, 3)).toBe(7);
    expect(evalF("a + b * c", ["a", "b", "c"], 2, 3, 4)).toBe(14);
    expect(evalF("(a + b) * c", ["a", "b", "c"], 2, 3, 4)).toBe(20);
  });

  it("evaluates math constants without an input", () => {
    expect(evalF("2 * pi", [])).toBeCloseTo(6.283185, 5);
    expect(evalF("e", [])).toBeCloseTo(Math.E, 10);
    expect(evalF("tau", [])).toBeCloseTo(2 * Math.PI, 10);
    expect(evalF("phi", [])).toBeCloseTo((1 + Math.sqrt(5)) / 2, 10);
    // case-insensitive, and mixes with real variables
    expect(evalF("PI * r ^ 2", ["r"], 2)).toBeCloseTo(Math.PI * 4, 10);
  });

  it("treats ^ as exponentiation, left-associative", () => {
    expect(evalF("a ^ b", ["a", "b"], 2, 10)).toBe(1024);
    // left-assoc: (2^3)^2 = 64, not 2^(3^2)=512
    expect(evalF("2 ^ 3 ^ 2", [])).toBe(64);
  });

  it("handles unary minus and percent postfix", () => {
    expect(evalF("-a", ["a"], 5)).toBe(-5);
    expect(evalF("50%", [])).toBe(0.5);
    expect(evalF("a * 10%", ["a"], 200)).toBeCloseTo(20);
  });

  it("dispatches Excel functions through Formula.js", () => {
    expect(evalF("SQRT(a)", ["a"], 16)).toBe(4);
    expect(evalF("ABS(a)", ["a"], -7)).toBe(7);
    expect(evalF("PI()", [])).toBeCloseTo(Math.PI);
    expect(evalF("MAX(a, b, c)", ["a", "b", "c"], 1, 9, 4)).toBe(9);
  });

  it("evaluates comparisons to booleans", () => {
    const fn = compilePositional("a > b", ["a", "b"]);
    expect(fn!(3, 2)).toBe(true as unknown as number);
    expect(fn!(1, 2)).toBe(false as unknown as number);
  });

  it("uses = for equality and <> for inequality", () => {
    expect(compilePositional("a = b", ["a", "b"])!(2, 2)).toBe(true as unknown as number);
    expect(compilePositional("a <> b", ["a", "b"])!(2, 3)).toBe(true as unknown as number);
  });

  it("returns null on parse error", () => {
    expect(compilePositional("a +", ["a"])).toBeNull();
    expect(compilePositional("", [])).toBeNull();
  });

  it("throws at call time on unknown function", () => {
    const fn = compilePositional("NOTAREALFN(a)", ["a"]);
    expect(fn).not.toBeNull();
    expect(() => fn!(1)).toThrow(/Unknown function/);
  });

  it("supports string concatenation with &", () => {
    const fn = compilePositional('a & "x"', ["a"]);
    expect(fn!(5)).toBe("5x" as unknown as number);
  });
});

describe("formulaToLatex", () => {
  it("renders fractions for division", () => {
    expect(formulaToLatex("a / b")).toBe("\\frac{a}{b}");
  });

  it("renders sqrt and abs specially", () => {
    expect(formulaToLatex("SQRT(x)")).toBe("\\sqrt{x}");
    expect(formulaToLatex("ABS(x)")).toBe("\\left|x\\right|");
  });

  it("maps greek-named variables to symbols", () => {
    expect(formulaToLatex("alpha")).toBe("\\alpha");
    expect(formulaToLatex("phi")).toBe("\\varphi");
  });

  it("subscripts trailing digits and underscores", () => {
    expect(formulaToLatex("x_1")).toBe("x_{1}");
    expect(formulaToLatex("v2")).toBe("v_{2}");
    expect(formulaToLatex("x_long")).toBe("x_{{long}}");
  });

  it("wraps lower-precedence subexpressions in parens", () => {
    expect(formulaToLatex("(a + b) * c")).toContain("\\left(");
  });

  it("returns null for unparseable input", () => {
    expect(formulaToLatex("a +")).toBeNull();
  });

  it("renders a string literal as KaTeX-safe text (no \\textquotedbl)", async () => {
    const tex = formulaToLatex('(0.1 + 0.2) & " kg"');
    expect(tex).toContain('\\text{" kg"}'); // literal quotes, space preserved
    expect(tex).not.toContain("textquotedbl");
    // And KaTeX must actually accept it — the old \textquotedbl form threw/garbled.
    const katex = (await import("katex")).default;
    expect(() => katex.renderToString(tex!, { throwOnError: true })).not.toThrow();
  });

  it("escapes LaTeX specials inside a string literal", async () => {
    const tex = formulaToLatex('"a_b {c} 50%"');
    expect(tex).toBe('\\text{"a\\_b \\{c\\} 50\\%"}');
    const katex = (await import("katex")).default;
    expect(() => katex.renderToString(tex!, { throwOnError: true })).not.toThrow();
  });

  it("renders trig functions with backslash prefix", () => {
    expect(formulaToLatex("SIN(x)")).toBe("\\sin\\!\\left(x\\right)");
    expect(formulaToLatex("COS(x)")).toBe("\\cos\\!\\left(x\\right)");
    expect(formulaToLatex("ATAN(x)")).toBe("\\atan\\!\\left(x\\right)");
  });

  it("renders POWER(a,b) as exponent", () => {
    expect(formulaToLatex("POWER(a, 2)")).toBe("a^{2}");
  });

  it("renders EXP(a) as e^{a}", () => {
    expect(formulaToLatex("EXP(a)")).toBe("e^{a}");
  });

  it("renders PI() as \\pi", () => {
    expect(formulaToLatex("PI()")).toBe("\\pi");
  });

  it("renders LN with \\ln prefix", () => {
    expect(formulaToLatex("LN(x)")).toBe("\\ln\\!\\left(x\\right)");
  });

  it("renders LOG as \\log", () => {
    expect(formulaToLatex("LOG(x)")).toBe("\\log\\!\\left(x\\right)");
  });

  it("renders comparison operators as LaTeX symbols", () => {
    expect(formulaToLatex("a <> b")).toContain("\\ne");
    expect(formulaToLatex("a <= b")).toContain("\\le");
    expect(formulaToLatex("a >= b")).toContain("\\ge");
  });

  it("renders percent postfix as \\%", () => {
    expect(formulaToLatex("50%")).toBe("50\\%");
  });

  it("renders boolean literals", () => {
    expect(formulaToLatex("TRUE")).toBe("\\mathrm{TRUE}");
    expect(formulaToLatex("FALSE")).toBe("\\mathrm{FALSE}");
  });

  it("renders scientific notation", () => {
    expect(formulaToLatex("1e6")).toBe("10^{6}");
    expect(formulaToLatex("2.5e3")).toBe("2.5 \\times 10^{3}");
  });

  it("renders ^ as exponent", () => {
    expect(formulaToLatex("a ^ 2")).toBe("a^{2}");
  });

  it("renders * as cdot", () => {
    expect(formulaToLatex("a * b")).toBe("a \\cdot b");
  });

  it("renders multi-argument calls with comma separation", () => {
    expect(formulaToLatex("MAX(a, b)")).toBe("\\operatorname{MAX}\\!\\left(a,\\, b\\right)");
  });

  it("renders long variable names as mathrm", () => {
    expect(formulaToLatex("rate")).toBe("\\mathrm{rate}");
  });
});

describe("evaluateSteps", () => {
  it("returns a step and value for a simple binary op", () => {
    const result = evaluateSteps("a + b", { a: 2, b: 3 });
    expect(result).not.toBeNull();
    expect(result!.value).toBe(5);
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0].latex).toContain("= 5");
  });

  it("emits steps in execution order (inner before outer)", () => {
    const result = evaluateSteps("a * b + c", { a: 2, b: 3, c: 4 });
    expect(result).not.toBeNull();
    expect(result!.value).toBe(10);
    expect(result!.steps).toHaveLength(2);
    // first step: the multiplication
    expect(result!.steps[0].latex).toContain("= 6");
    // second step: the addition
    expect(result!.steps[1].latex).toContain("= 10");
  });

  it("deduplicates identical sub-expressions", () => {
    // a*b appears twice; the step for it should only be emitted once
    const result = evaluateSteps("a * b + a * b", { a: 2, b: 3 });
    expect(result).not.toBeNull();
    expect(result!.value).toBe(12);
    // one step for 2*3, one step for 6+6
    expect(result!.steps).toHaveLength(2);
  });

  it("uses math constants without an input variable", () => {
    const result = evaluateSteps("2 * pi", {});
    expect(result).not.toBeNull();
    expect(result!.value).toBeCloseTo(2 * Math.PI, 5);
    expect(result!.steps).toHaveLength(1);
  });

  it("defaults a missing variable to 0", () => {
    const result = evaluateSteps("a + b", { a: 5 });
    expect(result).not.toBeNull();
    expect(result!.value).toBe(5);
  });

  it("emits a step for function calls", () => {
    const result = evaluateSteps("SQRT(a)", { a: 16 });
    expect(result).not.toBeNull();
    expect(result!.value).toBe(4);
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0].latex).toContain("= 4");
  });

  it("handles percent postfix", () => {
    const result = evaluateSteps("a + 50%", { a: 2 });
    // 50% alone emits no step; the + emits one
    expect(result).not.toBeNull();
    expect(result!.value).toBeCloseTo(2.5, 10);
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0].latex).toContain("= 2.5");
  });

  it("handles unary minus", () => {
    const result = evaluateSteps("-a + b", { a: 3, b: 10 });
    expect(result).not.toBeNull();
    expect(result!.value).toBe(7);
  });

  it("returns null for a lone variable (no steps emitted)", () => {
    expect(evaluateSteps("a", { a: 5 })).toBeNull();
  });

  it("returns null for a lone number literal (no steps emitted)", () => {
    expect(evaluateSteps("42", {})).toBeNull();
  });

  it("returns null for a string concatenation (& op)", () => {
    expect(evaluateSteps('a & "x"', { a: 1 })).toBeNull();
  });

  it("returns null for a non-finite result (division by zero)", () => {
    expect(evaluateSteps("a / b", { a: 1, b: 0 })).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(evaluateSteps("a +", {})).toBeNull();
    expect(evaluateSteps("", {})).toBeNull();
  });

  it("handles exponentiation", () => {
    const result = evaluateSteps("a ^ 2", { a: 3 });
    expect(result).not.toBeNull();
    expect(result!.value).toBe(9);
    expect(result!.steps).toHaveLength(1);
  });

  it("handles comparison ops, returning 1 or 0", () => {
    const trueResult = evaluateSteps("a > b", { a: 5, b: 3 });
    expect(trueResult).not.toBeNull();
    expect(trueResult!.value).toBe(1);

    const falseResult = evaluateSteps("a > b", { a: 1, b: 3 });
    expect(falseResult).not.toBeNull();
    expect(falseResult!.value).toBe(0);
  });

  it("rounds displayed numbers to 6 significant figures", () => {
    const result = evaluateSteps("pi + 0", {});
    // 0 is a literal, pi is a constant; "pi + 0" emits one step
    expect(result).not.toBeNull();
    // cleanNum(Math.PI) → 6 sig figs → "3.14159"
    expect(result!.steps[0].latex).toContain("3.14159");
  });
});

describe("compileEvaluator — array-aware (broadcast vs aggregate per call site)", () => {
  const ev = (expr: string, env: Record<string, unknown> = {}) => {
    const fn = compileEvaluator(expr);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn(env);
  };

  it("returns null on a parse error (mirrors compilePositional)", () => {
    expect(compileEvaluator("a +")).toBeNull();
    expect(compileEvaluator("")).toBeNull();
  });

  // ── scalar parity with the codegen path (strict-superset) ──
  it("evaluates scalar arithmetic with Excel precedence", () => {
    expect(ev("a + b * c", { a: 2, b: 3, c: 4 })).toBe(14);
    expect(ev("(a + b) * c", { a: 2, b: 3, c: 4 })).toBe(20);
    expect(ev("2 ^ 3 ^ 2")).toBe(64); // left-assoc
    expect(ev("-a", { a: 5 })).toBe(-5);
    expect(ev("50%")).toBe(0.5);
  });

  it("resolves math constants without a variable", () => {
    expect(ev("2 * pi")).toBeCloseTo(2 * Math.PI, 10);
  });

  it("keeps operator semantics identical to js() (=, <>, &)", () => {
    expect(ev("a = b", { a: 2, b: 2 })).toBe(true);
    expect(ev("a <> b", { a: 2, b: 3 })).toBe(true);
    expect(ev('a & "x"', { a: 5 })).toBe("5x");
  });

  it("& / CONCAT / TEXTJOIN format numbers at 15 sig digits (no float noise)", () => {
    // The headline: 0.1+0.2 = 0.30000000000000004, but printed into text → "0.3".
    expect(ev('(0.1 + 0.2) & " kg"')).toBe("0.3 kg");
    expect(ev('CONCAT(0.1 + 0.2, " kg")')).toBe("0.3 kg");
    expect(ev('CONCATENATE(0.1 + 0.2, " kg")')).toBe("0.3 kg");
    expect(ev('TEXTJOIN("-", TRUE, 0.1 + 0.2, 3)')).toBe("0.3-3");
    // A clean value is untouched; a boolean still renders TRUE/FALSE.
    expect(ev('42 & ""')).toBe("42");
    expect(ev('(1 = 1) & "!"')).toBe("TRUE!");
  });

  it("dispatches scalar functions through Formula.js", () => {
    expect(ev("SQRT(a)", { a: 16 })).toBe(4);
    expect(ev("MAX(a, b, c)", { a: 1, b: 9, c: 4 })).toBe(9);
  });

  // ── element-wise broadcast (unchanged from the old broadcaster) ──
  it("broadcasts an operator element-wise over a list × scalar", () => {
    expect(ev("a * b", { a: [1, 2, 3], b: 10 })).toEqual([10, 20, 30]);
  });

  it("broadcasts a non-range function element-wise over a list", () => {
    expect(ev("SQRT(x)", { x: [4, 9, 16] })).toEqual([2, 3, 4]);
  });

  it("zips ragged lists to the longest, padding with null (the settled P3 policy)", () => {
    expect(ev("a + b", { a: [1, 2, 3], b: [10, 20] })).toEqual([11, 22, null]);
    // A LENGTH-1 list broadcasts — the other half of the same P3 ruling
    // ("length-1 still broadcasts"), unbuilt until D23's mapCells and formerly
    // pinned here as [11, null, null], i.e. the test enforced the gap.
    expect(ev("a + b", { a: [1], b: [10, 20, 30] })).toEqual([11, 21, 31]);
  });

  it("pads ragged args to a broadcast function with null (missing in, missing out)", () => {
    expect(ev("MOD(a, b)", { a: [10, 20, 30], b: [3, 7] })).toEqual([1, 6, null]);
  });

  // ── the headline: range functions aggregate a list (P1/P2) ──
  it("aggregates a list with a range function instead of mapping it", () => {
    expect(ev("SUM(x)", { x: [1, 2, 3, 4] })).toBe(10);
    expect(ev("AVERAGE(x)", { x: [2, 4, 6] })).toBe(4);
    expect(ev("MAX(x)", { x: [3, 9, 1] })).toBe(9);
  });

  it("computes x / SUM(x) — the same var whole AND element-wise", () => {
    expect(ev("x / SUM(x)", { x: [1, 3, 4] })).toEqual([0.125, 0.375, 0.5]);
  });

  it("mixes a scalar aggregate into an element-wise expression", () => {
    expect(ev("x - AVERAGE(x)", { x: [1, 2, 3] })).toEqual([-1, 0, 1]);
  });

  it("passes scalar + array args whole to a range function (LARGE)", () => {
    expect(ev("LARGE(x, 2)", { x: [5, 1, 9, 3] })).toBe(5);
  });

  it("composes two aggregates over the same list", () => {
    expect(ev("SUM(x) + MAX(x)", { x: [1, 2, 3, 4] })).toBe(14); // 10 + 4
    expect(ev("COUNT(x)", { x: [1, 2, 3, 4] })).toBe(4);
  });

  it("reduces a list with logical range functions (AND/OR)", () => {
    expect(ev("AND(x)", { x: [1, 1, 1] })).toBe(true);
    expect(ev("AND(x)", { x: [1, 0, 1] })).toBe(false);
    expect(ev("OR(x)", { x: [0, 0, 1] })).toBe(true);
  });

  it("classifies the common aggregators as range functions", () => {
    for (const f of ["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "MEDIAN", "STDEV", "AND", "OR"]) {
      expect(RANGE_FUNCTIONS.has(f)).toBe(true);
    }
    // element-wise functions are NOT range functions
    for (const f of ["SQRT", "ABS", "ROUND", "UPPER", "IF"]) {
      expect(RANGE_FUNCTIONS.has(f)).toBe(false);
    }
  });

  it("classifies + aggregates the criteria/meta range functions", () => {
    for (const f of ["SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS", "AVERAGEIF",
                     "AVERAGEIFS", "MAXIFS", "MINIFS", "SUBTOTAL", "AGGREGATE"]) {
      expect(RANGE_FUNCTIONS.has(f)).toBe(true);
    }
    // the range arg passes WHOLE (would be wrong if broadcast element-wise)
    expect(ev('COUNTIF(x, ">2")', { x: [1, 2, 3, 4] })).toBe(2);
    expect(ev('SUMIF(x, ">2")', { x: [1, 2, 3, 4] })).toBe(7);
    expect(ev("SUBTOTAL(9, x)", { x: [1, 2, 3, 4] })).toBe(10);
  });

  // ── in-formula errors (P5) — div0 is minted + propagates as a scalar ──
  it("tags scalar division by zero as #DIV/0!", () => {
    const r = ev("1 / 0");
    expect(isSolError(r) && r.code).toBe("#DIV/0!");
    const r2 = ev("a / b", { a: 5, b: 0 });
    expect(isSolError(r2) && r2.code).toBe("#DIV/0!");
  });

  it("propagates a div-by-zero error up through a scalar chain", () => {
    const r = ev("1 / 0 + 5");
    expect(isSolError(r) && r.code).toBe("#DIV/0!");
    const r2 = ev("SQRT(1 / 0)"); // our error surfaces rather than vanishing into NaN
    expect(isSolError(r2) && r2.code).toBe("#DIV/0!");
  });

  it("leaves a div-by-zero INSIDE a list as a non-scalar element (cleaned at the boundary)", () => {
    // The evaluator yields an error element here; the host node maps it to NaN.
    // What matters: the whole result is NOT a scalar SolError.
    const r = ev("1 / x", { x: [1, 0, 2] });
    expect(Array.isArray(r)).toBe(true);
    expect(isSolError(r)).toBe(false);
  });

  // The shared P5 boundary (excelFunctions.normalizeFxResult): a top-level Formula.js
  // Error return becomes a tagged SolError, so EVERY formula host (not just Expression)
  // surfaces it like #DIV/0! instead of leaking a raw Error object.
  it("maps a top-level Formula.js error return to a tagged SolError", () => {
    const na = ev("NA()"); // FX returns an Error #N/A
    expect(isSolError(na) && na.code).toBe("#N/A");
    const dom = ev("ASIN(2)"); // FX returns an Error #NUM! → split to #DOMAIN!
    expect(isSolError(dom) && dom.code).toBe("#DOMAIN!");
  });

  it("still lets Formula.js IFERROR catch an in-formula FX error (only the FINAL result is mapped)", () => {
    // The normalization is at the TOP-level boundary only — an FX Error inside the
    // formula still flows natively so Formula.js's own IFERROR catches it.
    expect(ev("IFERROR(NA(), 42)")).toBe(42);
  });
});

// ── v1.0 audit fixes: the range-arg null/error policy, the IFERROR family, and
// the classic lookup functions (findings 2, 8, 9, 10, 28-formula-half) ──────────

describe("range functions honor the aggregator policy (audit P0-2)", () => {
  const ev = (expr: string, env: Record<string, unknown> = {}) => {
    const fn = compileEvaluator(expr);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn(env);
  };
  const err = solError("#DIV/0!", "boom");

  it("an error inside a list propagates out of SUM/MEDIAN/TEXTJOIN", () => {
    for (const expr of ["SUM(x)", "MEDIAN(x)", 'TEXTJOIN(",", TRUE, x)']) {
      const r = ev(expr, { x: [1, err, 3] });
      expect(isSolError(r) && r.code).toBe("#DIV/0!");
    }
  });

  it("null (missing) is skipped, not treated as 0", () => {
    expect(ev("SUM(x)", { x: [1, null, 3] })).toBe(4);
    expect(ev("MEDIAN(x)", { x: [1, null, 3] })).toBe(2); // was 1 (null→0)
    expect(ev("AVERAGE(x)", { x: [2, null, 4] })).toBe(3);
    expect(ev("MIN(x)", { x: [5, null, 7] })).toBe(5);
  });

  it("COUNT family stays raw (COUNTBLANK needs the nulls)", () => {
    expect(ev("COUNT(x)", { x: [1, null, 3] })).toBe(2);
    expect(ev("COUNTBLANK(x)", { x: [1, null, 3] })).toBe(1);
  });

  it("paired ranges drop null rows PAIRWISE (alignment preserved)", () => {
    // null at index 1 removes the pair (null, 20) — not a shifted zip
    expect(ev("SUMPRODUCT(a, b)", { a: [1, null, 3], b: [10, 20, 30] })).toBe(100);
  });

  it("positional lookups keep nulls in place (match positions stable)", () => {
    expect(ev("XMATCH(3, x)", { x: [1, null, 3] })).toBe(3);
  });
});

describe("IFERROR family catches Solenoid-minted errors (audit finding 8)", () => {
  const ev = (expr: string, env: Record<string, unknown> = {}) => {
    const fn = compileEvaluator(expr);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn(env);
  };
  const na = solError("#N/A", "not found");
  const div = solError("#DIV/0!", "boom");

  it("IFERROR catches a minted #DIV/0!", () => {
    expect(ev("IFERROR(a / b, 99)", { a: 1, b: 0 })).toBe(99);
    expect(ev("IFERROR(a / b, 99)", { a: 6, b: 2 })).toBe(3);
  });

  it("ISERROR / ISNA / ISERR classify a wired-in SolError", () => {
    expect(ev("ISERROR(x)", { x: div })).toBe(true);
    expect(ev("ISERROR(x)", { x: 5 })).toBe(false);
    expect(ev("ISNA(x)", { x: na })).toBe(true);
    expect(ev("ISNA(x)", { x: div })).toBe(false);
    expect(ev("ISERR(x)", { x: div })).toBe(true);
    expect(ev("ISERR(x)", { x: na })).toBe(false);
  });

  it("IFNA catches only #N/A", () => {
    expect(ev("IFNA(x, 0)", { x: na })).toBe(0);
    const r = ev("IFNA(x, 0)", { x: div });
    expect(isSolError(r) && r.code).toBe("#DIV/0!"); // passes through uncaught
  });

  it("works element-wise over a list with per-cell errors", () => {
    expect(ev("IFERROR(x, 0)", { x: [1, div, 3] })).toEqual([1, 0, 3]);
    expect(ev("ISERROR(x)", { x: [1, div, 3] })).toEqual([false, true, false]);
  });

  it("IFERROR(XLOOKUP(...), default) — the composed case", () => {
    expect(ev('IFERROR(XLOOKUP(9, k, v), "none")', { k: [1, 2], v: ["a", "b"] })).toBe("none");
  });

  it("ERROR.TYPE returns the Excel code number, #N/A on a non-error", () => {
    expect(ev("ERROR.TYPE(x)", { x: div })).toBe(2);
    expect(ev("ERROR.TYPE(x)", { x: na })).toBe(7);
    const r = ev("ERROR.TYPE(x)", { x: 5 });
    expect(isSolError(r) && r.code).toBe("#N/A");
  });
});

describe("NOW/TODAY return serials in formulas (audit finding 9)", () => {
  const ev = (expr: string) => {
    const fn = compileEvaluator(expr);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn({});
  };

  it("TODAY() is an integer serial and YEAR(TODAY()) works", () => {
    const t = ev("TODAY()");
    expect(typeof t).toBe("number");
    expect(Number.isInteger(t)).toBe(true);
    expect(ev("YEAR(TODAY())")).toBe(new Date().getUTCFullYear());
  });

  it("NOW() is a number with a time fraction and NOW()+1 is numeric", () => {
    const n = ev("NOW()");
    expect(typeof n).toBe("number");
    expect(ev("NOW() + 1")).toBeCloseTo((n as number) + 1, 4);
  });
});

describe("classic lookups redirect to their current-Excel replacements (D10)", () => {
  const ev = (expr: string, env: Record<string, unknown> = {}) => {
    const fn = compileEvaluator(expr);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn(env);
  };

  it("VLOOKUP / HLOOKUP / LOOKUP → #NAME? 'Use XLOOKUP'", () => {
    for (const expr of ["VLOOKUP(2, x, 1)", "HLOOKUP(2, x, 1)", "LOOKUP(2, x)"]) {
      const r = ev(expr, { x: [1, 2, 3] });
      expect(isSolError(r) && r.code).toBe("#NAME?");
      expect(isSolError(r) && r.message).toBe("Use XLOOKUP");
    }
  });

  it("MATCH → #NAME? 'Use XMATCH'", () => {
    const r = ev("MATCH(30, x, 0)", { x: [10, 20, 30] });
    expect(isSolError(r) && r.code).toBe("#NAME?");
    expect(isSolError(r) && r.message).toBe("Use XMATCH");
  });

  it("INDEX stays (current Excel, never superseded)", () => {
    expect(ev("INDEX(x, 2)", { x: ["a", "b", "c"] })).toBe("b");
    const past = ev("INDEX(x, 9)", { x: [1, 2] });
    expect(isSolError(past) && past.code).toBe("#REF!");
    // 0 is Excel's WHOLE-axis form, not an error — the node's rule, now shared.
    expect(ev("INDEX(x, 0)", { x: [1, 2] })).toEqual([1, 2]);
  });

  it("COLUMN / ROW → #NAME? 'Use INDEX'", () => {
    // Excel's answer a cell reference's position; this graph has no cell
    // references, and INDEX's whole-axis form is the accessor that replaces them.
    for (const expr of ["COLUMN(x, 1)", "ROW(x, 1)"]) {
      const r = ev(expr, { x: [1, 2, 3] });
      expect(isSolError(r) && r.code, expr).toBe("#NAME?");
      expect(isSolError(r) && r.message, expr).toBe("Use INDEX");
    }
  });

  it("XLOOKUP / XMATCH text matching is case-insensitive (Excel default)", () => {
    expect(ev('XLOOKUP("Apple", k, v)', { k: ["apple", "pear"], v: [1, 2] })).toBe(1);
    expect(ev('XMATCH("PEAR", k)', { k: ["apple", "pear"] })).toBe(2);
  });
});

describe("P6 operator parity — the settled table (audit finding 26)", () => {
  const ev = (expr: string, env: Record<string, unknown> = {}) => {
    const fn = compileEvaluator(expr);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn(env);
  };

  it("= / <> are type-strict with case-insensitive text", () => {
    expect(ev('a = "A"', { a: "a" })).toBe(true);
    expect(ev('a <> "A"', { a: "a" })).toBe(false);
    expect(ev('a = "5"', { a: 5 })).toBe(false); // no cross-type coercion
  });

  it("cross-type ordering is #TYPE!, text orders by collation", () => {
    const r = ev('a < "b"', { a: 5 });
    expect(isSolError(r) && r.code).toBe("#TYPE!");
    expect(ev('a < b', { a: "apple", b: "banana" })).toBe(true);
  });

  it("& renders logicals TRUE/FALSE", () => {
    expect(ev('a & "x"', { a: true })).toBe("TRUEx");
  });

  it("null propagates through arithmetic, comparison and &", () => {
    expect(ev("a + 5", { a: null })).toBeNull();
    expect(ev("a > 2", { a: null })).toBeNull();
    expect(ev('a & "x"', { a: null })).toBeNull();
  });

  it("logicals ride the number bridge in arithmetic (TRUE = 1)", () => {
    expect(ev("a + 1", { a: true })).toBe(2);
  });

  it("a per-cell error propagates unmorphed through an operator broadcast", () => {
    const err = solError("#DIV/0!", "boom");
    const r = ev("x + 1", { x: [1, err, 3] }) as unknown[];
    expect(r[0]).toBe(2);
    expect(isSolError(r[1]) && (r[1] as { code: string }).code).toBe("#DIV/0!");
    expect(r[2]).toBe(4);
  });
});

describe("formula hosts pass booleans through (audit finding 27)", () => {
  const ev = (expr: string, env: Record<string, unknown> = {}) => {
    const fn = compileEvaluator(expr);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn(env);
  };
  it("a > b evaluates to a real boolean at the evaluator level", () => {
    expect(ev("a > b", { a: 3, b: 2 })).toBe(true);
  });
});

describe("TEXT formats date serials (audit finding 29)", () => {
  const ev = (expr: string, env: Record<string, unknown> = {}) => {
    const fn = compileEvaluator(expr);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn(env);
  };
  it("a date-shaped format code converts the serial", () => {
    // serial for 2026-03-15
    expect(ev('TEXT(a, "yyyy-mm-dd")', { a: 46096 })).toBe("2026-03-15");
  });
  it("numeric codes pass through to Formula.js untouched", () => {
    expect(ev('TEXT(a, "0.00")', { a: 1234.5 })).toBe("1234.50");
  });
});

describe("omitted arguments — IF(x,,y) is a BLANK (author 2026-07-16)", () => {
  const ev = (expr: string, env: Record<string, unknown>) => {
    const fn = compileEvaluator(expr);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn(env);
  };
  it("an empty middle argument evaluates to null (blank), not a syntax error", () => {
    expect(ev("IF(value=0,,value)", { value: 0 })).toBeNull();
    expect(ev("IF(value=0,,value)", { value: 7 })).toBe(7);
  });
  it("an empty TRAILING argument works too", () => {
    expect(ev("IF(value>0,value,)", { value: 5 })).toBe(5);
    expect(ev("IF(value>0,value,)", { value: -1 })).toBeNull();
  });
  it("broadcasts over a list — the Excel zeros-to-blanks idiom", () => {
    expect(ev("IF(value=0,,value)", { value: [3, 0, 5] })).toEqual([3, null, 5]);
  });
  it("a blank inside an aggregate is skipped like any missing value", () => {
    expect(ev("SUM(a,,b)", { a: 2, b: 3 })).toBe(5);
  });
  it("extractVariables ignores blanks", () => {
    expect(extractVariables("IF(x=0,,x)")).toEqual(["x"]);
  });
});
