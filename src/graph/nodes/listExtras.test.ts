import { describe, it, expect } from "vitest";
import { shiftList, pctChangeList, zscoreList, binIndex } from "./listOps";
import { ShiftNode, PctChangeNode, ZScoreNode, BinNode } from "./list";
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
  it("the node computes it", () => {
    expect(new PctChangeNode().data({ list: [[10, 20]] }).result).toEqual([1]);
  });
});

describe("zscoreList (Z-Score / standardize)", () => {
  it("centers on the mean, scales by population stdev; a flat list → zeros", () => {
    expect(zscoreList([1, 2, 3])).toEqual([-1.224744871391589, 0, 1.224744871391589]);
    expect(zscoreList([5, 5, 5])).toEqual([0, 0, 0]);
  });
  it("the node computes it", () => {
    expect((new ZScoreNode().data({ list: [[2, 4]] }).result as number[])).toEqual([-1, 1]);
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

describe("formulas dispatch (non-Excel, numpy/pandas-style)", () => {
  it("PCTCHANGE / ZSCORE / BIN / SHIFT", () => {
    expect(ev("PCTCHANGE(x)", { x: [10, 20, 30] })).toEqual([1, 0.5]);
    expect(ev("ZSCORE(x)", { x: [2, 4] })).toEqual([-1, 1]);
    expect(ev("BIN(x, b)", { x: [3, 7, 12], b: [5, 10] })).toEqual([0, 1, 2]);
    expect(ev("SHIFT(x, 1)", { x: [1, 2, 3] })).toEqual([null, 1, 2]);
  });
});
