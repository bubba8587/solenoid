// The distributions Formula.js LACKS (the T family, right-tail variants, GAMMA.DIST/INV)
// are registered with OUR impls (excelFunctions.ts). This locks formula == the visual
// dist NODE. As of 2026-08-23 both surfaces call the SAME shared kernels (mathUtils
// tCDF/tPDF/chiSqCDF/fCDF/gammaCDF/gammaPDF) rather than separate hand-rolled copies, so
// the agreement is structural — this test guards that nobody re-forks one surface.
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { DistributionNode } from "../../src/graph/nodes/distribution";
import { sampleQuantile } from "../../src/graph/nodes/distributionOps";
import { requestRecalc } from "../../src/graph/process";
const dist = (op: string, form: string) =>
  new DistributionNode({ op: op as never, form: form as never });
describe("registered gap distributions match the NODES", () => {
  const ev = (e: string) => compileEvaluator(e)!({});
  const close = (a: unknown, b: unknown) => expect(Math.abs((a as number) - (b as number))).toBeLessThan(1e-6);
  it("T family", () => {
    close(ev("T.DIST(2, 10, 1)"), dist("t", "cdf").data({x:[2],df:[10]}).result);
    close(ev("T.DIST(2, 10, 0)"), dist("t", "pdf").data({x:[2],df:[10]}).result);
    close(ev("T.DIST.RT(2, 10)"), dist("t", "rt").data({x:[2],df:[10]}).result);
    close(ev("T.DIST.2T(2, 10)"), dist("t", "2t").data({x:[2],df:[10]}).result);
    close(ev("T.INV(0.95, 10)"), dist("t", "inv").data({prob:[0.95],df:[10]}).result);
    close(ev("T.INV.2T(0.05, 10)"), dist("t", "inv2t").data({prob:[0.05],df:[10]}).result);
  });
  it("CHISQ.RT + F.RT", () => {
    close(ev("CHISQ.DIST.RT(8, 5)"), dist("chisq", "rt").data({x:[8],df:[5]}).result);
    close(ev("CHISQ.INV.RT(0.05, 5)"), dist("chisq", "invrt").data({prob:[0.05],df:[5]}).result);
    close(ev("F.DIST.RT(3, 5, 10)"), dist("f", "rt").data({x:[3],df1:[5],df2:[10]}).result);
    close(ev("F.INV.RT(0.05, 5, 10)"), dist("f", "invrt").data({prob:[0.05],df1:[5],df2:[10]}).result);
  });
  it("GAMMA", () => {
    close(ev("GAMMA.DIST(5, 2, 3, 1)"), dist("gamma", "cdf").data({x:[5],alpha:[2],beta:[3]}).result);
    close(ev("GAMMA.DIST(5, 2, 3, 0)"), dist("gamma", "pdf").data({x:[5],alpha:[2],beta:[3]}).result);
    close(ev("GAMMA.INV(0.5, 2, 3)"), dist("gamma", "inv").data({prob:[0.5],alpha:[2],beta:[3]}).result);
  });
});

