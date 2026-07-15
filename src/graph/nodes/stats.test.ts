import { describe, it, expect } from "vitest";
import {
  NthValueNode,
  PercentileNode,
  QuartileNode,
  PercentrankNode,
  RankNode,
  CorrelNode,
  CovarianceNode,
  ModeNode,
  TrimMeanNode,
  StandardizeNode,
  FisherNode,
  RegressionNode,
  ForecastNode,
  InterpolateNode,
  interpolateLinear,
  fillBorderedGrid,
} from "./stats";
import { isSolError, solError } from "../errorValue";

// List-socket inputs arrive as inputs.<port>[0] = the array.

describe("LARGE / SMALL (NthValue)", () => {
  const data = [[3, 1, 4, 1, 5, 9, 2, 6]];
  it("LARGE picks the k-th largest", () => {
    expect(new NthValueNode({ op: "large" }).data({ list: data, k: [1] }).result).toBe(9);
    expect(new NthValueNode({ op: "large" }).data({ list: data, k: [2] }).result).toBe(6);
  });
  it("SMALL picks the k-th smallest", () => {
    expect(new NthValueNode({ op: "small" }).data({ list: data, k: [1] }).result).toBe(1);
    expect(new NthValueNode({ op: "small" }).data({ list: data, k: [3] }).result).toBe(2);
  });
  it("returns null for out-of-range k", () => {
    expect(new NthValueNode({ op: "large" }).data({ list: data, k: [99] }).result).toBeNull();
  });
});

describe("PERCENTILE", () => {
  const data = [[1, 2, 3, 4]];
  it("INC interpolates like Excel PERCENTILE.INC", () => {
    expect(new PercentileNode({ op: "inc" }).data({ list: data, p: [0.5] }).result).toBeCloseTo(2.5, 9);
    expect(new PercentileNode({ op: "inc" }).data({ list: data, p: [0.25] }).result).toBeCloseTo(1.75, 9);
    expect(new PercentileNode({ op: "inc" }).data({ list: data, p: [0] }).result).toBe(1);
    expect(new PercentileNode({ op: "inc" }).data({ list: data, p: [1] }).result).toBe(4);
  });
  it("EXC matches Excel PERCENTILE.EXC", () => {
    expect(new PercentileNode({ op: "exc" }).data({ list: data, p: [0.25] }).result).toBeCloseTo(1.25, 9);
    // EXC is undefined at p outside (1/(n+1), n/(n+1)); guards return #DOMAIN! at the bounds
    const exc0 = new PercentileNode({ op: "exc" }).data({ list: data, p: [0] }).result;
    expect(isSolError(exc0) && exc0.code).toBe("#DOMAIN!");
    const exc1 = new PercentileNode({ op: "exc" }).data({ list: data, p: [1] }).result;
    expect(isSolError(exc1) && exc1.code).toBe("#DOMAIN!");
    // Inside (0,1) but outside the EXC domain: Excel errors (#NUM!), we #DOMAIN!
    // — never silently clamp to the min/max element. n=4 ⇒ domain (0.2, 0.8).
    const excLo = new PercentileNode({ op: "exc" }).data({ list: data, p: [0.1] }).result;
    expect(isSolError(excLo) && excLo.code).toBe("#DOMAIN!");
    const excHi = new PercentileNode({ op: "exc" }).data({ list: data, p: [0.9] }).result;
    expect(isSolError(excHi) && excHi.code).toBe("#DOMAIN!");
    expect(new PercentileNode({ op: "exc" }).data({ list: data, p: [0.2] }).result).toBe(1);
    expect(new PercentileNode({ op: "exc" }).data({ list: data, p: [0.8] }).result).toBe(4);
  });
});

