// [[D85]] columnsStayColumns, [[A5]] excelParity, [[D86]] blankRoles
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { FilterNode, SortNode, UniqueNode } from "../../src/graph/nodes/list";

const ev = (e: string, env: Record<string, unknown> = {}) => compileEvaluator(e)!(env);
const code = (v: unknown) => (v as { code?: string })?.code;
const m = [[3, "c"], [1, "a"], [2, "b"]];

describe("SORT, SORTBY, FILTER and UNIQUE take a table, as Excel's do", () => {
  it("SORT sorts rows by a column, or columns by a row with by_col; a blank setting is its default", () => {
    expect(ev("SORT(m)", { m })).toEqual([[1, "a"], [2, "b"], [3, "c"]]);
    expect(ev("SORT(m, 2, -1)", { m })).toEqual([[3, "c"], [2, "b"], [1, "a"]]);
    expect(ev("SORT(m, b, b)", { m, b: null })).toEqual([[1, "a"], [2, "b"], [3, "c"]]);
    expect(ev("SORT(r, 1, 1, TRUE)", { r: [[3, 1, 2], ["c", "a", "b"]] })).toEqual([[1, 2, 3], ["a", "b", "c"]]);
    expect(code(ev("SORT(m, 3)", { m }))).toBe("#VALUE!");
  });

  it("a list is one row: SORT and UNIQUE leave it as it is unless by_col is TRUE", () => {
    expect(ev("SORT(x)", { x: [3, 1, 2] })).toEqual([3, 1, 2]);
    expect(ev("SORT(x, , , TRUE)", { x: [3, 1, 2] })).toEqual([1, 2, 3]);
    expect(ev("UNIQUE(x)", { x: [1, 1, 2] })).toEqual([1, 1, 2]);
    expect(ev("UNIQUE(x, TRUE)", { x: [1, 1, 2] })).toEqual([1, 2]);
  });

  it("SORTBY: column keys sort rows, earlier keys first, each with its own order", () => {
    const t = [["a"], ["b"], ["c"], ["d"]];
    expect(ev("SORTBY(t, k1, 1, k2, -1)", { t, k1: [[2], [1], [2], [1]], k2: [[1], [5], [9], [3]] }))
      .toEqual([["b"], ["d"], ["c"], ["a"]]);
    expect(code(ev("SORTBY(t, k1, 1, k2)", { t, k1: [[1], [2], [3], [4]], k2: [1, 2, 3, 4] }))).toBe("#VALUE!");
  });

  it("FILTER: a column mask keeps rows, a row mask keeps columns", () => {
    expect(ev("FILTER(m, k)", { m, k: [[true], [false], [true]] })).toEqual([[3, "c"], [2, "b"]]);
    expect(ev("FILTER(m, k)", { m, k: [false, true] })).toEqual([["c"], ["a"], ["b"]]);
    expect(ev("FILTER(x, k)", { x: [1, 2, 3], k: [true, false, true] })).toEqual([1, 3]);
  });

  it("UNIQUE: distinct rows, or only the rows that appear once", () => {
    const d = [[1, "a"], [2, "b"], [1, "a"]];
    expect(ev("UNIQUE(d)", { d })).toEqual([[1, "a"], [2, "b"]]);
    expect(ev("UNIQUE(d, FALSE, TRUE)", { d })).toEqual([[2, "b"]]);
    expect(ev("UNIQUE(x, TRUE, TRUE)", { x: [1, 1, 2] })).toEqual([2]);
  });
});

describe("the cards take a table and keep a list a list", () => {
  it("Sort: Columns sorts a list's items; a blank wired Column is column 1", () => {
    expect(new SortNode({ byCol: true }).data({ list: [[3, 1, 2]] }).result).toEqual([1, 2, 3]);
    const n = new SortNode();
    n.literals.index = 2;
    expect(n.data({ list: [m], index: [null] }).result).toEqual([[1, "a"], [2, "b"], [3, "c"]]);
  });

  it("Unique: Rows on a table, Only singles keeps the rows that appear once", () => {
    const d = [[1, "a"], [2, "b"], [1, "a"]];
    expect(new UniqueNode().data({ list: [d] }).result).toEqual([[1, "a"], [2, "b"]]);
    expect(new UniqueNode({ exactlyOnce: true }).data({ list: [d] }).result).toEqual([[2, "b"]]);
  });

  it("Filter: a table's rows are tested on its Column; kept and dropped are rows", () => {
    const f = new FilterNode({ valueKeys: ["list", "column", "value0"] });
    f.condConfig["0"] = { op: "gt" };
    f.stringLiterals.value0 = "1";
    f.literals.column = 1;
    const out = f.data({ list: [m] });
    expect(out.result).toEqual([[3, "c"], [2, "b"]]);
    expect(out.dropped).toEqual([[1, "a"]]);
    f.literals.column = 5;
    expect(code(f.data({ list: [m] }).result)).toBe("#VALUE!");
  });
});