// A1 backing flip (2026-08-23): the names Formula.js DOES have now run the node's spec
// table too (distributionOps.DIST_SPECS), in Excel's argument order. Pinned exact (same
// kernel, same call) plus a few absolute anchors so a kernel regression can't hide
// behind a shared mistake.
describe("Formula.js-overlap distributions run the NODE's DIST_SPECS", () => {
  const ev = (e: string) => compileEvaluator(e)!({});
  const eq = (a: unknown, b: unknown) => expect(a).toBe(b);
  it("NORM / NORM.S / LOGNORM", () => {
    eq(ev("NORM.DIST(1.5, 1, 2, TRUE)"), dist("normal", "cdf").data({x:[1.5],mean:[1],stdev:[2]}).result);
    eq(ev("NORM.DIST(1.5, 1, 2, FALSE)"), dist("normal", "pdf").data({x:[1.5],mean:[1],stdev:[2]}).result);
    eq(ev("NORM.INV(0.9, 1, 2)"), dist("normal", "inv").data({prob:[0.9],mean:[1],stdev:[2]}).result);
    eq(ev("NORM.S.DIST(1.96, TRUE)"), dist("normal-s", "cdf").data({z:[1.96]}).result);
    eq(ev("NORM.S.INV(0.975)"), dist("normal-s", "inv").data({prob:[0.975]}).result);
    eq(ev("LOGNORM.DIST(4, 3.5, 1.2, TRUE)"), dist("lognorm", "cdf").data({x:[4],mean:[3.5],stdev:[1.2]}).result);
    eq(ev("LOGNORM.INV(0.039084, 3.5, 1.2)"), dist("lognorm", "inv").data({prob:[0.039084],mean:[3.5],stdev:[1.2]}).result);
    // absolute anchors (Excel's documented examples / double-precision Φ)
    expect(ev("NORM.DIST(0, 0, 1, TRUE)")).toBe(0.5);
    expect(ev("NORM.S.DIST(1.96, TRUE)")).toBeCloseTo(0.9750021048517795, 14);
    expect(ev("NORM.S.INV(0.975)")).toBeCloseTo(1.959963984540054, 12);
    expect(ev("NORM.DIST(42, 40, 1.5, TRUE)")).toBeCloseTo(0.9087887802741321, 12);
    expect(ev("LOGNORM.DIST(4, 3.5, 1.2, TRUE)")).toBeCloseTo(0.0390835557068, 9);
  });
  it("CHISQ / F / BETA / WEIBULL / EXPON", () => {
    eq(ev("CHISQ.DIST(3, 4, TRUE)"), dist("chisq", "cdf").data({x:[3],df:[4]}).result);
    eq(ev("CHISQ.DIST(3, 4, FALSE)"), dist("chisq", "pdf").data({x:[3],df:[4]}).result);
    eq(ev("CHISQ.INV(0.93, 4)"), dist("chisq", "inv").data({prob:[0.93],df:[4]}).result);
    eq(ev("F.DIST(15.2, 6, 4, TRUE)"), dist("f", "cdf").data({x:[15.2],df1:[6],df2:[4]}).result);
    eq(ev("F.INV(0.01, 6, 4)"), dist("f", "inv").data({prob:[0.01],df1:[6],df2:[4]}).result);
    eq(ev("BETA.DIST(0.4, 8, 10, TRUE)"), dist("beta", "cdf").data({x:[0.4],alpha:[8],beta:[10]}).result);
    eq(ev("BETA.INV(0.685, 8, 10)"), dist("beta", "inv").data({prob:[0.685],alpha:[8],beta:[10]}).result);
    eq(ev("WEIBULL.DIST(105, 20, 100, TRUE)"), dist("weibull", "cdf").data({x:[105],alpha:[20],beta:[100]}).result);
    eq(ev("EXPON.DIST(0.2, 10, TRUE)"), dist("expon", "cdf").data({x:[0.2],lambda:[10]}).result);
    // Excel's optional [A, B] bounds on BETA: x rescales onto [0,1], the density by 1/(B−A)
    expect(ev("BETA.DIST(2, 8, 10, TRUE, 1, 3)")).toBeCloseTo(0.6854705810117458, 10);
    expect(ev("BETA.DIST(2, 8, 10, FALSE, 1, 3)")).toBeCloseTo(1.4837646, 6);
    expect(ev("BETA.INV(0.685470581, 8, 10, 1, 3)")).toBeCloseTo(2, 8);
    expect(ev("EXPON.DIST(0.2, 10, TRUE)")).toBeCloseTo(0.8646647167633873, 12);
    expect(ev("WEIBULL.DIST(105, 20, 100, TRUE)")).toBeCloseTo(0.9295813900692769, 12);
  });
  it("BINOM / POISSON / HYPGEOM / NEGBINOM (discrete: FALSE = PMF)", () => {
    eq(ev("BINOM.DIST(6, 10, 0.5, FALSE)"), dist("binom", "pmf").data({k:[6],n:[10],p:[0.5]}).result);
    eq(ev("BINOM.DIST(6, 10, 0.5, TRUE)"), dist("binom", "cdf").data({k:[6],n:[10],p:[0.5]}).result);
    eq(ev("BINOM.INV(6, 0.5, 0.75)"), dist("binom", "inv").data({prob:[0.75],n:[6],p:[0.5]}).result);
    eq(ev("POISSON.DIST(2, 5, TRUE)"), dist("poisson", "cdf").data({k:[2],lambda:[5]}).result);
    eq(ev("HYPGEOM.DIST(1, 4, 8, 20, FALSE)"), dist("hypgeom", "pmf").data({k:[1],n:[4],M:[8],N:[20]}).result);
    eq(ev("NEGBINOM.DIST(10, 5, 0.25, FALSE)"), dist("negbinom", "pmf").data({k:[10],r:[5],p:[0.25]}).result);
    expect(ev("BINOM.DIST(6, 10, 0.5, FALSE)")).toBeCloseTo(0.205078125, 12);
    expect(ev("BINOM.DIST(6, 10, 0.5, TRUE)")).toBeCloseTo(0.828125, 12);
    expect(ev("BINOM.INV(6, 0.5, 0.75)")).toBe(4);
    expect(ev("POISSON.DIST(2, 5, TRUE)")).toBeCloseTo(0.124652019, 8);
    expect(ev("HYPGEOM.DIST(1, 4, 8, 20, FALSE)")).toBeCloseTo(0.363261094, 8);
    expect(ev("NEGBINOM.DIST(10, 5, 0.25, FALSE)")).toBeCloseTo(0.0550486603, 8);
  });
  it("a domain refusal is a blank on both surfaces, never a number", () => {
    expect(ev("NORM.DIST(1, 0, -1, TRUE)")).toBeNull();
    expect(dist("normal", "cdf").data({x:[1],mean:[0],stdev:[-1]}).result).toBeNull();
    expect(ev("BINOM.DIST(11, 10, 0.5, FALSE)")).toBeNull();
  });
});

