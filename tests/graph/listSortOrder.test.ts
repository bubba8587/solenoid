// [[C59]] byteStringOrder, [[D73]] nodeCoversFormula
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { SortNode } from "../../src/graph/nodes/list";
import { solError } from "../../src/graph/errorValue";

const ev = (e: string, env: Record<string, unknown> = {}) => compileEvaluator(e)!(env);

describe("list sorting orders every kind", () => {
  // [[D85]] columnsStayColumns: a list is one row, so its items sort by column (Excel's by_col).
  it("SORT orders text by character code, and descending reverses it", () => {
    expect(ev("SORT(t, , , TRUE)", { t: ["b", "a", "B", "c"] })).toEqual(["B", "a", "b", "c"]);
    expect(ev("SORT(t, 1, -1, TRUE)", { t: ["b", "a", "c"] })).toEqual(["c", "b", "a"]);
    expect(ev("SORT(t)", { t: ["b", "a", "c"] })).toEqual(["b", "a", "c"]);
  });

  it("mixed kinds sort numbers, then text, then FALSE and TRUE; blanks, errors and NaN go last", () => {
    const err = solError("#DIV/0!", "x");
    expect(ev("SORT(t,,,TRUE)", { t: [true, "b", null, 2, err, "a", 1, false, NaN] }))
      .toEqual([1, 2, "a", "b", false, true, null, err, NaN]);
  });

  it("SORTBY takes text keys and a sort order", () => {
    expect(ev("SORTBY(n, t)", { n: [3, 1, 2], t: ["c", "a", "b"] })).toEqual([1, 2, 3]);
    expect(ev("SORTBY(n, n, -1)", { n: [3, 1, 2] })).toEqual([3, 2, 1]);
    expect(ev("SORTBY(n, n, 2)", { n: [3, 1, 2] })).toMatchObject({ code: "#VALUE!" });
  });

  it("the List Sort card sorts a text list as the formula does", () => {
    const n = new SortNode({ byCol: true });
    expect(n.data({ list: [["b", "a", "c"]] }).result).toEqual(ev("SORT(t,,,TRUE)", { t: ["b", "a", "c"] }));
    n.order = "desc";
    expect(n.data({ list: [[1, 3, 2]] }).result).toEqual([3, 2, 1]);
  });
});
