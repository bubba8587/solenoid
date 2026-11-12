// [[B15]] leanCore, [[probability-pack]]
import { describe, it, expect } from "vitest";
import { ProbabilityBetweenNode, AbTestNode, BootstrapNode } from "../../../src/graph/nodes/probability";
import { isSolError } from "../../../src/graph/errorValue";
import { solDate } from "../../../src/graph/dateValue";
import { extractInit } from "../../../src/graph/nodeInit";

const code = (v: unknown) => (isSolError(v) ? v.code : v);

describe("Probability Between", () => {
  it("starts on the normal curve's middle sixty-eight percent", () => {
    const n = new ProbabilityBetweenNode();
    expect(n.data().result).toBeCloseTo(0.682689492, 8);
    expect(n.plotX).toHaveLength(161);
    expect(n.plotBars).toBe(false);
    expect([n.shadeLo, n.shadeHi]).toEqual([-1, 1]);
  });

  it("an empty end runs to infinity, and ends typed backwards are the same range", () => {
    const n = new ProbabilityBetweenNode();
    delete n.literals.lo;
    n.literals.hi = 1.96;
    expect(n.data().result).toBeCloseTo(0.9750021, 6);
    expect(n.shadeLo).toBeNull();
    n.literals.lo = 1;
    n.literals.hi = -1;
    expect(n.data().result).toBeCloseTo(0.682689492, 8);
  });

  it("a counting distribution includes both whole ends", () => {
    const n = new ProbabilityBetweenNode({ op: "binom" });
    expect([n.literals.lo, n.literals.hi]).toEqual([3, 7]);
    expect(n.data().result).toBeCloseTo(912 / 1024, 12);
    expect(n.plotBars).toBe(true);
    n.literals.lo = 2.5;
    n.literals.hi = 7.2;
    expect(n.data().result).toBeCloseTo(912 / 1024, 12);
    n.literals.lo = 4.2;
    n.literals.hi = 4.8;
    expect(n.data().result).toBe(0);
    const p = new ProbabilityBetweenNode({ op: "poisson" });
    expect(p.data().result).toBeCloseTo(0.7217881772619343, 10);
  });

  it("a parameter outside the domain is #DOMAIN! and a wired blank blanks it", () => {
    const n = new ProbabilityBetweenNode();
    n.literals.stdev = -1;
    expect(code(n.data().result)).toBe("#DOMAIN!");
    expect(n.plotX).toBeNull();
    expect(new ProbabilityBetweenNode().data({ mean: [null] }).result).toBeNull();
  });

  it("a family switch swaps the parameter rows and moves the handles", () => {
    const n = new ProbabilityBetweenNode();
    expect(n.keysDroppedBySwitch("t")).toEqual(["mean", "stdev"]);
    n.setOp("t");
    expect(Object.keys(n.inputs)).toEqual(["lo", "hi", "df"]);
    expect([n.literals.lo, n.literals.hi]).toEqual([-2, 2]);
    expect(n.literals.mean).toBeUndefined();
    const back = new ProbabilityBetweenNode(extractInit(n) as never);
    expect(back.op).toBe("t");
    expect(new ProbabilityBetweenNode({ op: "nope" as never }).op).toBe("normal");
  });
});

describe("A/B Test", () => {
  it("the chance B beats A is the closed form's, to five places", () => {
    const n = new AbTestNode();
    const out = n.data();
    expect(out.chance).toBeCloseTo(0.9244803789016689, 5);
    expect(n.cachedChance).toBe(out.chance);
    const [lift, low, high] = [out.lift, out.low, out.high] as number[];
    expect(low).toBeLessThan(lift);
    expect(lift).toBeLessThan(high);
    expect(lift).toBeCloseTo(0.296, 2);
    expect(n.plotX).toHaveLength(161);
  });

  it("two equal versions split evenly", () => {
    const n = new AbTestNode();
    n.literals.cb = 50;
    const out = n.data();
    expect(out.chance).toBeCloseTo(0.5, 4);
    expect(out.lift).toBeCloseTo(0, 3);
  });

  it("refuses more conversions than visitors, and negative counts, on every output", () => {
    const n = new AbTestNode();
    n.literals.ca = 2000;
    const out = n.data();
    for (const k of ["chance", "lift", "low", "high"] as const) expect(code(out[k])).toBe("#VALUE!");
    expect(n.plotX).toBeNull();
    n.literals.ca = -1;
    expect(code(n.data().chance)).toBe("#DOMAIN!");
  });
});

