// [[C17]] shareImpl
// The special functions under the distributions, read through the formulas that run them on the core.
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { isSolError } from "../../../src/graph/errorValue";
import { stdNormCDF } from "../../../src/graph/nodes/mathUtils";
import { LinestNode } from "../../../src/graph/nodes/stats";

const ev = (e: string) => compileEvaluator(e)!({}) as number;
const err = (e: string) => isSolError(compileEvaluator(e)!({}));

describe("GAMMALN", () => {
  it("matches ln of factorials at integer points", () => {
    expect(Math.exp(ev("GAMMALN(1)"))).toBeCloseTo(1, 9); // 0!
    expect(Math.exp(ev("GAMMALN(5)"))).toBeCloseTo(24, 6); // 4!
    expect(Math.exp(ev("GAMMALN(11)"))).toBeCloseTo(3628800, 1); // 10!
  });

  it("matches Γ(1/2) = √π", () => {
    expect(Math.exp(ev("GAMMALN(0.5)"))).toBeCloseTo(Math.sqrt(Math.PI), 8);
  });

  it("refuses a non-positive input", () => {
    expect(err("GAMMALN(0)")).toBe(true);
  });
});

describe("FACT / COMBIN", () => {
  it("computes factorials", () => {
    expect(ev("FACT(0)")).toBe(1);
    expect(ev("FACT(5)")).toBe(120);
  });

  it("computes binomial coefficients", () => {
    expect(ev("COMBIN(5, 2)")).toBe(10);
    expect(ev("COMBIN(10, 3)")).toBe(120);
    expect(ev("COMBIN(52, 5)")).toBe(2598960);
  });

  it("refuses an out-of-range k", () => {
    expect(err("COMBIN(5, -1)")).toBe(true);
    expect(err("COMBIN(5, 6)")).toBe(true);
  });
});

describe("stdNormCDF (Monte Carlo's uniform draw)", () => {
  it("is 0.5 at the mean", () => {
    expect(stdNormCDF(0)).toBeCloseTo(0.5, 6);
  });

  it("matches standard z-table values", () => {
    expect(stdNormCDF(1.96)).toBeCloseTo(0.975, 4);
    expect(stdNormCDF(-1.96)).toBeCloseTo(0.025, 4);
    expect(stdNormCDF(1)).toBeCloseTo(0.8413, 3);
    expect(stdNormCDF(2.575829)).toBeCloseTo(0.995, 3);
  });

  it("is symmetric: Φ(z) + Φ(-z) = 1", () => {
    for (const z of [0.3, 1.1, 2.4]) {
      expect(stdNormCDF(z) + stdNormCDF(-z)).toBeCloseTo(1, 6);
    }
  });

  it("agrees with NORM.S.DIST", () => {
    for (const z of [-2.2, 0.4, 1.7]) expect(stdNormCDF(z)).toBeCloseTo(ev(`NORM.S.DIST(${z}, TRUE)`), 6);
  });
});

describe("NORM.S.INV", () => {
  it("is 0 at p = 0.5", () => {
    expect(ev("NORM.S.INV(0.5)")).toBeCloseTo(0, 6);
  });

  it("matches standard critical values", () => {
    expect(ev("NORM.S.INV(0.975)")).toBeCloseTo(1.959964, 4);
    expect(ev("NORM.S.INV(0.025)")).toBeCloseTo(-1.959964, 4);
    expect(ev("NORM.S.INV(0.95)")).toBeCloseTo(1.644854, 4);
    expect(ev("NORM.S.INV(0.99)")).toBeCloseTo(2.326348, 4);
  });

  it("inverts NORM.S.DIST", () => {
    for (const p of [0.1, 0.37, 0.62, 0.9]) {
      expect(ev(`NORM.S.DIST(NORM.S.INV(${p}), TRUE)`)).toBeCloseTo(p, 4);
    }
  });

  it("refuses the bounds", () => {
    expect(err("NORM.S.INV(0)")).toBe(true);
    expect(err("NORM.S.INV(1)")).toBe(true);
  });
});

