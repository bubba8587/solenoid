// [[D85]] columnsStayColumns
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { EXCEL_IMPL_META } from "../../src/graph/excelFunctions";
import { initPackFormulas } from "../../src/graph/formulaExtensions";
import { isSolError } from "../../src/graph/errorValue";
import { ComputedColumnNode } from "../../src/graph/nodes/frame";
import { getColumn, type FrameValue } from "../../src/graph/frame";

const flat = (v: unknown): string => (isSolError(v) ? `ERR ${v.code}` : JSON.stringify(Array.isArray(v) ? v.flat(3) : v));
const VOLATILE = /^(RAND|SHUFFLE|UUID|SAMPLE|NOW|TODAY)/;

// Pack formulas join the table when packs load, so load them here rather than rely on another file having done it.
initPackFormulas();

describe("every list-taking function declares whether a vector's direction matters", () => {
  it("each listArgs entry has an orient", () => {
    const missing = Object.entries(EXCEL_IMPL_META).filter(([, m]) => m.listArgs && !m.orient).map(([n]) => n);
    expect(missing, "declare orient: \"free\" or \"axis\" on these").toEqual([]);
  });

  it("a free function answers a one-column table as it answers the list, and a column for a column", () => {
    const list = [3, 1, 4, 1, 5];
    const col = list.map((x) => [x]);
    const bad: string[] = [];
    for (const [name, m] of Object.entries(EXCEL_IMPL_META)) {
      if (m.orient !== "free" || VOLATILE.test(name)) continue;
      const [min, max] = m.arity;
      for (let n = Math.max(1, min); n <= Math.min(max, 3); n++) {
        const expr = `${name}(${["x", "2", "1"].slice(0, n).join(", ")})`;
        const fromList = compileEvaluator(expr)!({ x: list });
        const fromCol = compileEvaluator(expr)!({ x: col });
        if (flat(fromList) !== flat(fromCol)) { bad.push(`${expr}: ${flat(fromList)} vs ${flat(fromCol)}`); continue; }
        const listOut = Array.isArray(fromList) && !fromList.some(Array.isArray);
        if (listOut && !(Array.isArray(fromCol) && fromCol.every((r) => Array.isArray(r) && r.length === 1))) bad.push(`${expr}: a column in did not come back a column`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("an axis function sees the column's direction, as Excel's do", () => {
    const col = [[3], [1], [2]];
    expect(compileEvaluator("ROWS(x)")!({ x: col })).toBe(3);
    expect(compileEvaluator("SORT(x)")!({ x: col })).toEqual([[1], [2], [3]]);
    expect(compileEvaluator("TAKE(x, 2)")!({ x: col })).toEqual([[3], [1]]);
  });
});

describe("in a computed column, a whole column is a column", () => {
  const sales: FrameValue = { __frame: true, columns: [{ name: "price", type: "number", values: [10, 20, 30] }] };
  const run = (expr: string, extra: Record<string, unknown[]> = {}) => {
    const n = new ComputedColumnNode({ expr });
    n.stringLiterals.name = "out";
    const f = n.data({ frame: [sales], ...extra } as Parameters<ComputedColumnNode["data"]>[0]).frame as FrameValue;
    return getColumn(f, "out")!.values;
  };

  it("a direction-free answer keeps the column's direction, so it combines element by element", () => {
    // Element by element: 10·30 + 20·20 + 30·10. Spread into a grid it would be (10 + 20 + 30)² = 3600.
    expect(run("SUM(price * REVERSE(price))")).toEqual([1000, 1000, 1000]);
    expect(run("INDEX(REVERSE(price), ROW(), 1)")).toEqual([30, 20, 10]);
  });

  it("a wired list with one value per row reads as a column, so SUM(price * weights) is element by element", () => {
    expect(run("SUM(price * weights)", { weights: [[1, 2, 3]] })).toEqual([140, 140, 140]);
  });

  it("ROWS(price) is the row count and a direction-free function still reads the column's items", () => {
    expect(run("ROWS(price)")).toEqual([3, 3, 3]);
    expect(run("LENGTH(price) + CONTAINS(price, 20)")).toEqual([4, 4, 4]);
  });
});
