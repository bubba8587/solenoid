// The distributions Formula.js LACKS (the T family, right-tail variants, GAMMA.DIST/INV)
// are registered with OUR impls (excelFunctions.ts). This locks formula == the visual
// dist NODE — the same mathUtils formulas back both, so a distribution typed in an
// Expression matches the dedicated node exactly.
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";
import { DistributionNode } from "./nodes/distribution";

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
