import { describe, it, expect } from "vitest";
import {
  lnGamma,
  regularizedGamma,
  regularizedBeta,
  normSInv,
  stdNormCDF,
  bisectionInv,
  lnFactorial,
  lnCombin,
  expFitR2,
} from "../../../src/graph/nodes/mathUtils";

describe("lnGamma", () => {
  it("matches ln of factorials at integer points", () => {
    expect(Math.exp(lnGamma(1))).toBeCloseTo(1, 9); // 0!
    expect(Math.exp(lnGamma(2))).toBeCloseTo(1, 9); // 1!
    expect(Math.exp(lnGamma(5))).toBeCloseTo(24, 6); // 4!
    expect(Math.exp(lnGamma(11))).toBeCloseTo(3628800, 1); // 10!
  });

  it("matches Γ(1/2) = √π", () => {
    expect(Math.exp(lnGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 8);
  });

  it("returns Infinity for non-positive input", () => {
    expect(lnGamma(0)).toBe(Infinity);
  });
});

describe("lnFactorial / lnCombin", () => {
  it("computes factorials", () => {
    expect(Math.exp(lnFactorial(0))).toBeCloseTo(1, 9);
    expect(Math.exp(lnFactorial(5))).toBeCloseTo(120, 6);
  });

  it("computes binomial coefficients", () => {
    expect(Math.exp(lnCombin(5, 2))).toBeCloseTo(10, 6);
    expect(Math.exp(lnCombin(10, 3))).toBeCloseTo(120, 5);
    expect(Math.exp(lnCombin(52, 5))).toBeCloseTo(2598960, 0);
  });

  it("returns -Infinity for out-of-range k", () => {
    expect(lnCombin(5, -1)).toBe(-Infinity);
    expect(lnCombin(5, 6)).toBe(-Infinity);
  });
});

describe("stdNormCDF", () => {
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
});

describe("normSInv", () => {
  it("is 0 at p = 0.5", () => {
    expect(normSInv(0.5)).toBeCloseTo(0, 6);
  });

  it("matches standard critical values", () => {
    expect(normSInv(0.975)).toBeCloseTo(1.959964, 4);
    expect(normSInv(0.025)).toBeCloseTo(-1.959964, 4);
    expect(normSInv(0.95)).toBeCloseTo(1.644854, 4);
    expect(normSInv(0.99)).toBeCloseTo(2.326348, 4);
  });

  it("inverts stdNormCDF", () => {
    for (const p of [0.1, 0.37, 0.62, 0.9]) {
      expect(stdNormCDF(normSInv(p))).toBeCloseTo(p, 4);
    }
  });

  it("returns ±Infinity at the bounds", () => {
    expect(normSInv(0)).toBe(-Infinity);
    expect(normSInv(1)).toBe(Infinity);
  });
});

describe("regularizedGamma", () => {
  // P(1, x) = 1 - e^{-x} (exponential CDF)
  it("matches the closed form P(1, x) = 1 - e^-x", () => {
    for (const x of [0.5, 1, 2, 5]) {
      expect(regularizedGamma(1, x)).toBeCloseTo(1 - Math.exp(-x), 8);
    }
  });

  it("is 0 at x = 0 and approaches 1 for large x", () => {
    expect(regularizedGamma(3, 0)).toBe(0);
    expect(regularizedGamma(3, 100)).toBeCloseTo(1, 6);
  });

  it("returns NaN for invalid params", () => {
    expect(regularizedGamma(0, 1)).toBeNaN();
    expect(regularizedGamma(1, -1)).toBeNaN();
  });

  // P(a, x) crosses the series/continued-fraction boundary at x = a+1.
  it("is continuous across the x = a+1 algorithm switch", () => {
    const a = 3;
    const below = regularizedGamma(a, a + 1 - 1e-6);
    const above = regularizedGamma(a, a + 1 + 1e-6);
    expect(Math.abs(below - above)).toBeLessThan(1e-6);
  });
});

describe("regularizedBeta", () => {
  // I_x(1, 1) = x (uniform CDF)
  it("matches the closed form I_x(1,1) = x", () => {
    for (const x of [0.2, 0.5, 0.8]) {
      expect(regularizedBeta(x, 1, 1)).toBeCloseTo(x, 8);
    }
  });

  // Symmetric beta: I_0.5(a, a) = 0.5
  it("is 0.5 at the midpoint of a symmetric beta", () => {
    expect(regularizedBeta(0.5, 2, 2)).toBeCloseTo(0.5, 8);
    expect(regularizedBeta(0.5, 5, 5)).toBeCloseTo(0.5, 8);
  });

  it("respects the boundary values", () => {
    expect(regularizedBeta(0, 2, 3)).toBe(0);
    expect(regularizedBeta(1, 2, 3)).toBe(1);
  });

  it("uses the symmetry relation consistently", () => {
    // I_x(a,b) = 1 - I_{1-x}(b,a)
    const x = 0.3, a = 2, b = 5;
    expect(regularizedBeta(x, a, b)).toBeCloseTo(1 - regularizedBeta(1 - x, b, a), 8);
  });

  it("returns NaN for invalid params", () => {
    expect(regularizedBeta(0.5, 0, 1)).toBeNaN();
    expect(regularizedBeta(-0.1, 1, 1)).toBeNaN();
  });
});

describe("bisectionInv", () => {
  it("inverts a monotone cdf", () => {
    // invert Φ to recover normSInv
    expect(bisectionInv(stdNormCDF, 0.975, -10, 10)).toBeCloseTo(1.959964, 4);
    expect(bisectionInv(stdNormCDF, 0.5, -10, 10)).toBeCloseTo(0, 4);
  });

  it("clamps to the endpoints outside (0,1)", () => {
    expect(bisectionInv(stdNormCDF, 0, -10, 10)).toBe(-10);
    expect(bisectionInv(stdNormCDF, 1, -10, 10)).toBe(10);
  });
});

describe("expFitR2", () => {
  it("recovers y = b·mˣ with a perfect log-scale R²", () => {
    const fit = expFitR2([1, 2, 3, 4], [2, 4, 8, 16]); // y = 1·2ˣ
    expect(fit).not.toBeNull();
    expect(fit!.m).toBeCloseTo(2, 10);
    expect(fit!.b).toBeCloseTo(1, 10);
    expect(fit!.r2).toBeCloseTo(1, 10);
  });

  it("is null when any y ≤ 0 (the log is undefined)", () => {
    expect(expFitR2([1, 2, 3], [1, -1, 2])).toBeNull();
  });
});
