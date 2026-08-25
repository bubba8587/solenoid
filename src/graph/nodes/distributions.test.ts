import { describe, it, expect } from "vitest";
import { DistributionNode, formAfterSwitch } from "./distribution";
import { DIST_SPECS } from "./distributionOps";
import { compileEvaluator } from "../excelFormula";

const dist = (op: string, form: string) =>
  new DistributionNode({ op: op as never, form: form as never });

// Each value below is the answer Excel's corresponding function returns, so a
// regression here means we've drifted from spreadsheet parity.

describe("normal family", () => {
  it("NORM.DIST cdf — Φ(1.96) = 0.975", () => {
    const r = dist("normal", "cdf").data({ x: [1.96], mean: [0], stdev: [1] });
    expect(r.result).toBeCloseTo(0.975, 4);
  });

  it("NORM.DIST cdf — non-standard mean/stdev", () => {
    // NORM.DIST(110, 100, 15, TRUE) = 0.747507
    const r = dist("normal", "cdf").data({ x: [110], mean: [100], stdev: [15] });
    expect(r.result).toBeCloseTo(0.747507, 4);
  });

  it("NORM.S.DIST cdf — Φ(1) = 0.841345", () => {
    const r = dist("normal-s", "cdf").data({ z: [1] });
    expect(r.result).toBeCloseTo(0.841345, 4);
  });

  it("NORM.INV is the inverse of NORM.DIST", () => {
    // NORM.INV(0.975, 0, 1) = 1.959964
    const r = dist("normal", "inv").data({ prob: [0.975], mean: [0], stdev: [1] });
    expect(r.result).toBeCloseTo(1.959964, 4);
  });
});

describe("t family", () => {
  it("T.DIST.2T(2.228, 10) ≈ 0.05", () => {
    const r = dist("t", "2t").data({ x: [2.228], df: [10] });
    expect(r.result).toBeCloseTo(0.05, 3);
  });

  it("T.DIST cdf(0, df) = 0.5 (symmetric)", () => {
    const r = dist("t", "cdf").data({ x: [0], df: [7] });
    expect(r.result).toBeCloseTo(0.5, 6);
  });

  it("T.INV.2T(0.05, 10) ≈ 2.228139", () => {
    const r = dist("t", "inv2t").data({ prob: [0.05], df: [10] });
    expect(r.result).toBeCloseTo(2.228139, 3);
  });
});

describe("chi-squared family", () => {
  it("CHISQ.DIST cdf at the 0.95 critical value ≈ 0.95", () => {
    // χ²_0.95, df=5 = 11.0705
    const r = dist("chisq", "cdf").data({ x: [11.0705], df: [5] });
    expect(r.result).toBeCloseTo(0.95, 4);
  });

  it("CHISQ.INV(0.95, 5) ≈ 11.0705", () => {
    const r = dist("chisq", "inv").data({ prob: [0.95], df: [5] });
    expect(r.result).toBeCloseTo(11.0705, 2);
  });
});

describe("F family", () => {
  it("F.DIST cdf at the 0.95 critical value ≈ 0.95", () => {
    // F_0.05(5, 10) = 3.325835
    const r = dist("f", "cdf").data({ x: [3.325835], df1: [5], df2: [10] });
    expect(r.result).toBeCloseTo(0.95, 4);
  });
});

describe("beta / gamma", () => {
  it("BETA.DIST(0.5, 2, 5) cdf = 0.890625", () => {
    const r = dist("beta", "cdf").data({ x: [0.5], alpha: [2], beta: [5] });
    expect(r.result).toBeCloseTo(0.890625, 5);
  });

  it("GAMMA.DIST(1, 2, 2) cdf = 0.090204", () => {
    const r = dist("gamma", "cdf").data({ x: [1], alpha: [2], beta: [2] });
    expect(r.result).toBeCloseTo(0.090204, 5);
  });
});

describe("lognormal / weibull / exponential", () => {
  it("LOGNORM.DIST(1, 0, 1) cdf = 0.5", () => {
    const r = dist("lognorm", "cdf").data({ x: [1], mean: [0], stdev: [1] });
    expect(r.result).toBeCloseTo(0.5, 4);
  });

  it("WEIBULL.DIST(1, 2, 2) cdf = 0.221199", () => {
    const r = dist("weibull", "cdf").data({ x: [1], alpha: [2], beta: [2] });
    expect(r.result).toBeCloseTo(0.221199, 5);
  });

  it("EXPON.DIST(1, 1) cdf = 1 - 1/e", () => {
    const r = dist("expon", "cdf").data({ x: [1], lambda: [1] });
    expect(r.result).toBeCloseTo(1 - Math.exp(-1), 6);
  });
});

