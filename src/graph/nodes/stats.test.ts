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

describe("MODE.SNGL", () => {
  it("returns the most frequent value", () => {
    expect(new ModeNode().data({ list: [[1, 2, 2, 3, 3, 3, 4]] }).result).toBe(3);
  });
  it("returns the smallest among equally frequent values", () => {
    expect(new ModeNode().data({ list: [[5, 5, 2, 2, 9]] }).result).toBe(2);
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
