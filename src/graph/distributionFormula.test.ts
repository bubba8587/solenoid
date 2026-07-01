// The distributions Formula.js LACKS (the T family, right-tail variants, GAMMA.DIST/INV)
// are registered with OUR impls (excelFunctions.ts). This locks formula == the visual
// dist NODE — the same mathUtils formulas back both, so a distribution typed in an
// Expression matches the dedicated node exactly.
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";
import { TDistNode, TInvNode, ChisqDistNode, ChisqInvNode } from "./nodes/dist-normal";
import { FDistNode, FInvNode, GammaDistNode, GammaInvNode } from "./nodes/dist-continuous";
describe("registered gap distributions match the NODES", () => {
  const ev = (e: string) => compileEvaluator(e)!({});
  const close = (a: unknown, b: unknown) => expect(Math.abs((a as number) - (b as number))).toBeLessThan(1e-6);
  it("T family", () => {
    close(ev("T.DIST(2, 10, 1)"), new TDistNode({op:"cdf" as never}).data({x:[2],df:[10]}).result);
    close(ev("T.DIST(2, 10, 0)"), new TDistNode({op:"pdf" as never}).data({x:[2],df:[10]}).result);
    close(ev("T.DIST.RT(2, 10)"), new TDistNode({op:"rt" as never}).data({x:[2],df:[10]}).result);
    close(ev("T.DIST.2T(2, 10)"), new TDistNode({op:"2t" as never}).data({x:[2],df:[10]}).result);
    close(ev("T.INV(0.95, 10)"), new TInvNode({op:"left" as never}).data({prob:[0.95],df:[10]}).result);
    close(ev("T.INV.2T(0.05, 10)"), new TInvNode({op:"twotail" as never}).data({prob:[0.05],df:[10]}).result);
  });
  it("CHISQ.RT + F.RT", () => {
    close(ev("CHISQ.DIST.RT(8, 5)"), new ChisqDistNode({op:"rt" as never}).data({x:[8],df:[5]}).result);
    close(ev("CHISQ.INV.RT(0.05, 5)"), new ChisqInvNode({op:"rt" as never}).data({prob:[0.05],df:[5]}).result);
    close(ev("F.DIST.RT(3, 5, 10)"), new FDistNode({op:"rt" as never}).data({x:[3],df1:[5],df2:[10]}).result);
    close(ev("F.INV.RT(0.05, 5, 10)"), new FInvNode({op:"rt" as never}).data({prob:[0.05],df1:[5],df2:[10]}).result);
  });
  it("GAMMA", () => {
    close(ev("GAMMA.DIST(5, 2, 3, 1)"), new GammaDistNode({op:"cdf" as never}).data({x:[5],alpha:[2],beta:[3]}).result);
    close(ev("GAMMA.DIST(5, 2, 3, 0)"), new GammaDistNode({op:"pdf" as never}).data({x:[5],alpha:[2],beta:[3]}).result);
    close(ev("GAMMA.INV(0.5, 2, 3)"), new GammaInvNode().data({prob:[0.5],alpha:[2],beta:[3]}).result);
  });
});
