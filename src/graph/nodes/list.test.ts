import { describe, it, expect } from "vitest";
import {
  RangeNode,
  LinSpaceNode,
  NormalizeNode,
  DiffNode,
  CumulativeNode,
  RollingNode,
  WeightedNode,
  ArgMinMaxNode,
  AggregateNode,
  FilterNode,
  FillNode,
  type ReduceOp,
  type FillOp,
} from "./list";
import { solError, isSolError } from "../errorValue";

describe("Range", () => {
  it("counts up, stop-exclusive", () => {
    expect(new RangeNode().data({ start: [0], stop: [5], step: [1] }).list).toEqual([0, 1, 2, 3, 4]);
    expect(new RangeNode().data({ start: [0], stop: [10], step: [2] }).list).toEqual([0, 2, 4, 6, 8]);
  });
  it("counts down with a negative step", () => {
    expect(new RangeNode().data({ start: [5], stop: [0], step: [-1] }).list).toEqual([5, 4, 3, 2, 1]);
  });
  it("is empty when stop is unreachable or step is 0", () => {
    expect(new RangeNode().data({ start: [0], stop: [5], step: [-1] }).list).toEqual([]);
    expect(new RangeNode().data({ start: [0], stop: [5], step: [0] }).list).toEqual([]);
  });
});

