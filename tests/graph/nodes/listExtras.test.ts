// [[B11]]
import { describe, it, expect } from "vitest";
import { CrossNode, SpectrumNode } from "../../../src/graph/nodes/list";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { isSolError, solError } from "../../../src/graph/errorValue";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const shiftList = (x: unknown[], by: number, wrap: boolean) => ev("SHIFT(x, by, wrap)", { x, by, wrap });
const pctChangeList = (x: unknown[]) => ev("PCTCHANGE(x)", { x }) as unknown[];
const zscoreList = (x: unknown[]) => ev("ZSCORE(x)", { x });
const binIndex = (x: unknown[], b: unknown[]) => ev("BIN(x, b)", { x, b });
const combinationsOf = (x: unknown[], k: number, mode: "combinations" | "permutations") => ev(`${mode.toUpperCase()}(x, k)`, { x, k });
const crossProduct = (a: unknown[], b: unknown[]) => ev("CROSSPRODUCT(a, b)", { a, b });
const polyfitEval = (x: unknown[], y: unknown[], d: number) => ev("POLYFIT(x, y, d)", { x, y, d });

describe("shiftList (Shift / lag-lead / roll)", () => {
  it("shifts right, vacated slots blank", () => {
    expect(shiftList([1, 2, 3, 4], 1, false)).toEqual([null, 1, 2, 3]);
  });
  it("shifts left with a negative offset", () => {
    expect(shiftList([1, 2, 3, 4], -1, false)).toEqual([2, 3, 4, null]);
  });
  it("wrap keeps every element (numpy.roll)", () => {
    expect(shiftList([1, 2, 3, 4], 1, true)).toEqual([4, 1, 2, 3]);
  });
});

describe("pctChangeList (Percent Change)", () => {
  it("fractional change, one shorter, #DIV/0! from a zero base", () => {
    expect(pctChangeList([100, 110, 99])).toEqual([0.1, (99 - 110) / 110]);
    const z = pctChangeList([0, 5]);
    expect(isSolError(z[0]) && (z[0] as { code: string }).code).toBe("#DIV/0!");
  });
});

describe("zscoreList (Z-Score / standardize)", () => {
  it("centers on the mean, scales by population stdev; a flat list → zeros", () => {
    expect(zscoreList([1, 2, 3])).toEqual([-1.224744871391589, 0, 1.224744871391589]);
    expect(zscoreList([5, 5, 5])).toEqual([0, 0, 0]);
  });
});

describe("binIndex (Bin / findInterval)", () => {
  it("counts breakpoints cleared: 0 below the first, n above the last", () => {
    expect(binIndex([-1, 0, 5, 10, 20], [0, 10])).toEqual([0, 1, 1, 2, 2]);
  });
});

describe("combinationsOf (itertools combinations / permutations)", () => {
  it("combinations are order-independent; permutations are ordered", () => {
    expect(combinationsOf([1, 2, 3], 2, "permutations")).toEqual([[1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2]]);
    expect(combinationsOf([1, 2], 3, "combinations")).toEqual([]); // k > n
  });
});

describe("Tier-2/3 kernels (gradient / ewma / trapz / convolve / cross / rle / polyfit)", () => {
  it("cross product of two 3-vectors; wrong length is #SHAPE!", () => {
    expect(new CrossNode().data({ a: [[1, 0, 0]], b: [[0, 1, 0]] }).result).toEqual([0, 0, 1]);
    const bad = crossProduct([1, 2], [3, 4]);
    expect(isSolError(bad) && (bad as { code: string }).code).toBe("#SHAPE!");
  });
  it("polyfit pairs x with y BY POSITION — a blank on one side drops that pair, never shifts it — and the result stays position-aligned with x", () => {
    // y = 2x; a blank x at slot 1 must NOT pair x=3 with y=2 (the old present-numbers compaction did).
    const fitted = polyfitEval([1, null, 3, 4], [2, 4, 6, 8], 1) as (number | null)[];
    expect(fitted).toHaveLength(4);
    expect(fitted[1]).toBeNull();
    [0, 2, 3].forEach((i) => expect(fitted[i]).toBeCloseTo([2, 4, 6, 8][i], 8));
    // A blank y drops the pair from the fit but its x still gets a fitted value.
    const fitted2 = polyfitEval([1, 2, 3], [2, null, 6], 1) as (number | null)[];
    expect(fitted2[1]).toBeCloseTo(4, 8);
  });
});



