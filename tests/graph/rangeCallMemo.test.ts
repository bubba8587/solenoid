// [[C22]] rowFormulaRefs, [[engineering#Performance]], [[computed-columns#Names inside a row]], [[C22]], [[engineering#Nothing whole-table runs once per row]]
import { describe, expect, it } from "vitest";
import { growthAt4x } from "./timing";
import { computeColumnOnEngine } from "../../src/graph/frameBackend";
import { isSolError } from "../../src/graph/errorValue";
import type { FrameValue } from "../../src/graph/frame";

const run = (expr: string, values: number[]) => {
  const f: FrameValue = { __frame: true, columns: [{ name: "price", type: "number", values }] };
  const r = computeColumnOnEngine(f, expr, values.length);
  if (!r || isSolError(r)) throw new Error(`no column: ${JSON.stringify(r)}`);
  return r.cells;
};

describe("a range function over a whole column", () => {
  it("answers per row against the whole column", () => {
    expect(run("@price / SUM(price)", [1, 3])).toEqual([0.25, 0.75]);
  });

  it("re-reads the column on the next run of the same formula", () => {
    expect(run("@price - AVERAGE(price)", [1, 3])).toEqual([-1, 1]);
    expect(run("@price - AVERAGE(price)", [10, 20])).toEqual([-5, 5]);
  });

  it("stays linear in the rows", () => {
    const rows = (n: number) => run("@price / SUM(price)", Array.from({ length: n }, (_, i) => i));
    expect(growthAt4x(rows, 40_000)).toBeLessThan(8);
  });
});