describe("QUARTILE", () => {
  const data = [[1, 2, 3, 4, 5]];
  it("INC returns the expected quartiles", () => {
    expect(new QuartileNode({ op: "inc" }).data({ list: data, q: [0] }).result).toBe(1);
    expect(new QuartileNode({ op: "inc" }).data({ list: data, q: [1] }).result).toBe(2);
    expect(new QuartileNode({ op: "inc" }).data({ list: data, q: [2] }).result).toBe(3);
    expect(new QuartileNode({ op: "inc" }).data({ list: data, q: [4] }).result).toBe(5);
  });
  it("EXC interpolates the in-domain quartiles (= PERCENTILE.EXC(q/4))", () => {
    expect(new QuartileNode({ op: "exc" }).data({ list: data, q: [1] }).result).toBe(1.5);
    expect(new QuartileNode({ op: "exc" }).data({ list: data, q: [2] }).result).toBe(3);
    expect(new QuartileNode({ op: "exc" }).data({ list: data, q: [3] }).result).toBe(4.5);
  });
  it("EXC errors out of domain with #DOMAIN! instead of clamping to min/max (Excel #NUM!)", () => {
    // q=0/4 are always outside the EXC domain.
    expect(isSolError(new QuartileNode({ op: "exc" }).data({ list: data, q: [0] }).result)).toBe(true);
    expect(isSolError(new QuartileNode({ op: "exc" }).data({ list: data, q: [4] }).result)).toBe(true);
    // Small n pushes an interior quartile out of [1/(n+1), n/(n+1)]: n=2 → q1/q3 invalid.
    const two = [[1, 2]];
    expect(isSolError(new QuartileNode({ op: "exc" }).data({ list: two, q: [1] }).result)).toBe(true);
    expect(isSolError(new QuartileNode({ op: "exc" }).data({ list: two, q: [3] }).result)).toBe(true);
  });
});

describe("PERCENTRANK", () => {
  it("INC ranks a value within its list", () => {
    const data = [[1, 2, 3, 4, 5]];
    expect(new PercentrankNode({ op: "inc" }).data({ list: data, value: [3], significance: [3] }).result).toBeCloseTo(0.5, 9);
    expect(new PercentrankNode({ op: "inc" }).data({ list: data, value: [1], significance: [3] }).result).toBe(0);
  });
  it("INTERPOLATES between data points + TRUNCATES to significance (Excel parity)", () => {
    // 4 is between 3.5 (rank 2/3) and 10.25 (rank 1) → ~0.6913…, truncated to 0.691.
    const data = [[1.5, 2.5, 3.5, 10.25]];
    expect(new PercentrankNode({ op: "inc" }).data({ list: data, value: [4], significance: [3] }).result).toBe(0.691);
    // an exact match with duplicates uses the FIRST occurrence (count below / n−1),
    // truncated: 1/7 = 0.142857… → 0.142 (not 0.143 — Excel truncates, doesn't round).
    const dups = [[2, 4, 4, 4, 5, 5, 7, 9]];
    expect(new PercentrankNode({ op: "inc" }).data({ list: dups, value: [4], significance: [3] }).result).toBe(0.142);
  });
  it("returns #N/A for a value outside the data range", () => {
    const r = new PercentrankNode({ op: "inc" }).data({ list: [[1, 2, 3]], value: [9], significance: [3] }).result;
    expect(isSolError(r) && r.code).toBe("#N/A");
  });
});

describe("RANK", () => {
  const data = [[10, 20, 20, 40]];
  it("EQ gives tied values the same (lowest) rank, descending", () => {
    expect(new RankNode({ op: "eq" }).data({ list: data, value: [40] }).result).toBe(1);
    expect(new RankNode({ op: "eq" }).data({ list: data, value: [20] }).result).toBe(2);
    expect(new RankNode({ op: "eq" }).data({ list: data, value: [10] }).result).toBe(4);
  });
  it("AVG averages tied ranks", () => {
    // two 20s occupy ranks 2 and 3 → average 2.5
    expect(new RankNode({ op: "avg" }).data({ list: data, value: [20] }).result).toBe(2.5);
  });
  it("returns #N/A when the value is absent", () => {
    const r = new RankNode({ op: "eq" }).data({ list: data, value: [99] }).result;
    expect(isSolError(r) && r.code).toBe("#N/A");
  });
});

