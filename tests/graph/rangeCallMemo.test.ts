// [[C22]]
import { describe, expect, it } from "vitest";
import { compileEvaluator, extractVariables } from "../../src/graph/excelFormula";
import { computeColumnCells, type ComputedColumnResult } from "../../src/graph/computedColumnCore";
import { registerInternal, resolveExcelFunction, unregisterInternal } from "../../src/graph/excelFunctions";

const run = (expr: string, values: number[]) => {
  const ev = compileEvaluator(expr)!;
  const r = computeColumnCells({ columns: [{ name: "price", values }] }, { kind: "expr", evaluator: ev, vars: extractVariables(expr) });
  return (r as ComputedColumnResult).cells;
};

describe("a range function over a whole column", () => {
  it("answers per row against the whole column", () => {
    expect(run("@price / SUM(price)", [1, 3])).toEqual([0.25, 0.75]);
  });

  it("re-reads the column on the next run of the same formula", () => {
    const expr = "@price - AVERAGE(price)";
    const ev = compileEvaluator(expr)!;
    const cells = (values: number[]) => (computeColumnCells(
      { columns: [{ name: "price", values }] }, { kind: "expr", evaluator: ev, vars: extractVariables(expr) },
    ) as ComputedColumnResult).cells;
    expect(cells([1, 3])).toEqual([-1, 1]);
    expect(cells([10, 20])).toEqual([-5, 5]);
  });

  it("stays linear at 20k rows", () => {
    const t0 = performance.now();
    run("@price / SUM(price)", Array.from({ length: 20000 }, (_, i) => i));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("a list shaper over a whole column", () => {
  const regions = ["N", "S", "N", "E", "S"];
  const cells = (expr: string, values: unknown[]) => (computeColumnCells(
    { columns: [{ name: "region", values }] },
    { kind: "expr", evaluator: compileEvaluator(expr)!, vars: extractVariables(expr) },
  ) as ComputedColumnResult).cells;

  it("answers the right count on every row", () => {
    expect(cells("COUNTA(UNIQUE(region))", regions)).toEqual([3, 3, 3, 3, 3]);
    expect(cells("COUNTA(UNIQUE(region))", ["A", "A"])).toEqual([1, 1]);
  });

  it("builds the list once per column, not once per row", () => {
    const unique = resolveExcelFunction("UNIQUE")!;
    let calls = 0;
    unregisterInternal("UNIQUE");
    registerInternal("UNIQUE", (...a) => { calls++; return unique(...a); });
    try {
      expect(cells("COUNTA(UNIQUE(region))", regions)).toEqual([3, 3, 3, 3, 3]);
      expect(calls).toBe(1);
    } finally {
      unregisterInternal("UNIQUE");
      registerInternal("UNIQUE", unique);
    }
  });
});
