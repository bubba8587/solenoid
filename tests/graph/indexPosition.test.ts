// [[D85]] columnsStayColumns: a list is one row, walked by one Position; a one-row or one-column table walks too.
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { ListIndexNode } from "../../src/graph/nodes/list";
import { declaredTypeOf } from "../../src/graph/sockets";
import { buildFrame } from "../../src/graph/frame";
import { isSolError } from "../../src/graph/errorValue";

const ev = (e: string, env: Record<string, unknown> = {}) => compileEvaluator(e)!(env);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("INDEX on a single row or column, as Excel's", () => {
  it("one position walks a one-row table, a one-column table and a list", () => {
    expect(ev("INDEX(m, 2)", { m: [[10, 20, 30]] })).toBe(20);
    expect(ev("INDEX(c, 2)", { c: [[10], [20], [30]] })).toBe(20);
    expect(ev("INDEX(x, 2)", { x: [10, 20, 30] })).toBe(20);
    expect(ev("INDEX(TOCOL(m), 3)", { m: [[1, 2], [3, 4]] })).toBe(3);
    expect(ev("INDEX(g, 2)", { g: [[1, 2], [3, 4]] })).toEqual([3, 4]);
  });
});

describe("INDEX with several positions, as Excel's array arguments", () => {
  const m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
  it("answers once per position, shaped like the positions", () => {
    expect(ev("INDEX(x, p)", { x: [10, 20, 30], p: [1, 3] })).toEqual([10, 30]);
    expect(ev("INDEX(x, 1, p)", { x: [10, 20, 30], p: [1, 3] })).toEqual([10, 30]);
    expect(ev("INDEX(x, TOCOL(p))", { x: [10, 20, 30], p: [1, 3] })).toEqual([[10], [30]]);
    expect(ev("INDEX(m, p, 2)", { m, p: [1, 3] })).toEqual([2, 8]);
    expect(ev("INDEX(m, p, p)", { m, p: [1, 3] })).toEqual([1, 9]);
    expect(ev("INDEX(m, TOCOL(p), p)", { m, p: [1, 3] })).toEqual([[1, 3], [7, 9]]);
  });

  it("a list of rows or columns against a whole axis picks those rows or columns", () => {
    expect(ev("INDEX(m, p)", { m, p: [1, 3] })).toEqual([[1, 2, 3], [7, 8, 9]]);
    expect(ev("INDEX(m, 0, p)", { m, p: [1, 3] })).toEqual([[1, 3], [4, 6], [7, 9]]);
  });

  it("a blank position is skipped ([[E15]]), a bad one its error", () => {
    expect(ev("INDEX(x, p)", { x: [10, 20, 30], p: [1, null] })).toEqual([10]);
    const out = ev("INDEX(x, p)", { x: [10, 20, 30], p: [1, 9] }) as unknown[];
    expect(isSolError(out[1]) && out[1].code).toBe("#REF!");
  });
});

describe("the INDEX card swaps Row and Column for Position on a list", () => {
  it("a list swaps to Position, a table swaps back, and the typed number rides across", async () => {
    const n = new ListIndexNode();
    n.literals.index = 2;
    expect(Object.keys(n.inputs)).toEqual(["list", "index", "column"]);
    expect(n.data({ list: [[10, 20, 30]] }).result).toBe(20);
    await flush();
    expect(Object.keys(n.inputs)).toEqual(["list", "position"]);
    expect(n.inputs.position?.label).toBe("Position");
    expect(n.literals.position).toBe(2);
    expect(n.data({ list: [[10, 20, 30]] }).result).toBe(20);
    expect(n.data({ list: [[[1, 2], [3, 4]]] }).result).toEqual([3, 4]);
    await flush();
    expect(Object.keys(n.inputs)).toEqual(["list", "index", "column"]);
    expect(n.literals.index).toBe(2);
  });

  it("a blank input keeps the current sockets, and a saved Position card rebuilds them", async () => {
    const n = new ListIndexNode({ indexAxes: "position" });
    expect(Object.keys(n.inputs)).toEqual(["list", "position"]);
    n.data({ list: [null] });
    await flush();
    expect(Object.keys(n.inputs)).toEqual(["list", "position"]);
  });
});

describe("the INDEX card's positions are number lists", () => {
  it("every position socket takes a list, and a Frame refuses several positions", async () => {
    const n = new ListIndexNode();
    expect(declaredTypeOf(n.inputs.index?.socket)).toBe("numlist");
    expect(declaredTypeOf(n.inputs.column?.socket)).toBe("numlist");
    expect(n.data({ list: [[[1, 2], [3, 4]]], index: [[2, 1]] }).result).toEqual([[3, 4], [1, 2]]);
    const f = n.data({ list: [buildFrame([[1, 2], [3, 4]], ["a", "b"])], index: [[1, 2]] }).result;
    expect(isSolError(f) && f.code).toBe("#VALUE!");
    const p = new ListIndexNode({ indexAxes: "position" });
    expect(declaredTypeOf(p.inputs.position?.socket)).toBe("numlist");
    expect(p.data({ list: [[10, 20, 30]], position: [[3, 1]] }).result).toEqual([30, 10]);
  });
});