describe("LinSpace", () => {
  it("includes both endpoints", () => {
    expect(new LinSpaceNode().data({ start: [0], end: [1], count: [5] }).result).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it("handles count 1 and 0", () => {
    expect(new LinSpaceNode().data({ start: [3], end: [9], count: [1] }).result).toEqual([3]);
    expect(new LinSpaceNode().data({ start: [3], end: [9], count: [0] }).result).toEqual([]);
  });
});

describe("Normalize", () => {
  it("maps min→0 and max→1", () => {
    expect(new NormalizeNode().data({ list: [[10, 20, 30]] }).result).toEqual([0, 0.5, 1]);
  });
  it("maps a constant list to all zeros", () => {
    expect(new NormalizeNode().data({ list: [[7, 7, 7]] }).result).toEqual([0, 0, 0]);
  });
});

describe("Diff", () => {
  it("is the first difference, one shorter than the input", () => {
    expect(new DiffNode().data({ list: [[1, 3, 6, 10]] }).result).toEqual([2, 3, 4]);
  });
});

describe("Cumulative", () => {
  it("cumsum", () => {
    expect(new CumulativeNode({ op: "cumsum" }).data({ list: [[1, 2, 3, 4]] }).result).toEqual([1, 3, 6, 10]);
  });
  it("cumprod", () => {
    expect(new CumulativeNode({ op: "cumprod" }).data({ list: [[1, 2, 3, 4]] }).result).toEqual([1, 2, 6, 24]);
  });
  it("cummax / cummin", () => {
    expect(new CumulativeNode({ op: "cummax" }).data({ list: [[3, 1, 4, 1, 5]] }).result).toEqual([3, 3, 4, 4, 5]);
    expect(new CumulativeNode({ op: "cummin" }).data({ list: [[5, 3, 4, 1, 2]] }).result).toEqual([5, 3, 3, 1, 1]);
  });
});

describe("Rolling", () => {
  it("trailing-window sum grows then slides", () => {
    expect(new RollingNode({ op: "sum" }).data({ list: [[1, 2, 3, 4, 5]], window: [3] }).result).toEqual([1, 3, 6, 9, 12]);
  });
  it("trailing-window average", () => {
    expect(new RollingNode({ op: "avg" }).data({ list: [[2, 4, 6, 8]], window: [2] }).result).toEqual([2, 3, 5, 7]);
  });
});

describe("Weighted", () => {
  it("weighted average", () => {
    const r = new WeightedNode({ op: "wavg" }).data({ values: [[1, 2, 3, 4]], weights: [[4, 3, 2, 1]] });
    expect(r.result).toBeCloseTo(2, 9);
  });
  it("equal weights reproduce the sample variance", () => {
    const r = new WeightedNode({ op: "wvar" }).data({ values: [[1, 2, 3, 4]], weights: [[1, 1, 1, 1]] });
    expect(r.result).toBeCloseTo(5 / 3, 9);
  });
  it("skips a pair when either the value or its weight is null", () => {
    // weight[2] is null → pair (3,·) dropped. Survivors (1,4)(2,3)(4,1):
    // WAVG = (1·4 + 2·3 + 4·1) / (4+3+1) = 14/8 = 1.75.
    const r = new WeightedNode({ op: "wavg" }).data({ values: [[1, 2, 3, 4]], weights: [[4, 3, null, 1]] });
    expect(r.result).toBeCloseTo(1.75, 9);
  });
  it("propagates a SolError in either list", () => {
    const err = solError("#DIV/0!", "boom");
    const r = new WeightedNode({ op: "wavg" }).data({ values: [[1, err, 3]], weights: [[1, 1, 1]] });
    expect(isSolError(r.result) && r.result.code).toBe("#DIV/0!");
  });
});

describe("ArgMax / ArgMin", () => {
  it("returns a 1-based position", () => {
    expect(new ArgMinMaxNode({ op: "argmax" }).data({ list: [[3, 1, 4, 1, 5, 9, 2]] }).result).toBe(6);
    expect(new ArgMinMaxNode({ op: "argmin" }).data({ list: [[3, 1, 4, 1, 5, 9, 2]] }).result).toBe(2);
  });
});

describe("Reduce — basic aggregates", () => {
  const list = [[2, 4, 4, 4, 5, 5, 7, 9]];
  const reduce = (op: ReduceOp) =>
    new AggregateNode({ op }).data({ list }).result;

  it("sum / avg / min / max / count", () => {
    expect(reduce("sum")).toBe(40);
    expect(reduce("avg")).toBe(5);
    expect(reduce("min")).toBe(2);
    expect(reduce("max")).toBe(9);
    expect(reduce("count")).toBe(8);
  });
  it("median (even length averages the middle pair)", () => {
    expect(reduce("median")).toBe(4.5);
  });
  it("sumsq / devsq / avedev", () => {
    expect(reduce("sumsq")).toBe(232);
    expect(reduce("devsq")).toBe(32);
    expect(reduce("avedev")).toBeCloseTo(1.5, 9);
  });
});

describe("Aggregate — null skipped, errors propagated (array-semantics policy)", () => {
  const agg = (op: ReduceOp, list: (number | null | ReturnType<typeof solError>)[][]) =>
    new AggregateNode({ op }).data({ list }).result;

  it("skips null (missing) — SUM/AVG/COUNT ignore the gaps", () => {
    expect(agg("sum", [[10, null, 20, 30, null]])).toBe(60);
    // AVERAGE divides by the count of PRESENT values (3), not the list length.
    expect(agg("avg", [[10, null, 20, 30, null]])).toBe(20);
    expect(agg("count", [[10, null, 20, 30, null]])).toBe(3);
    expect(agg("min", [[null, 5, 2, null]])).toBe(2);
  });

  it("an all-null list reduces like an empty list (sum→null, count→0)", () => {
    // Pre-existing empty-list convention: only count is 0, the rest are null.
    expect(agg("sum", [[null, null]])).toBeNull();
    expect(agg("count", [[null, null]])).toBe(0);
    expect(agg("avg", [[null, null]])).toBeNull();
  });

  it("propagates a SolError anywhere in the list", () => {
    const err = solError("#DIV/0!", "boom");
    const out = agg("sum", [[1, 2, err, 4]]);
    expect(isSolError(out) && out.code).toBe("#DIV/0!");
  });
});

describe("Reduce — variance / stdev (sample vs population)", () => {
  const list = [[2, 4, 4, 4, 5, 5, 7, 9]]; // mean 5, Σdev² = 32, n = 8
  const reduce = (op: ReduceOp) =>
    new AggregateNode({ op }).data({ list }).result;

  it("population divides by n", () => {
    expect(reduce("var_p")).toBeCloseTo(4, 9);
    expect(reduce("stdev_p")).toBeCloseTo(2, 9);
  });
  it("sample divides by n-1", () => {
    expect(reduce("var_s")).toBeCloseTo(32 / 7, 9);
    expect(reduce("stdev")).toBeCloseTo(Math.sqrt(32 / 7), 9);
  });
});

describe("Reduce — means and shape", () => {
  it("GEOMEAN / HARMEAN", () => {
    expect(new AggregateNode({ op: "geomean" }).data({ list: [[1, 2, 4]] }).result).toBeCloseTo(2, 9);
    expect(new AggregateNode({ op: "harmean" }).data({ list: [[1, 2, 4]] }).result).toBeCloseTo(12 / 7, 9);
  });
  it("SKEW is 0 for a symmetric set", () => {
    expect(new AggregateNode({ op: "skew" }).data({ list: [[1, 2, 3, 4, 5]] }).result).toBeCloseTo(0, 9);
    expect(new AggregateNode({ op: "skew_p" }).data({ list: [[1, 2, 3, 4, 5]] }).result).toBeCloseTo(0, 9);
  });
  it("KURT matches Excel for 1..5", () => {
    expect(new AggregateNode({ op: "kurt" }).data({ list: [[1, 2, 3, 4, 5]] }).result).toBeCloseTo(-1.2, 9);
  });
});

describe("Filter — a null/unknown predicate row is excluded (SQL WHERE keeps only TRUE)", () => {
  it("a missing data cell is dropped, not coerced to 0 and guessed", () => {
    // keep x > 1 over [1, null, 3]: 1>1 false, null → unknown → excluded, 3>1 true → [3].
    const r = new FilterNode({ op: "gt" }).data({ list: [[[1, null, 3]]], threshold: [1] }).result;
    expect(r).toEqual([[3]]);
  });
});

describe("Fill / Coalesce — missing-value strategies (array-semantics policy)", () => {
  const fill = (op: FillOp, list: (number | null | ReturnType<typeof solError>)[], extra: Record<string, unknown> = {}) =>
    new FillNode({ op }).data({ list: [list], ...extra }).result;

  it("constant replaces gaps with the wired/literal value, leaves present cells", () => {
    expect(fill("constant", [1, null, 3], { value: [0] })).toEqual([1, 0, 3]);
    // default literal is 0 when no value is wired
    expect(new FillNode({ op: "constant" }).data({ list: [[null, 5, null]] }).result).toEqual([0, 5, 0]);
  });

  it("forward / backward fill carry the nearest present value over gaps", () => {
    expect(fill("ffill", [null, 1, null, 3, null])).toEqual([null, 1, 1, 3, 3]);
    expect(fill("bfill", [null, 1, null, 3, null])).toEqual([1, 1, 3, 3, null]);
  });

  it("mean / median / mode impute from the present values only", () => {
    expect(fill("mean", [2, null, 4])).toEqual([2, 3, 4]); // mean(2,4)=3
    expect(fill("median", [1, null, 2, 4])).toEqual([1, 2, 2, 4]); // median(1,2,4)=2
    expect(fill("mode", [5, 5, null, 2])).toEqual([5, 5, 5, 2]); // mode=5
  });

  it("interpolate fills interior gaps linearly; open-ended gaps stay null", () => {
    expect(fill("interpolate", [1, null, 3])).toEqual([1, 2, 3]);
    expect(fill("interpolate", [1, null, null, 4])).toEqual([1, 2, 3, 4]);
    expect(fill("interpolate", [null, 2, 3])).toEqual([null, 2, 3]); // no left bracket
    expect(fill("interpolate", [1, 2, null])).toEqual([1, 2, null]); // no right bracket
  });

  it("drop removes the missing cells (shortens the list)", () => {
    expect(fill("drop", [1, null, 3, null, 5])).toEqual([1, 3, 5]);
  });

  it("coalesce takes the first present of List then Else, per position", () => {
    expect(new FillNode({ op: "coalesce" }).data({ list: [[1, null, 3]], else: [[9, 8, 7]] }).result)
      .toEqual([1, 8, 3]);
    // missing in both stays null; Else can be longer
    expect(new FillNode({ op: "coalesce" }).data({ list: [[null, null]], else: [[5, null, 6]] }).result)
      .toEqual([5, null, 6]);
  });

  it("a per-cell error is NOT a gap — every mode passes it through untouched", () => {
    const err = solError("#DIV/0!", "boom");
    const out = fill("constant", [1, err, null], { value: [0] }) as unknown[];
    expect(out[0]).toBe(1);
    expect(isSolError(out[1]) && (out[1] as { code: string }).code).toBe("#DIV/0!");
    expect(out[2]).toBe(0); // the null gap is filled, the error is left alone
  });

  it("statistics skip error cells when computing the impute value", () => {
    const err = solError("#DIV/0!", "x");
    const out = fill("mean", [2, err, 4, null]) as unknown[]; // mean of present (2,4)=3
    expect(out[0]).toBe(2);
    expect(isSolError(out[1])).toBe(true);
    expect(out[2]).toBe(4);
    expect(out[3]).toBe(3); // the gap imputed from present numbers, ignoring the error
  });
});
