import { describe, it, expect } from "vitest";
import { compileEvaluator, RANGE_FUNCTIONS } from "../../src/graph/excelFormula";
import { ForecastNode, LinestNode } from "../../src/graph/nodes/stats";

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

describe("a range RESULT classifies non-finite — the last bare-NaN producer (guardFinite)", () => {
  // broadcastCall has always classified its results; the RANGE branch returned
  // dispatch results raw, so every degenerate whole-sample call leaked a bare
  // NaN into the graph — where it renders as an empty cell and poisons nothing
  // visibly (the exact silent class classifyNonFinite exists for). The 2026-07-28 producer
  // sweep probed the kernels (clean — they carry their own conventions: quiet
  // null, tagged errors, IMDIV's cx(NaN,NaN)) and found the leak HERE.
  const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
  const codeOf = (v: unknown) => (v as { code?: string })?.code;

  /** The probe battery: whole-sample calls whose degenerate input made
   *  Formula.js / the internal stats answer bare NaN. Each now answers what its NODE
   *  answers (statsOps is the one kernel): "not enough data" is a BLANK (the
   *  Aggregate/Running rule), zero variance under a division is #DIV/0!, a log-domain
   *  failure is #DOMAIN! — and never a bare NaN. */
  const DEGENERATE: Array<[string, string, Record<string, unknown>, string | null]> = [
    ["STDEV of one value", "STDEV(x)", { x: [5] }, null],
    ["VAR of one value", "VAR(x)", { x: [5] }, null],
    ["CORREL of a constant", "CORREL(a, b)", { a: [1, 1, 1], b: [1, 2, 3] }, "#DIV/0!"],
    ["SLOPE of constant xs", "SLOPE(y, x)", { y: [1, 2], x: [3, 3] }, "#DIV/0!"],
    ["RSQ of constants", "RSQ(y, x)", { y: [1, 1], x: [1, 1] }, "#DIV/0!"],
    ["SKEW below n=3", "SKEW(x)", { x: [1, 2] }, null],
    ["KURT below n=4", "KURT(x)", { x: [1, 2, 3] }, null],
    ["GEOMEAN of a negative", "GEOMEAN(x)", { x: [-4, 9] }, "#DOMAIN!"],
    ["Z.TEST of a constant", "Z.TEST(x, 1)", { x: [1, 1, 1] }, "#DOMAIN!"],
  ];
  it.each(DEGENERATE)("%s → the node's answer, never bare NaN", (_label, expr, env, code) => {
    const r = ev(expr, env);
    expect(typeof r === "number" && Number.isNaN(r), "bare NaN leaked").toBe(false);
    if (code === null) expect(r).toBeNull();
    else expect(codeOf(r)).toBe(code);
  });

  it("a first-class ∞ INPUT still passes through (the Constant node's ∞)", () => {
    expect(ev("SUM(x)", { x: [Infinity, 1] })).toBe(Infinity);
  });
  it("a deliberate quiet-null stays a null, not an error (tTestP's undefined test)", () => {
    expect(ev("T.TEST(a, b, 2, 1)", { a: [1, 1], b: [1, 1] })).toBeNull();
  });
});

