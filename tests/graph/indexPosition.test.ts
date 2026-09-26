// [[D85]] columnsStayColumns: a list is one row, walked by one Position; a one-row or one-column table walks too.
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { ListIndexNode } from "../../src/graph/nodes/list";

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