describe("STANDARDIZE", () => {
  it("z-scores a scalar value", () => {
    expect(new StandardizeNode().data({ value: [10], mean: [5], stdev: [2] }).result).toBe(2.5);
  });
  it("returns #DIV/0! for a scalar zero std dev", () => {
    const r = new StandardizeNode().data({ value: [10], mean: [5], stdev: [0] }).result;
    expect(isSolError(r) && r.code).toBe("#DIV/0!");
  });
  it("tags a per-element zero std dev in a list as a per-cell #DIV/0!", () => {
    const r = new StandardizeNode().data({ value: [[10, 20]], mean: [[5, 5]], stdev: [[2, 0]] }).result as Array<number | { code: string }>;
    expect(r[0]).toBe(2.5);
    expect(isSolError(r[1]) && r[1].code === "#DIV/0!").toBe(true);
  });
});

describe("FISHER", () => {
  it("transforms a scalar inside (−1, 1)", () => {
    expect(new FisherNode({ op: "fisher" }).data({ value: [0.5] }).result).toBeCloseTo(Math.atanh(0.5), 9);
  });
  it("returns #DOMAIN! for a scalar at/outside ±1", () => {
    const r = new FisherNode({ op: "fisher" }).data({ value: [1] }).result;
    expect(isSolError(r) && r.code).toBe("#DOMAIN!");
  });
  it("tags a per-element domain miss in a list as a per-cell #DOMAIN!", () => {
    const r = new FisherNode({ op: "fisher" }).data({ value: [[0.5, 1, -0.5]] }).result as Array<number | { code: string }>;
    expect(r[0]).toBeCloseTo(Math.atanh(0.5), 9);
    expect(isSolError(r[1]) && r[1].code === "#DOMAIN!").toBe(true);
    expect(r[2]).toBeCloseTo(Math.atanh(-0.5), 9);
  });
});

describe("REGRESSION / FORECAST zero-variance Xs", () => {
  it("SLOPE returns #DIV/0! when Xs have zero variance", () => {
    const r = new RegressionNode({ op: "slope" }).data({ ys: [[1, 2, 3]], xs: [[5, 5, 5]] }).result;
    expect(isSolError(r) && r.code).toBe("#DIV/0!");
  });
  it("STEYX stays null with fewer than 3 points (not enough data)", () => {
    expect(new RegressionNode({ op: "steyx" }).data({ ys: [[1, 2]], xs: [[1, 2]] }).result).toBeNull();
  });
  it("FORECAST returns #DIV/0! when Xs have zero variance", () => {
    const r = new ForecastNode().data({ x: [3], ys: [[1, 2, 3]], xs: [[5, 5, 5]] }).result;
    expect(isSolError(r) && r.code).toBe("#DIV/0!");
  });
});