describe("the `sample` form — N draws by inverse CDF, seeded per recalculation", () => {
  const ev = (e: string) => compileEvaluator(e)!({});
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  it("sampleQuantile inverts every family (closed inverse, bisection, or a discrete walk)", () => {
    expect(sampleQuantile("normal", 0.5, [10, 2])).toBeCloseTo(10, 9);
    expect(sampleQuantile("expon", 1 - Math.exp(-1), [1])).toBeCloseTo(1, 6);     // F(1) = 1 − e⁻¹ → 1
    expect(sampleQuantile("weibull", 1 - Math.exp(-1), [2, 3])).toBeCloseTo(3, 6); // scale 3 at F = 1 − e⁻¹
    expect(sampleQuantile("poisson", 0.5, [3])).toBe(3);                          // median of Poisson(3)
    expect(sampleQuantile("binom", 0.5, [10, 0.5])).toBe(5);
    expect(sampleQuantile("normal", 0.5, [10, -1])).toBeNull();                   // invalid sd
  });
  it("the node draws N values whose marginal matches; the same pass is stable, a recalc re-rolls", async () => {
    const n = dist("normal", "sample");
    expect(n.inputs.count).toBeDefined(); expect(n.inputs.x).toBeUndefined();
    n.literals.count = 4000; n.literals.mean = 50; n.literals.stdev = 5;
    const a = n.data({}).result as number[];
    expect(a).toHaveLength(4000);
    expect(mean(a)).toBeCloseTo(50, 0);
    expect(Math.sqrt(mean(a.map((v) => (v - 50) ** 2)))).toBeCloseTo(5, 0);
    const b = n.data({}).result as number[];
    expect(b).toEqual(a);                      // same recalculation → the same draws
    await requestRecalc();
    const c = n.data({}).result as number[];
    expect(c).not.toEqual(a);                  // F9 → a fresh stream
    // switching form back swaps the first socket to x again
    n.setForm("cdf");
    expect(n.inputs.x).toBeDefined(); expect(n.inputs.count).toBeUndefined();
  });
  it("RANDDIST(family, n, params…) draws the same family; a bad family is #DOMAIN!", () => {
    const p = ev("RANDDIST(\"poisson\", 500, 3)") as number[];
    expect(p).toHaveLength(500);
    expect(p.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    expect(mean(p)).toBeCloseTo(3, 0);
    const u = ev("RANDDIST(\"normal\", 2000)") as number[]; // defaults: mean 0, sd 1
    expect(Math.abs(mean(u))).toBeLessThan(0.1);
    expect((ev("RANDDIST(\"cauchy\", 5)") as { code?: string }).code).toBe("#DOMAIN!");
  });
});