describe("the regularized gamma, as GAMMA.DIST's CDF", () => {
  // P(1, x) = 1 - e^{-x} (exponential CDF)
  it("matches the closed form P(1, x) = 1 - e^-x", () => {
    for (const x of [0.5, 1, 2, 5]) {
      expect(ev(`GAMMA.DIST(${x}, 1, 1, TRUE)`)).toBeCloseTo(1 - Math.exp(-x), 8);
    }
  });

  it("is 0 at x = 0 and approaches 1 for large x", () => {
    expect(ev("GAMMA.DIST(0, 3, 1, TRUE)")).toBe(0);
    expect(ev("GAMMA.DIST(100, 3, 1, TRUE)")).toBeCloseTo(1, 6);
  });

  it("refuses invalid params", () => {
    expect(err("GAMMA.DIST(1, 0, 1, TRUE)")).toBe(true);
    expect(err("GAMMA.DIST(-1, 1, 1, TRUE)")).toBe(true);
  });

  // P(a, x) crosses the series/continued-fraction boundary at x = a+1.
  it("is continuous across the x = a+1 algorithm switch", () => {
    const below = ev(`GAMMA.DIST(${4 - 1e-6}, 3, 1, TRUE)`);
    const above = ev(`GAMMA.DIST(${4 + 1e-6}, 3, 1, TRUE)`);
    expect(Math.abs(below - above)).toBeLessThan(1e-6);
  });
});

describe("the regularized beta, as BETA.DIST's CDF", () => {
  // I_x(1, 1) = x (uniform CDF)
  it("matches the closed form I_x(1,1) = x", () => {
    for (const x of [0.2, 0.5, 0.8]) {
      expect(ev(`BETA.DIST(${x}, 1, 1, TRUE)`)).toBeCloseTo(x, 8);
    }
  });

  // Symmetric beta: I_0.5(a, a) = 0.5
  it("is 0.5 at the midpoint of a symmetric beta", () => {
    expect(ev("BETA.DIST(0.5, 2, 2, TRUE)")).toBeCloseTo(0.5, 8);
    expect(ev("BETA.DIST(0.5, 5, 5, TRUE)")).toBeCloseTo(0.5, 8);
  });

  it("respects the boundary values", () => {
    expect(ev("BETA.DIST(0, 2, 3, TRUE)")).toBe(0);
    expect(ev("BETA.DIST(1, 2, 3, TRUE)")).toBe(1);
  });

  it("uses the symmetry relation consistently", () => {
    // I_x(a,b) = 1 - I_{1-x}(b,a)
    expect(ev("BETA.DIST(0.3, 2, 5, TRUE)")).toBeCloseTo(1 - ev("BETA.DIST(0.7, 5, 2, TRUE)"), 8);
  });

  it("refuses invalid params", () => {
    expect(err("BETA.DIST(0.5, 0, 1, TRUE)")).toBe(true);
    expect(err("BETA.DIST(-0.1, 1, 1, TRUE)")).toBe(true);
  });
});

describe("Linest's exponential fit", () => {
  it("recovers y = b·mˣ with a perfect log-scale R²", () => {
    const fit = new LinestNode({ op: "exponential" }).data({ xs: [[1, 2, 3, 4]], ys: [[2, 4, 8, 16]] }); // y = 1·2ˣ
    expect(fit.slope).toBeCloseTo(2, 10);
    expect(fit.intercept).toBeCloseTo(1, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
  });

  it("is #DOMAIN! when any y ≤ 0 (the log is undefined)", () => {
    expect(new LinestNode({ op: "exponential" }).data({ xs: [[1, 2, 3]], ys: [[1, -1, 2]] }).slope).toMatchObject({ code: "#DOMAIN!" });
  });
});