describe("discrete family", () => {
  it("BINOM.DIST(3, 10, 0.5) pmf = 0.117188", () => {
    const r = dist("binom", "pmf").data({ k: [3], n: [10], p: [0.5] });
    expect(r.result).toBeCloseTo(0.117188, 5);
  });

  it("BINOM.DIST(3, 10, 0.5) cdf = 0.171875", () => {
    const r = dist("binom", "cdf").data({ k: [3], n: [10], p: [0.5] });
    expect(r.result).toBeCloseTo(0.171875, 5);
  });

  it("POISSON.DIST(3, 2) pmf = 0.180447", () => {
    const r = dist("poisson", "pmf").data({ k: [3], lambda: [2] });
    expect(r.result).toBeCloseTo(0.180447, 5);
  });

  it("POISSON.DIST(3, 2) cdf = 0.857123", () => {
    const r = dist("poisson", "cdf").data({ k: [3], lambda: [2] });
    expect(r.result).toBeCloseTo(0.857123, 5);
  });

  it("HYPGEOM.DIST(2, 5, 10, 20) pmf = 0.348297", () => {
    const r = dist("hypgeom", "pmf").data({ k: [2], n: [5], M: [10], N: [20] });
    expect(r.result).toBeCloseTo(0.348297, 5);
  });

  it("NEGBINOM.DIST(3, 5, 0.5) pmf = 0.136719", () => {
    const r = dist("negbinom", "pmf").data({ k: [3], r: [5], p: [0.5] });
    expect(r.result).toBeCloseTo(0.136719, 5);
  });
});

describe("the one-node mechanics", () => {
  it("BINOM.INV — smallest k whose cumulative probability reaches alpha", () => {
    // BINOM.INV(10, 0.5, 0.75) = 6
    const r = dist("binom", "inv").data({ prob: [0.75], n: [10], p: [0.5] });
    expect(r.result).toBe(6);
  });

  it("an inverse form swaps the first input from x to prob and back", () => {
    const node = dist("normal", "cdf");
    expect(node.inputs.x).toBeDefined();
    expect(node.inputs.prob).toBeUndefined();
    node.setForm("inv");
    expect(node.inputs.x).toBeUndefined();
    expect(node.inputs.prob).toBeDefined();
    node.setForm("pdf");
    expect(node.inputs.x).toBeDefined();
    expect(node.inputs.prob).toBeUndefined();
  });

  it("a distribution switch keeps shared params, swaps the rest", () => {
    const node = dist("normal", "cdf");
    expect(node.keysDroppedBySwitch("t" as never)).toEqual(["mean", "stdev"]);
    node.setOp("t" as never);
    expect(Object.keys(node.inputs).sort()).toEqual(["df", "x"]);
    expect(node.height).toBe(203 + 28);
  });

  it("the form survives a switch when the target has it, else lands on its sibling", () => {
    expect(formAfterSwitch("cdf", "t" as never)).toBe("cdf");
    expect(formAfterSwitch("pdf", "poisson" as never)).toBe("pmf");   // continuous → discrete
    expect(formAfterSwitch("pmf", "normal" as never)).toBe("pdf");    // discrete → continuous
    expect(formAfterSwitch("inv2t", "chisq" as never)).toBe("inv");   // inverse variant → plain inverse
    expect(formAfterSwitch("invrt", "weibull" as never)).toBe("cdf"); // no inverse at all → default
  });
});

describe("PHI / GAUSS — standard-normal forms that moved from Math", () => {
  const ev = (f: string) => compileEvaluator(f)!({}) as number;

  it("PHI is the standard-normal density φ(x)", () => {
    const peak = 1 / Math.sqrt(2 * Math.PI);
    expect(DIST_SPECS.phi.compute("pdf", 0, [])).toBeCloseTo(peak, 12);
    expect(dist("phi", "pdf").data({ x: [0] }).result).toBeCloseTo(peak, 12);
  });

  it("GAUSS is Φ − ½, the area from 0 to x", () => {
    expect(DIST_SPECS.gauss.compute("half", 0, [])).toBeCloseTo(0, 12);
    expect(DIST_SPECS.gauss.compute("half", 1.96, [])).toBeCloseTo(0.475, 4);
    expect(dist("gauss", "half").data({ x: [1.96] }).result).toBeCloseTo(0.475, 4);
  });

  it("the node and the formula agree", () => {
    expect(ev("GAUSS(1.96)")).toBeCloseTo(DIST_SPECS.gauss.compute("half", 1.96, [])!, 12);
    expect(ev("PHI(0)")).toBeCloseTo(DIST_SPECS.phi.compute("pdf", 0, [])!, 12);
  });
});
