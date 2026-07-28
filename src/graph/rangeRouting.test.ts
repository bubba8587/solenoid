import { describe, it, expect } from "vitest";
import { compileEvaluator, RANGE_FUNCTIONS } from "./excelFormula";

// ─── Range routing: the SHAPE guard ───────────────────────────────────────────
// `RANGE_FUNCTIONS` is hand-kept, and a function missing from it fails SILENTLY in the
// worst way: `broadcastCall` maps it element-wise over the array argument, so it runs
// N times on N scalars and returns a list of N answers to a question that has one.
// Nothing looked wrong — T.TEST returned `[{},{},{},{}]`, F.TEST the same, MODE.SNGL
// echoed its own input back — because every one of them is a plausible-looking value.
//
// This is the check that would have caught them: give a whole-sample function real
// arrays and assert the RESULT IS NOT SHAPED LIKE THE INPUT. It is deliberately about
// shape, not value — the numbers are Formula.js's business, the routing is ours.

const A = [1, 2, 3, 4];
const B = [2, 3, 4, 6];
const P = [0.1, 0.2, 0.3, 0.4];

/** Whole-sample functions: arrays in, ONE number out. */
const SCALAR_RESULT: Array<[string, string]> = [
  ["T.TEST", "T.TEST(a, b, 2, 3)"],
  ["F.TEST", "F.TEST(a, b)"],
  ["Z.TEST", "Z.TEST(a, 2)"],
  ["CHISQ.TEST", "CHISQ.TEST(a, b)"],
  ["SUMX2MY2", "SUMX2MY2(a, b)"],
  ["SUMX2PY2", "SUMX2PY2(a, b)"],
  ["SUMXMY2", "SUMXMY2(a, b)"],
  ["MODE.SNGL", "MODE.SNGL(a)"],
  ["PROB", "PROB(a, p, 1, 3)"],
  ["SERIESSUM", "SERIESSUM(2, 1, 1, a)"],
  // The long-standing members, kept here so the guard covers the whole set rather
  // than just the additions — a regression in routing would break these identically.
  ["SUM", "SUM(a)"],
  ["CORREL", "CORREL(a, b)"],
  ["SUMPRODUCT", "SUMPRODUCT(a, b)"],
  ["TRIMMEAN", "TRIMMEAN(a, 0.2)"],
  ["NPV", "NPV(0.1, a)"],
];

describe("whole-sample functions are range-routed, not broadcast", () => {
  it.each(SCALAR_RESULT)("%s returns one answer, not one per element", (name, expr) => {
    expect(RANGE_FUNCTIONS.has(name), `${name} is missing from RANGE_FUNCTIONS`).toBe(true);
    const r = compileEvaluator(expr)!({ a: A, b: B, p: P });
    expect(Array.isArray(r), `${name} broadcast: ${JSON.stringify(r)}`).toBe(false);
    expect(typeof r, `${name} answered a ${typeof r}`).toBe("number");
    expect(Number.isFinite(r as number), `${name} answered ${r}`).toBe(true);
  });

  it("the broadcast failure mode is what it looks like when it regresses", () => {
    // A genuinely element-wise function SHOULD map over an array — this is the
    // behaviour the functions above were wrongly getting, shown working correctly so
    // the distinction is on the record rather than implied.
    expect(compileEvaluator("SQRT(a)")!({ a: [1, 4, 9] })).toEqual([1, 2, 3]);
  });
});

describe("array-RETURNING range functions — the known remaining gap", () => {
  // Documented at RANGE_FUNCTIONS: these need list-model handling of their own (they
  // are written against a 2-D range and don't treat a plain 1-D list as a vector), so
  // they are NOT routed yet. Pinned here so the gap is a recorded state rather than an
  // oversight — when one is fixed, move it into SCALAR_RESULT or its own shape case.
  // TRANSPOSE left this list with the D23 matrix tranche — owned (matrixArgs +
  // listArgs), not range-routed, which is the post-D23 shape of the fix (FX-9).
  const DEFERRED = ["TREND", "GROWTH", "LINEST", "LOGEST", "FREQUENCY", "MODE.MULT", "UNIQUE", "SORT", "FILTER"];

  it.each(DEFERRED)("%s is still unrouted", (name) => {
    expect(RANGE_FUNCTIONS.has(name), `${name} is now routed — move it out of DEFERRED`).toBe(false);
  });
});
