import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";
import { isSolError } from "./errorValue";
import { tTestP, fTestP } from "./nodes/mathUtils";

// ─── Pins from the 2026-07-28 adversarial review of the formulaNaming formula work ─────
// Each block pins a defect the review confirmed live. The common theme: the
// formula surface fabricating an answer (or corrupting its inputs) in cases
// where the NODE under the same name behaves.

const ev = (expr: string, env: Record<string, unknown> = {}) => {
  const f = compileEvaluator(expr);
  expect(f, `failed to compile: ${expr}`).not.toBeNull();
  return f!(env);
};

describe("Formula.js may not mutate the graph's own arrays", () => {
  it("CHISQ.TEST leaves its argument lists untouched", () => {
    // FX.CHISQ.TEST rebuilds its ranges element-by-element IN PLACE; unprotected,
    // one evaluation turned the upstream node's cached [10,20,…] into [[10],[20],…]
    // for every other consumer of that cable.
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

  it("F.TEST returns the two-tailed p-value, not the variance ratio", () => {
    const p = ev("F.TEST(a, b)", { a, b }) as number;
    expect(p).toBeCloseTo(fTestP(a, b)!, 12);
    // The old FX passthrough returned v1/v2 = 0.25 here; the p-value is not that.
    expect(p).not.toBeCloseTo(0.25, 6);
  });

  it("T.TEST dispatches on type: 1 = paired, 2 = pooled, 3 = Welch", () => {
    const p1 = ev("T.TEST(a, b, 2, 1)", { a, b }) as number;
    const p2 = ev("T.TEST(a, b, 2, 2)", { a, b }) as number;
    const p3 = ev("T.TEST(a, b, 2, 3)", { a, b }) as number;
    expect(p1).toBeCloseTo(tTestP("paired", a, b)!, 12);
    expect(p2).toBeCloseTo(tTestP("equal-var", a, b)!, 12);
    expect(p3).toBeCloseTo(tTestP("unequal-var", a, b)!, 12);
    // The three kinds genuinely differ on this data — the old FX impl returned
    // one number for all of them.
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
    // Omitted upper limit = exactly lower (Excel).
    expect(ev("PROB(x, p, 2)", { x: [1, 2, 3], p: [0.2, 0.3, 0.5] })).toBeCloseTo(0.3, 12);
  });
});

describe("a wired-blank SCALAR argument propagates through a whole-arg native", () => {
  const x = [1, 2, 3];

  // (RUNNINGSUM's blank-window case lived here until the per-op RUNNING* names were
  // replaced by RUNNING(op, list, [window]) — the blank-window contract on THAT
  // spelling is pinned in formulaTier3.test.ts, and on the node: list.test.ts "a wired blank window leaves the
  // result unknown".)

  it("CONTAINS(list, blank) is blank — a blank needle can't be looked for", () => {
    expect(ev("CONTAINS(x, v)", { x: [1, null, 3], v: null })).toBeNull();
  });

  it("SLICE / NTHELEMENT / PADLEFT with a blank scalar are blank", () => {
    expect(ev("SLICE(x, s)", { x, s: null })).toBeNull();
    expect(ev("NTHELEMENT(x, n)", { x, n: null })).toBeNull();
    expect(ev("PADLEFT(x, n, 0)", { x, n: null })).toBeNull();
  });

  it("the exemptions still work: FILLVALUE(list, blank) fills with missing", () => {
    expect(ev("FILLVALUE(x, v)", { x: [1, null, 3], v: null })).toEqual([1, null, 3]);
  });
});

describe("position-preserving cell contract in the extracted list core", () => {
  // The two RUNNING* cases here moved to the node when the formula names were removed
  // (list.test.ts: "max ignores a missing cell", "a per-cell error lands in exactly the
  // windows that contain it"). The list CORE they exercised is shared, so the contract
  // is still covered — just from its only remaining surface.

  it("DIFF with a missing neighbour yields a missing difference", () => {
    expect(ev("DIFF(x)", { x: [1, null, 3] })).toEqual([null, null]);
  });

  it("SERIESSUM keeps a blank coefficient IN PLACE as zero, never shifting powers", () => {
    // a₁x⁰ + a₂x¹ + a₃x²  with x=2, a=[1,null,3]: 1 + 0 + 12 = 13.
    // The pooled null-drop once computed 1 + 3·2¹ = 7.
    expect(ev("SERIESSUM(2, 0, 1, a)", { a: [1, null, 3] })).toBeCloseTo(13, 12);
  });

  it("INTERPOLATE drops an incomplete known pair instead of fabricating x=0", () => {
    // known x [1, null, 3] / y [10, 20, 30]: the (null, 20) pair drops; querying
    // 0.5 clamps below x=1 → 10. The raw cast once answered 15 via a fake (0,20).
    expect(ev("INTERPOLATE(y, x, q)", { y: [10, 20, 30], x: [1, null, 3], q: [0.5] })).toEqual([10]);
  });
});

describe("generators overflow loudly", () => {
  it("RANGE past MAX_GENERATED is #OVERFLOW!, not a silent 1000-element truncation", () => {
    const r = ev("RANGE(0, 2000000)");
    expect(isSolError(r) && r.code).toBe("#OVERFLOW!");
  });

  it("RANGE with step 0 is a loud error, not an empty list", () => {
    const r = ev("RANGE(0, 5, 0)");
    expect(isSolError(r)).toBe(true);
  });
});

describe("REGEX* take Excel's documented arguments", () => {
  it("REGEXTEST third argument is case_sensitivity (1 = insensitive), not a JS flag string", () => {
    expect(ev('REGEXTEST("Apple", "apple", 1)')).toBe(1);
    expect(ev('REGEXTEST("Apple", "apple", 0)')).toBe(0);
    expect(ev('REGEXTEST("Apple", "apple")')).toBe(0);
    const bad = ev('REGEXTEST("Apple", "apple", 7)');
    expect(isSolError(bad) && bad.code).toBe("#VALUE!");
  });

  it("REGEXEXTRACT return_mode: 0 first, 1 all, 2 capture groups", () => {
    expect(ev('REGEXEXTRACT("a1b2", "[0-9]")')).toBe("1");
    expect(ev('REGEXEXTRACT("a1b2", "[0-9]", 1)')).toEqual(["1", "2"]);
    expect(ev('REGEXEXTRACT("a1b2", "([a-z])([0-9])", 2)')).toEqual(["a", "1"]);
    const bad = ev('REGEXEXTRACT("a1b2", "[0-9]", 3)');
    expect(isSolError(bad) && bad.code).toBe("#VALUE!");
  });

  it("REGEXREPLACE occurrence replaces only the nth match", () => {
    expect(ev('REGEXREPLACE("a1b2c3", "[0-9]", "_")')).toBe("a_b_c_");
    expect(ev('REGEXREPLACE("a1b2c3", "[0-9]", "_", 2)')).toBe("a1b_c3");
    expect(ev('REGEXREPLACE("a1b2c3", "[0-9]", "_", 9)')).toBe("a1b2c3");
  });
});

describe("legacy redirects point at Microsoft's actual replacements", () => {
  it("TINV → T.INV.2T and TDIST → T.DIST.RT (not the different-shaped T.INV/T.DIST)", () => {
    const tinv = ev("TINV(0.05, 10)");
    expect(isSolError(tinv) && tinv.message).toBe("Use T.INV.2T");
    const tdist = ev("TDIST(2, 10, 2)");
    expect(isSolError(tdist) && tdist.message).toBe("Use T.DIST.RT");
  });
});