describe("the regression quartet — owned, not routed (the last DEFERRED closed)", () => {
  // The former DEFERRED list. Like UNIQUE/SORT/TRANSPOSE before them, the fix
  // shape is OWNERSHIP (a listArgs registration over the nodes' fitting kernels,
  // hideMatrixFromVendor), not RANGE_FUNCTIONS routing — so membership there stays false, and the
  // shape checks below are what "fixed" means: one fitted answer, never a
  // broadcast echo of the input.
  const QUARTET = ["TREND", "GROWTH", "LINEST", "LOGEST"];
  const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
  const XS = [1, 2, 3, 4];
  const YS = [3, 5, 7, 9];        // exactly 2x + 1
  const EXP = [2, 4, 8, 16];      // exactly 2·2ˣ⁻¹ → m = 2, b = 1

  it.each(QUARTET)("%s is owned (listArgs), not range-routed", (name) => {
    expect(RANGE_FUNCTIONS.has(name), `${name} entered RANGE_FUNCTIONS — it is owned, not routed`).toBe(false);
  });

  it("TREND / GROWTH stay callable as formulas; Forecast is the node", () => {
    // The formulas are unchanged: an omitted new_xs still defaults to the known xs.
    expect(ev("TREND(y, x, n)", { y: YS, x: XS, n: [5, 6] })).toEqual([11, 13]);
    expect(ev("TREND(y, x)", { y: YS, x: XS })).toEqual(YS);
    expect(ev("TREND(y)", { y: YS })).toEqual(YS);
    // The NODE mirrors the query's shape; an unwired X predicts nothing (not at 0).
    expect(new ForecastNode().data({ ys: [YS], xs: [XS] }).result).toBeNull();
    expect(new ForecastNode().data({ x: [[5, 6]], ys: [YS], xs: [XS] }).result).toEqual([11, 13]);
    // A scalar X → a scalar prediction; the exponential op fits y = b·mˣ (GROWTH).
    expect(new ForecastNode().data({ x: [5], ys: [YS], xs: [XS] }).result).toBe(11);
    expect(new ForecastNode({ op: "exponential" }).data({ x: [5], ys: [EXP], xs: [XS] }).result as number)
      .toBeCloseTo(32, 10);
  });

  it("GROWTH is TREND in log space", () => {
    const out = ev("GROWTH(y, x, n)", { y: EXP, x: XS, n: [5] }) as number[];
    expect(out).toHaveLength(1);
    expect(out[0]).toBeCloseTo(32, 10);
    expect((ev("GROWTH(y)", { y: EXP }) as number[])[3]).toBeCloseTo(16, 10);
  });

  it("LINEST matches the node's three outputs as [slope, intercept, r²]", () => {
    const node = new LinestNode();
    const nodeOut = node.data({ ys: [YS], xs: [XS] });
    expect(ev("LINEST(y, x)", { y: YS, x: XS }))
      .toEqual([nodeOut.slope, nodeOut.intercept, nodeOut.r2]);
    expect(ev("LINEST(y, x)", { y: YS, x: XS })).toEqual([2, 1, 1]);
    // Degenerate fit (zero X variance) → null, the node's null outputs.
    expect(ev("LINEST(y, x)", { y: YS, x: [2, 2, 2, 2] })).toBeNull();
  });

  it("LOGEST is the Fit card's exponential op — m, b on the slope/intercept sockets", () => {
    const node = new LinestNode({ op: "exponential" });
    const out = node.data({ ys: [EXP], xs: [XS] });
    const fx = ev("LOGEST(y, x)", { y: EXP, x: XS }) as number[];
    expect(out.slope as number).toBeCloseTo(fx[0], 10);     // m
    expect(out.intercept as number).toBeCloseTo(fx[1], 10); // b
    expect(out.slope as number).toBeCloseTo(2, 10);
    expect(out.intercept as number).toBeCloseTo(1, 10);
    // An exact exponential fits perfectly → log-scale R² = 1.
    expect(out.r2 as number).toBeCloseTo(1, 10);
    // y ≤ 0: the formula keeps Excel's quiet empty; the node yields three nulls.
    expect(ev("LOGEST(y, x)", { y: [1, -1, 2, 3], x: XS })).toEqual([]);
    const bad = node.data({ ys: [[1, -1, 2, 3]], xs: [XS] });
    expect([bad.slope, bad.intercept, bad.r2]).toEqual([null, null, null]);
  });

  it("the value model rides through: a cell error propagates, a null pair drops", () => {
    const err = { __solError: true, code: "#DIV/0!", message: "x" };
    const r = ev("LINEST(y, x)", { y: [3, err, 7], x: [1, 2, 3] });
    expect((r as { code?: string }).code).toBe("#DIV/0!");
    // [1,3]/[3,7] after the null pair drops — still the exact 2x + 1 line.
    expect(ev("LINEST(y, x)", { y: [3, null, 7], x: [1, 2, 3] })).toEqual([2, 1, 1]);
  });
});