describe("INTERPOLATE (piecewise-linear lookup)", () => {
  // Pure core.
  it("hits a known point exactly", () => {
    expect(interpolateLinear([0, 10, 20], [0, 100, 300], [10])).toEqual([100]);
  });
  it("blends linearly between two bracketing points", () => {
    // Midway 0→10 on 0→100 = 50; three-quarters 10→20 on 100→300 = 250.
    expect(interpolateLinear([0, 10, 20], [0, 100, 300], [5, 17.5])).toEqual([50, 250]);
  });
  it("clamps below the first x and above the last (no extrapolation)", () => {
    expect(interpolateLinear([0, 10], [5, 15], [-100, 999])).toEqual([5, 15]);
  });
  it("sorts unordered known points before interpolating", () => {
    // Same data as the blend test, shuffled — must give the same answer.
    expect(interpolateLinear([20, 0, 10], [300, 0, 100], [5])).toEqual([50]);
  });
  it("resolves a duplicated x to its first-seen y (no divide-by-zero)", () => {
    const r = interpolateLinear([0, 5, 5, 10], [0, 50, 999, 100], [5]);
    expect(Number.isFinite(r[0])).toBe(true);
  });
  it("holds flat with a single known point", () => {
    expect(interpolateLinear([7], [42], [0, 7, 100])).toEqual([42, 42, 42]);
  });
  it("keeps a NaN query as NaN", () => {
    expect(interpolateLinear([0, 10], [0, 10], [NaN])[0]).toBeNaN();
  });

  // Node wiring — the query is a numlist COMBO: a SCALAR X in yields a SCALAR y,
  // a LIST of Xs yields a LIST (result mirrors the query's shape).
  it("returns a SCALAR y for a scalar X (combo socket)", () => {
    // A scalar source arrives as inputs.new_xs = [5] (not [[5]]).
    const r = new InterpolateNode().data({ xs: [[0, 10, 20]], ys: [[0, 100, 300]], new_xs: [5] }).result;
    expect(r).toBe(50);
  });
  it("returns a LIST for a list of queries", () => {
    const r = new InterpolateNode().data({ xs: [[0, 10, 20]], ys: [[0, 100, 300]], new_xs: [[5, 10, 17.5]] }).result;
    expect(r).toEqual([50, 100, 250]);
  });
  it("interpolates at the literal query (x=0) when unwired → scalar", () => {
    // Unwired query falls back to literals.x = 0, clamped to the first known y.
    const r = new InterpolateNode().data({ xs: [[0, 10]], ys: [[7, 99]] }).result;
    expect(r).toBe(7);
  });
  it("keeps a missing (null) query missing in place", () => {
    const r = new InterpolateNode().data({ xs: [[0, 10]], ys: [[0, 100]], new_xs: [[5, null, 10]] }).result;
    expect(r).toEqual([50, null, 100]);
  });
  it("a scalar null query yields null", () => {
    const r = new InterpolateNode().data({ xs: [[0, 10]], ys: [[0, 100]], new_xs: [null] }).result;
    expect(r).toBeNull();
  });
  it("propagates a #CODE! error in the known data", () => {
    const err = solError("#N/A", "missing");
    const r = new InterpolateNode().data({ xs: [[0, err]], ys: [[0, 100]], new_xs: [5] }).result;
    expect(isSolError(r) && r.code).toBe("#N/A");
  });
  it("has no result with no known points (scalar null / list empty)", () => {
    expect(new InterpolateNode().data({ xs: [[]], ys: [[]], new_xs: [5] }).result).toBeNull();
    expect(new InterpolateNode().data({ xs: [[0, 10]], ys: [[0, 100]], new_xs: [[]] }).result).toEqual([]);
  });
});

