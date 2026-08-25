import { describe, it, expect } from "vitest";
import { shiftList, pctChangeList, zscoreList, binIndex } from "./listOps";
import { ShiftNode, DiffNode, NormalizeNode, BinNode, CombinationsNode, EwmaNode, ConvolveNode, CrossNode, PolyfitNode, TrapzNode, RleNode } from "./list";
import { BetweenNode, IsCloseNode } from "./logic";
import { combinationsOf, gradientList, ewmaList, trapzList, convolveList, crossProduct, rleEncode, polyfitEval } from "./listOps";
import { compileEvaluator } from "../excelFormula";
import { isSolError } from "../errorValue";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);

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
  it("the node reads its `by` literal and wrap toggle", () => {
    const n = new ShiftNode({ wrap: "wrap" });
    n.literals.by = 2;
    expect(n.data({ list: [[1, 2, 3, 4]] }).result).toEqual([3, 4, 1, 2]);
  });
});

describe("pctChangeList (Percent Change)", () => {
  it("fractional change, one shorter, #DIV/0! from a zero base", () => {
    expect(pctChangeList([100, 110, 99])).toEqual([0.1, (99 - 110) / 110]);
    const z = pctChangeList([0, 5]);
    expect(isSolError(z[0]) && (z[0] as { code: string }).code).toBe("#DIV/0!");
  });
  it("the DIFF node in percent mode computes it (merged, not a separate node)", () => {
    expect(new DiffNode({ mode: "percent" }).data({ list: [[10, 20]] }).result).toEqual([1]);
    expect(new DiffNode().data({ list: [[10, 20]] }).result).toEqual([10]); // default delta
  });
});

describe("zscoreList (Z-Score / standardize)", () => {
  it("centers on the mean, scales by population stdev; a flat list → zeros", () => {
    expect(zscoreList([1, 2, 3])).toEqual([-1.224744871391589, 0, 1.224744871391589]);
    expect(zscoreList([5, 5, 5])).toEqual([0, 0, 0]);
  });
  it("the Normalize node in z-score mode computes it (merged, not a separate node)", () => {
    expect((new NormalizeNode({ mode: "zscore" }).data({ list: [[2, 4]] }).result as number[])).toEqual([-1, 1]);
    expect((new NormalizeNode().data({ list: [[2, 4]] }).result as number[])).toEqual([0, 1]); // default minmax
  });
});

describe("binIndex (Bin / findInterval)", () => {
  it("counts breakpoints cleared: 0 below the first, n above the last", () => {
    expect(binIndex([-1, 0, 5, 10, 20], [0, 10])).toEqual([0, 1, 1, 2, 2]);
  });
  it("the node reads list + breaks", () => {
    expect(new BinNode().data({ list: [[3, 7, 12]], breaks: [[5, 10]] }).result).toEqual([0, 1, 2]);
  });
});

describe("combinationsOf (itertools combinations / permutations)", () => {
  it("combinations are order-independent; permutations are ordered", () => {
    expect(combinationsOf([1, 2, 3], 2, "combinations")).toEqual([[1, 2], [1, 3], [2, 3]]);
    expect(combinationsOf([1, 2, 3], 2, "permutations")).toEqual([[1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2]]);
    expect(combinationsOf([1, 2], 3, "combinations")).toEqual([]); // k > n
  });
  it("the node reads list + k and the mode", () => {
    const n = new CombinationsNode({ mode: "combinations" });
    n.literals.k = 2;
    expect(n.data({ list: [["a", "b", "c"]] }).result).toEqual([["a", "b"], ["a", "c"], ["b", "c"]]);
  });
});

