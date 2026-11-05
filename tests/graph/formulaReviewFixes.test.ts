// [[B16]] oneFormulaSurface, [[formula-language#The dispatch ladder]], [[formula-language#Whole-list natives]], [[formula-language#Range functions]], [[formula-language#Statistics]], [[formula-language#Lists]], [[formula-language#Text]]
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";

const ev = (expr: string, env: Record<string, unknown> = {}) => {
  const f = compileEvaluator(expr);
  expect(f, `failed to compile: ${expr}`).not.toBeNull();
  return f!(env);
};

describe("Formula.js may not mutate the graph's own arrays", () => {
  it("CHISQ.TEST leaves its argument lists untouched", () => {
    const a = [10, 20, 30, 40];
    const b = [12, 18, 32, 38];
    ev("CHISQ.TEST(a, b)", { a, b });
    expect(a).toEqual([10, 20, 30, 40]);
    expect(b).toEqual([12, 18, 32, 38]);
  });
});

describe("the statistical tests answer what the NODE answers", () => {
  const a = [1, 2, 3, 4, 5];
  const b = [2, 4, 6, 8, 10];
  // F = 0.25 on (4, 4) degrees of freedom: 2 · I₀.₂(2, 2) = 2 · (3·0.2² − 2·0.2³).
  const F_TEST_P = 0.208;
  const T_TEST_P = { paired: 0.01323559956368281, pooled: 0.09434977284242141, welch: 0.10753119493061636 };

  it("F.TEST returns the two-tailed p-value, not the variance ratio", () => {
    const p = ev("F.TEST(a, b)", { a, b }) as number;
    expect(p).toBeCloseTo(F_TEST_P, 12);
    expect(p).not.toBeCloseTo(0.25, 6);
  });

  it("T.TEST dispatches on type: 1 = paired, 2 = pooled, 3 = Welch", () => {
    const p1 = ev("T.TEST(a, b, 2, 1)", { a, b }) as number;
    const p2 = ev("T.TEST(a, b, 2, 2)", { a, b }) as number;
    const p3 = ev("T.TEST(a, b, 2, 3)", { a, b }) as number;
    expect(p1).toBeCloseTo(T_TEST_P.paired, 12);
    expect(p2).toBeCloseTo(T_TEST_P.pooled, 12);
    expect(p3).toBeCloseTo(T_TEST_P.welch, 12);
    expect(p1).not.toBeCloseTo(p2, 6);
  });

  it("T.TEST honors tails: one-tailed is half the two-tailed p", () => {
    const p2 = ev("T.TEST(a, b, 2, 2)", { a, b }) as number;
    const p1 = ev("T.TEST(a, b, 1, 2)", { a, b }) as number;
    expect(p1).toBeCloseTo(p2 / 2, 12);
  });

  it("T.TEST rejects an out-of-range type or tails loudly", () => {
    const r = ev("T.TEST(a, b, 2, 4)", { a, b });
    expect(isSolError(r) && r.code).toBe("#DOMAIN!");
    const r2 = ev("T.TEST(a, b, 3, 1)", { a, b });
    expect(isSolError(r2) && r2.code).toBe("#DOMAIN!");
  });

  it("PROB pairs values with probabilities and skips missing pairs", () => {
    expect(ev("PROB(x, p, 1, 2)", { x: [1, 2, 3], p: [0.2, 0.3, 0.5] })).toBeCloseTo(0.5, 12);
    expect(ev("PROB(x, p, 2)", { x: [1, 2, 3], p: [0.2, 0.3, 0.5] })).toBeCloseTo(0.3, 12);
  });
});

describe("a wired-blank SCALAR argument propagates through a whole-arg native", () => {
  const x = [1, 2, 3];

  it("CONTAINS(list, blank) is blank — a blank needle can't be looked for", () => {
    expect(ev("CONTAINS(x, v)", { x: [1, null, 3], v: null })).toBeNull();
  });

  it("SLICE / NTHELEMENT / PADLEFT with a blank setting have no default, so #SYNTAX! ([[D86]] blankRoles)", () => {
    for (const f of ["SLICE(x, s)", "NTHELEMENT(x, s)", "PADLEFT(x, s, 0)"]) {
      const r = ev(f, { x, s: null });
      expect(isSolError(r) && r.code, f).toBe("#SYNTAX!");
    }
  });

  it("the exemptions still work: FILLVALUE(list, blank) fills with missing", () => {
    expect(ev("FILLVALUE(x, v)", { x: [1, null, 3], v: null })).toEqual([1, null, 3]);
  });
});

describe("position-preserving cell contract in the extracted list core", () => {
  it("DIFF with a missing neighbour yields a missing difference", () => {
    expect(ev("DIFF(x)", { x: [1, null, 3] })).toEqual([null, null]);
  });

  it("SERIESSUM keeps a blank coefficient IN PLACE as zero, never shifting powers", () => {
    // a₁x⁰ + a₂x¹ + a₃x² with x=2, a=[1,null,3]: 1 + 0 + 12 = 13.
    expect(ev("SERIESSUM(2, 0, 1, a)", { a: [1, null, 3] })).toBeCloseTo(13, 12);
  });

  it("INTERPOLATE drops an incomplete known pair instead of fabricating x=0", () => {
    // The (null, 20) pair drops, and 0.5 clamps below x=1 to 10.
    expect(ev("INTERPOLATE(y, x, q)", { y: [10, 20, 30], x: [1, null, 3], q: [0.5] })).toEqual([10]);
  });

  it("INTERPOLATE never reads a text known y as a number, nor joins it as text ([[C10]] socketLattice)", () => {
    expect(ev("INTERPOLATE(y, x, 1.5)", { y: [5, 7], x: [1, 2] })).toBe(6);
    expect(ev("INTERPOLATE(y, x, 1.5)", { y: ["5", 7], x: [1, 2] })).toMatchObject({ code: "#VALUE!", message: "INTERPOLATE: known_ys need numbers" });
  });
});

describe("generators overflow loudly", () => {
  it("RANGE with step 0 is a loud error, not an empty list", () => {
    const r = ev("RANGE(0, 5, 0)");
    expect(isSolError(r)).toBe(true);
  });
});

describe("REGEX* take Excel's documented arguments", () => {
  it("REGEXTEST third argument is case_sensitivity (1 = insensitive), not a JS flag string", () => {
    expect(ev('REGEXTEST("Apple", "apple", 1)')).toBe(true);
    expect(ev('REGEXTEST("Apple", "apple", 0)')).toBe(false);
    expect(ev('REGEXTEST("Apple", "apple")')).toBe(false);
    const bad = ev('REGEXTEST("Apple", "apple", 7)');
    expect(isSolError(bad) && bad.code).toBe("#VALUE!");
  });
});