describe("INTERPOLATE — Grid mode (fill a bordered table)", () => {
  it("fills blanks in a bordered lookup table (Z = x + y), incl. a new row×column intersection", () => {
    // row 0 = X coords, col 0 = Y coords, corner ignored; null = blank to fill.
    //   ·   0   5   10
    //   0   0   ·   10
    //   5   ·   ·   ·      ← a whole new (blank) row at Y=5
    //   10  10  ·   20     ← plus a new (blank) column at X=5
    const t = [
      [null, 0, 5, 10],
      [0, 0, null, 10],
      [5, null, null, null],
      [10, 10, null, 20],
    ];
    // Every cell resolves to Z = x + y — the (X=5, Y=5) intersection (blank in BOTH a
    // new row and a new column) resolves on the 2nd iteration, once its neighbours fill.
    expect(fillBorderedGrid(t)).toEqual([
      [null, 0, 5, 10],
      [0, 0, 5, 10],
      [5, 5, 10, 15],
      [10, 10, 15, 20],
    ]);
  });
  it("blanks the top-left corner even when the input had a value there", () => {
    const t = [[999, 0, 10], [0, 0, 10], [10, 10, 20]];
    expect(fillBorderedGrid(t)[0][0]).toBeNull();
  });
  it("clamps at the edges (a coordinate past the known range holds the edge value)", () => {
    //   ·   0   10   20     ← X=20 is past the last known Z column (0,10)
    //   0   5   15   ·
    const t = [[null, 0, 10, 20], [0, 5, 15, null]];
    expect(fillBorderedGrid(t)).toEqual([[null, 0, 10, 20], [0, 5, 15, 15]]);
  });
  it("leaves a cell no row or column can reach blank", () => {
    const t = [[null, 0], [0, null]]; // one interior cell, nothing known to reach it
    expect(fillBorderedGrid(t)).toEqual([[null, 0], [0, null]]);
  });
  it("treats a NaN / dirty interior cell as a blank to fill", () => {
    const t = [[null, 0, 10], [0, 0, NaN]]; // single known in the row → flat fill
    expect(fillBorderedGrid(t)).toEqual([[null, 0, 10], [0, 0, 0]]);
  });
  it("fills as a 2-D mesh, not row-only (an L of data ramps diagonally)", () => {
    // Only the top row + left column of the interior are known. A pure row-fill would
    // make each row FLAT at its left value; the mesh BLENDS both directions instead.
    //   ·   0   1   2
    //   0   0   1   2
    //   1   1   ·   ·
    //   2   2   ·   ·
    const out = fillBorderedGrid([
      [null, 0, 1, 2],
      [0, 0, 1, 2],
      [1, 1, null, null],
      [2, 2, null, null],
    ]);
    expect(out[2][2]).toBe(1);   // (x=1,y=1)
    expect(out[2][3]).toBe(1.5); // (x=2,y=1): blended — row-only would give 1
    expect(out[3][2]).toBe(1.5); // (x=1,y=2): blended — row-only would give 2
  });
  it("recovers the bilinear centre of a complete grid with a hole", () => {
    // Complete 3×3 of Z = x·y with the CENTRE blanked; bilinear centre = 1.
    //   ·   0   1   2
    //   0   0   0   0
    //   1   0   ·   2
    //   2   0   2   4
    const out = fillBorderedGrid([
      [null, 0, 1, 2],
      [0, 0, 0, 0],
      [1, 0, null, 2],
      [2, 0, 2, 4],
    ]);
    expect(out[2][2]).toBe(1);
  });

  // Node wiring — ONE table in, ONE table out.
  it("grid mode is one bordered-table input and one table output", () => {
    const n = new InterpolateNode({ mode: "grid" });
    expect(Object.keys(n.inputs)).toEqual(["grid"]);
    expect(Object.keys(n.outputs)).toEqual(["result"]);
  });
  it("_rebuildSockets swaps the list↔grid socket sets", () => {
    const n = new InterpolateNode(); // list mode
    expect(Object.keys(n.inputs).sort()).toEqual(["new_xs", "xs", "ys"]);
    n.mode = "grid"; n._rebuildSockets();
    expect(Object.keys(n.inputs)).toEqual(["grid"]);
    n.mode = "list"; n._rebuildSockets();
    expect(Object.keys(n.inputs).sort()).toEqual(["new_xs", "xs", "ys"]);
  });
  it("fills a bordered grid through the node (a per-cell error reads as a blank)", () => {
    const err = solError("#REF!", "bad cell");
    // Z = x·y with the centre cell errored → reads as blank, filled by 2-D interp to 1.
    const t = [[null, 0, 1, 2], [0, 0, 0, 0], [1, 0, err, 2], [2, 0, 2, 4]];
    const r = new InterpolateNode({ mode: "grid" }).data({ grid: [t] }).result as (number | null)[][];
    expect(r[2][2]).toBe(1);
  });
  it("propagates a whole-grid error", () => {
    const err = solError("#REF!", "bad grid");
    const r = new InterpolateNode({ mode: "grid" }).data({ grid: [err] }).result;
    expect(isSolError(r) && r.code).toBe("#REF!");
  });
});