describe("closed formula-only gaps — GROWTH and ORDINAL now have nodes", () => {
  it("GROWTH is Forecast's exponential op; ORDINAL is Spell Number's ordinal mode", async () => {
    const { ForecastNode } = await import("../../../src/graph/nodes/stats");
    const { SpellNumberNode } = await import("../../../src/graph/nodes/text");
    const growth = new ForecastNode({ op: "exponential" }).data({ x: [[4]], ys: [[2, 4, 8]], xs: [[1, 2, 3]] }).result as number[];
    expect(growth[0]).toBeCloseTo(16, 5);
    expect(new SpellNumberNode({ mode: "ordinal" }).data({ value: [22] }).result).toBe("22nd");
    // and the formulas still dispatch to the same result
    expect((ev("GROWTH(y, x, nx)", { y: [2, 4, 8], x: [1, 2, 3], nx: [4] }) as number[])[0]).toBeCloseTo(16, 5);
    expect(ev("ORDINAL(113)")).toBe("113th");
  });
});

describe("formulas dispatch (non-Excel, numpy/pandas-style)", () => {
  it("PCTCHANGE / ZSCORE / BIN / SHIFT / COMBINATIONS / PERMUTATIONS", () => {
    expect(ev("PCTCHANGE(x)", { x: [10, 20, 30] })).toEqual([1, 0.5]);
    expect(ev("ZSCORE(x)", { x: [2, 4] })).toEqual([-1, 1]);
    expect(ev("BIN(x, b)", { x: [3, 7, 12], b: [5, 10] })).toEqual([0, 1, 2]);
    expect(ev("SHIFT(x, 1)", { x: [1, 2, 3] })).toEqual([null, 1, 2]);
    expect(ev("SHIFT(x, 1, TRUE)", { x: [1, 2, 3] })).toEqual([3, 1, 2]); // the node's wrap mode, same capability
    expect(ev("COMBINATIONS(x, 2)", { x: [1, 2, 3] })).toEqual([[1, 2], [1, 3], [2, 3]]);
    expect(ev("PERMUTATIONS(x, 2)", { x: [1, 2] })).toEqual([[1, 2], [2, 1]]);
  });
  it("GRADIENT / EWMA / TRAPZ / CONVOLVE / CROSSPRODUCT / RLE / POLYFIT / ISCLOSE", () => {
    expect(ev("GRADIENT(x)", { x: [1, 2, 4, 7] })).toEqual([1, 1.5, 2.5, 3]);
    expect(ev("EWMA(x, 0.5)", { x: [1, 2, 3] })).toEqual([1, 1.5, 2.25]);
    expect(ev("TRAPZ(x)", { x: [0, 1, 2, 3] })).toBe(4.5);
    expect(ev("CONVOLVE(a, b)", { a: [1, 2], b: [1, 1] })).toEqual([1, 3, 2]);
    expect(ev("CROSSPRODUCT(a, b)", { a: [1, 0, 0], b: [0, 1, 0] })).toEqual([0, 0, 1]);
    expect(ev("RLE(x)", { x: [1, 1, 2] })).toEqual([[1, 2], [2, 1]]);
    expect(ev("ISCLOSE(1, 1.0000001, 0.001)")).toBe(true);
  });
});

describe("Spectrum propagates an error ([[E10]] pickVsAggregateErrors)", () => {
  const div0 = solError("#DIV/0!", "x");
  it("an error cell in the signal is the whole answer, on the node and in SPECTRUM", () => {
    const node = new SpectrumNode().data({ list: [[1, div0 as never, 3, 4]] }).result;
    expect(isSolError(node) && (node as { code: string }).code).toBe("#DIV/0!");
    const f = ev("SPECTRUM(x)", { x: [1, div0, 3, 4] });
    expect(isSolError(f) && (f as { code: string }).code).toBe("#DIV/0!");
  });
});