describe("Bootstrap", () => {
  const values = [[3, 7, 4, 9, 5, 6, 2, 8, 5, 6]];

  it("brackets the mean, and the same values give the same interval", () => {
    const n = new BootstrapNode();
    const a = n.data({ list: values });
    expect(a.estimate).toBeCloseTo(5.5, 12);
    expect(a.low).toBeLessThan(5.5);
    expect(a.high).toBeGreaterThan(5.5);
    expect(new BootstrapNode().data({ list: values })).toEqual(a);
    expect(n.plotY!.reduce((s, c) => s! + c!, 0)).toBe(10_000);
  });

  it("an empty Seed comes from the values; a typed one picks that shuffle", () => {
    const n = new BootstrapNode();
    const fromValues = n.data({ list: values });
    expect(new BootstrapNode().data({ list: values })).toEqual(fromValues);
    n.literals.seed = 7;
    const seven = n.data({ list: values });
    expect(new BootstrapNode().data({ list: values, seed: [7] })).toEqual(seven);
    const sevenCounts = n.plotY;
    n.data({ list: values, seed: [8] });
    expect(n.plotY).not.toEqual(sevenCounts);
    // On values that aren't whole numbers the interval itself moves from shuffle to shuffle.
    const smooth = [[3.1, 5.4, 4.2, 6.7, 2.3, 8.9, 5.05, 4.4, 7.2, 3.8, 5.6, 6.1]];
    const lows = new Set([1, 2, 3, 4, 5].map((k) => n.data({ list: smooth, seed: [k] }).low));
    expect(lows.size).toBeGreaterThan(1);
    expect(seven.estimate).toBe(fromValues.estimate);
  });

  it("a list of dates is #TYPE! naming them, never a blank, and a logical counts as 1 or 0", () => {
    const n = new BootstrapNode();
    const dated = n.data({ list: [[solDate(46000), solDate(46005), solDate(46011)]] });
    expect(code(dated.estimate)).toBe("#TYPE!");
    expect(isSolError(dated.estimate) && dated.estimate.message).toContain("holds dates");
    expect(n.data({ list: [[true, false, true, true]] }).estimate).toBe(0.75);
  });

  it("the op picks the statistic and names the output", () => {
    const n = new BootstrapNode({ op: "median" });
    expect(n.data({ list: values }).estimate).toBe(5.5);
    n.setOp("stdev");
    expect(n.outputs.estimate!.label).toBe("Std dev");
    expect(new BootstrapNode(extractInit(n) as never).op).toBe("stdev");
  });

  it("skips text and blanks; nothing is blank and one value has no spread", () => {
    const n = new BootstrapNode();
    expect(n.data({ list: [[1, "x", null, 3] as unknown as number[]] }).estimate).toBe(2);
    expect(n.data({ list: [[]] }).estimate).toBeNull();
    expect(code(n.data({ list: [[4]] }).low)).toBe("#DIV/0!");
  });
});

describe("the answers show as percents and stay fractions", () => {
  it("Probability Between and every A/B Test output author a percent; Bootstrap, in the data's units, doesn't", () => {
    const pb = new ProbabilityBetweenNode();
    expect(pb.annotationFor("result")).toEqual({ format: "percent", unit: "none" });
    expect(pb.data().result).toBeCloseTo(0.682689492, 8);
    const ab = new AbTestNode();
    for (const k of ["chance", "lift", "low", "high"]) expect(ab.annotationFor(k)?.format).toBe("percent");
    expect("annotationFor" in new BootstrapNode()).toBe(false);
  });
});