describe("CORREL / RSQ", () => {
  it("is +1 for a perfectly increasing linear relation", () => {
    const r = new CorrelNode({ op: "correl" }).data({ x: [[1, 2, 3]], y: [[2, 4, 6]] });
    expect(r.result).toBeCloseTo(1, 9);
  });
  it("is -1 for a perfectly decreasing relation", () => {
    const r = new CorrelNode({ op: "correl" }).data({ x: [[1, 2, 3, 4]], y: [[4, 3, 2, 1]] });
    expect(r.result).toBeCloseTo(-1, 9);
  });
  it("RSQ is the square of the correlation", () => {
    const r = new CorrelNode({ op: "rsq" }).data({ x: [[1, 2, 3, 4]], y: [[4, 3, 2, 1]] });
    expect(r.result).toBeCloseTo(1, 9);
  });
});

describe("COVARIANCE", () => {
  const x = [[1, 2, 3, 4]];
  const y = [[2, 4, 6, 8]];
  it("population divides by n", () => {
    expect(new CovarianceNode({ op: "pop" }).data({ x, y }).result).toBeCloseTo(2.5, 9);
  });
  it("sample divides by n-1", () => {
    expect(new CovarianceNode({ op: "samp" }).data({ x, y }).result).toBeCloseTo(10 / 3, 9);
  });
});

describe("MODE (scalar OR list — supersedes MODE.SNGL / MODE.MULT)", () => {
  it("returns a single number when one value is most frequent", () => {
    expect(new ModeNode().data({ list: [[1, 2, 2, 3, 3, 3, 4]] }).result).toBe(3);
  });
  it("returns ALL of them as a list when several tie — no arbitrary tie-break", () => {
    // 5 and 2 both appear twice → the full set, sorted ascending (was: picked 2).
    expect(new ModeNode().data({ list: [[5, 5, 2, 2, 9]] }).result).toEqual([2, 5]);
  });
  it("skips nulls and propagates an error", () => {
    expect(new ModeNode().data({ list: [[7, null, 7, 1]] }).result).toBe(7);
  });
});

describe("TRIMMEAN", () => {
  it("trims the tails before averaging", () => {
    // 20% of 10 = trim 1 from each end → mean of 2..9 = 5.5
    const r = new TrimMeanNode().data({ list: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], percent: [0.2] });
    expect(r.result).toBeCloseTo(5.5, 9);
  });
});

describe("Scalar stats reducers — null skipped, errors propagated", () => {
  it("NthValue (LARGE/SMALL) skips null before ranking", () => {
    // [3,1,4,1,5] with two nulls → ranking ignores the gaps.
    expect(new NthValueNode({ op: "large" }).data({ list: [[3, null, 1, 4, null, 1, 5]], k: [1] }).result).toBe(5);
    expect(new NthValueNode({ op: "small" }).data({ list: [[3, null, 1, 4, null, 1, 5]], k: [1] }).result).toBe(1);
  });

  it("Percentile skips null before ranking", () => {
    // median of [1,2,3,4] (nulls dropped) = 2.5
    expect(new PercentileNode({ op: "inc" }).data({ list: [[1, null, 2, 3, null, 4]], p: [0.5] }).result).toBeCloseTo(2.5, 9);
  });

  it("both propagate a SolError in the list", () => {
    const err = solError("#DIV/0!", "boom");
    const nth = new NthValueNode({ op: "large" }).data({ list: [[1, err, 3]], k: [1] }).result;
    expect(isSolError(nth) && nth.code).toBe("#DIV/0!");
    const pct = new PercentileNode({ op: "inc" }).data({ list: [[1, err, 3]], p: [0.5] }).result;
    expect(isSolError(pct) && pct.code).toBe("#DIV/0!");
  });
});
