// [[C22]], [[C120]] linearWork
import { describe, expect, it } from "vitest";
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

  it("stays linear at 20k rows", () => {
    const t0 = performance.now();
    run("@price / SUM(price)", Array.from({ length: 20000 }, (_, i) => i));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
