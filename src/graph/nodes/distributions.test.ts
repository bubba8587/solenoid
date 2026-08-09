import { describe, it, expect } from "vitest";
import {
  NormDistNode,
  NormSDistNode,
  TDistNode,
  ChisqDistNode,
} from "./dist-normal";
import {
  FDistNode,
  BetaDistNode,
  GammaDistNode,
  LognormDistNode,
  WeibullDistNode,
  ExponDistNode,
} from "./dist-continuous";
import {
  BinomDistNode,
  PoissonDistNode,
  HypgeomDistNode,
  NegbinomDistNode,
} from "./dist-discrete";

// Each value below is the answer Excel's corresponding function returns, so a
// regression here means we've drifted from spreadsheet parity.

describe("normal family", () => {
  it("NORM.DIST cdf — Φ(1.96) = 0.975", () => {
    const r = new NormDistNode({ op: "cdf" }).data({ x: [1.96], mean: [0], stdev: [1] });
    expect(r.result).toBeCloseTo(0.975, 4);
  });

  it("NORM.DIST cdf — non-standard mean/stdev", () => {
    // NORM.DIST(110, 100, 15, TRUE) = 0.747507
    const r = new NormDistNode({ op: "cdf" }).data({ x: [110], mean: [100], stdev: [15] });
    expect(r.result).toBeCloseTo(0.747507, 4);
  });

  it("NORM.S.DIST cdf — Φ(1) = 0.841345", () => {
    const r = new NormSDistNode({ op: "cdf" }).data({ z: [1] });
    expect(r.result).toBeCloseTo(0.841345, 4);
  });

  it("NORM.INV is the inverse of NORM.DIST", () => {
    // NORM.INV(0.975, 0, 1) = 1.959964
    const r = new NormDistNode({ op: "inv" }).data({ prob: [0.975], mean: [0], stdev: [1] });
    expect(r.result).toBeCloseTo(1.959964, 4);
  });
});

describe("t family", () => {
  it("T.DIST.2T(2.228, 10) ≈ 0.05", () => {
    const r = new TDistNode({ op: "2t" }).data({ x: [2.228], df: [10] });
    expect(r.result).toBeCloseTo(0.05, 3);
  });

  it("T.DIST cdf(0, df) = 0.5 (symmetric)", () => {
    const r = new TDistNode({ op: "cdf" }).data({ x: [0], df: [7] });
    expect(r.result).toBeCloseTo(0.5, 6);
  });

  it("T.INV.2T(0.05, 10) ≈ 2.228139", () => {
    const r = new TDistNode({ op: "inv2t" }).data({ prob: [0.05], df: [10] });
    expect(r.result).toBeCloseTo(2.228139, 3);
  });
});

describe("chi-squared family", () => {
  it("CHISQ.DIST cdf at the 0.95 critical value ≈ 0.95", () => {
    // χ²_0.95, df=5 = 11.0705
    const r = new ChisqDistNode({ op: "cdf" }).data({ x: [11.0705], df: [5] });
    expect(r.result).toBeCloseTo(0.95, 4);
  });

  it("CHISQ.INV(0.95, 5) ≈ 11.0705", () => {
    const r = new ChisqDistNode({ op: "inv" }).data({ prob: [0.95], df: [5] });
    expect(r.result).toBeCloseTo(11.0705, 2);
  });
});

describe("F family", () => {
  it("F.DIST cdf at the 0.95 critical value ≈ 0.95", () => {
    // F_0.05(5, 10) = 3.325835
    const r = new FDistNode({ op: "cdf" }).data({ x: [3.325835], df1: [5], df2: [10] });
    expect(r.result).toBeCloseTo(0.95, 4);
  });
});

describe("beta / gamma", () => {
  it("BETA.DIST(0.5, 2, 5) cdf = 0.890625", () => {
    const r = new BetaDistNode({ op: "cdf" }).data({ x: [0.5], alpha: [2], beta: [5] });
    expect(r.result).toBeCloseTo(0.890625, 5);
  });

  it("GAMMA.DIST(1, 2, 2) cdf = 0.090204", () => {
    const r = new GammaDistNode({ op: "cdf" }).data({ x: [1], alpha: [2], beta: [2] });
    expect(r.result).toBeCloseTo(0.090204, 5);
  });
});

describe("lognormal / weibull / exponential", () => {
  it("LOGNORM.DIST(1, 0, 1) cdf = 0.5", () => {
    const r = new LognormDistNode({ op: "cdf" }).data({ x: [1], mean: [0], stdev: [1] });
    expect(r.result).toBeCloseTo(0.5, 4);
  });

  it("WEIBULL.DIST(1, 2, 2) cdf = 0.221199", () => {
    const r = new WeibullDistNode({ op: "cdf" }).data({ x: [1], alpha: [2], beta: [2] });
    expect(r.result).toBeCloseTo(0.221199, 5);
  });

  it("EXPON.DIST(1, 1) cdf = 1 - 1/e", () => {
    const r = new ExponDistNode({ op: "cdf" }).data({ x: [1], lambda: [1] });
    expect(r.result).toBeCloseTo(1 - Math.exp(-1), 6);
  });
});

describe("discrete family", () => {
  it("BINOM.DIST(3, 10, 0.5) pmf = 0.117188", () => {
    const r = new BinomDistNode({ op: "pmf" }).data({ k: [3], n: [10], p: [0.5] });
    expect(r.result).toBeCloseTo(0.117188, 5);
  });

  it("BINOM.DIST(3, 10, 0.5) cdf = 0.171875", () => {
    const r = new BinomDistNode({ op: "cdf" }).data({ k: [3], n: [10], p: [0.5] });
    expect(r.result).toBeCloseTo(0.171875, 5);
  });

  it("POISSON.DIST(3, 2) pmf = 0.180447", () => {
    const r = new PoissonDistNode({ op: "pmf" }).data({ k: [3], lambda: [2] });
    expect(r.result).toBeCloseTo(0.180447, 5);
  });

  it("POISSON.DIST(3, 2) cdf = 0.857123", () => {
    const r = new PoissonDistNode({ op: "cdf" }).data({ k: [3], lambda: [2] });
    expect(r.result).toBeCloseTo(0.857123, 5);
  });

  it("HYPGEOM.DIST(2, 5, 10, 20) pmf = 0.348297", () => {
    const r = new HypgeomDistNode({ op: "pmf" }).data({ k: [2], n: [5], M: [10], N: [20] });
    expect(r.result).toBeCloseTo(0.348297, 5);
  });

  it("NEGBINOM.DIST(3, 5, 0.5) pmf = 0.136719", () => {
    const r = new NegbinomDistNode({ op: "pmf" }).data({ k: [3], r: [5], p: [0.5] });
    expect(r.result).toBeCloseTo(0.136719, 5);
  });
});