describe("Tier-2/3 kernels (gradient / ewma / trapz / convolve / cross / rle / polyfit)", () => {
  it("gradient is central-difference interior, one-sided at the ends", () => {
    expect(gradientList([1, 2, 4, 7])).toEqual([1, 1.5, 2.5, 3]);
    // and it merged into the DIFF node as a 3rd mode
    expect(new DiffNode({ mode: "gradient" }).data({ list: [[1, 2, 4, 7]] }).result).toEqual([1, 1.5, 2.5, 3]);
  });
  it("ewma weights recent values by alpha; blanks carry forward", () => {
    expect(ewmaList([1, 2, 3], 0.5)).toEqual([1, 1.5, 2.25]);
    expect(new EwmaNode().data({ list: [[1, 2, 3]], alpha: [0.5] }).result).toEqual([1, 1.5, 2.25]);
  });
  it("trapz integrates by the trapezoidal rule", () => {
    expect(trapzList([0, 1, 2, 3], 1)).toBe(4.5);
    expect(new TrapzNode().data({ list: [[0, 1, 2, 3]], dx: [1] }).result).toBe(4.5);
  });
  it("convolve is the full sliding dot-product", () => {
    expect(convolveList([1, 2], [1, 1])).toEqual([1, 3, 2]);
    expect(new ConvolveNode().data({ a: [[1, 2]], b: [[1, 1]] }).result).toEqual([1, 3, 2]);
  });
  it("cross product of two 3-vectors; wrong length is #SHAPE!", () => {
    expect(crossProduct([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(new CrossNode().data({ a: [[1, 0, 0]], b: [[0, 1, 0]] }).result).toEqual([0, 0, 1]);
    const bad = crossProduct([1, 2], [3, 4]);
    expect(isSolError(bad) && (bad as { code: string }).code).toBe("#SHAPE!");
  });
  it("rle compresses runs into value/count rows", () => {
    expect(rleEncode([1, 1, 2, 2, 2, 3])).toEqual([[1, 2], [2, 3], [3, 1]]);
    expect(new RleNode().data({ list: [[1, 1, 2, 2, 2, 3]] }).result).toEqual([[1, 2], [2, 3], [3, 1]]);
  });
  it("polyfit fits exactly through points that lie on a degree-d curve", () => {
    const fitted = polyfitEval([0, 1, 2], [0, 1, 4], 2) as number[]; // y = x^2
    fitted.forEach((v, i) => expect(v).toBeCloseTo([0, 1, 4][i], 8));
    const node = new PolyfitNode(); node.literals.degree = 2;
    (node.data({ x: [[0, 1, 2]], y: [[0, 1, 4]] }).result as number[]).forEach((v, i) => expect(v).toBeCloseTo([0, 1, 4][i], 8));
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

describe("Between / Is-Close predicates", () => {
  it("Between is inclusive; Is-Close compares within a tolerance", () => {
    expect(new BetweenNode().data({ value: [5], lo: [1], hi: [10] }).result).toBe(true);
    expect(new BetweenNode().data({ value: [11], lo: [1], hi: [10] }).result).toBe(false);
    expect(new IsCloseNode().data({ a: [1], b: [1.0000001], tol: [1e-3] }).result).toBe(true);
    expect(new IsCloseNode().data({ a: [1], b: [2], tol: [1e-3] }).result).toBe(false);
  });
  it("both broadcast over a list (input rank matches the boolean-list output)", () => {
    expect(new BetweenNode().data({ value: [[0, 5, 11]], lo: [1], hi: [10] }).result).toEqual([false, true, false]);
    expect(new IsCloseNode().data({ a: [[1, 2]], b: [[1.0001, 5]], tol: [1e-2] }).result).toEqual([true, false]);
  });
});

describe("COUNTBLANK — Aggregate op that counts missing cells", () => {
  it("counts blanks from the raw list, even when every cell is blank", async () => {
    const { AggregateNode } = await import("./list");
    expect(new AggregateNode({ op: "countblank" }).data({ list: [[1, null, 3, null, null]] }).result).toBe(3);
    expect(new AggregateNode({ op: "countblank" }).data({ list: [[null, null]] }).result).toBe(2);
    expect(new AggregateNode({ op: "count" }).data({ list: [[1, null, 3]] }).result).toBe(2); // count still skips blanks
  });
});

describe("closed formula-only gaps — GROWTH and ORDINAL now have nodes", () => {
  it("GROWTH is Forecast's exponential op; ORDINAL is Spell Number's ordinal mode", async () => {
    const { ForecastNode } = await import("./stats");
    const { SpellNumberNode } = await import("./text");
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
