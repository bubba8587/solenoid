import { describe, it, expect } from "vitest";
import { NpvNode, IrrNode, MirrNode } from "./finance";
import { parseDateToSerial } from "./date";
import { compileEvaluator } from "../excelFormula";
import { isSolError } from "../errorValue";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);

// IRR/XIRR/MIRR are the finance-iterative family (own root-finder, no Formula.js). The
// defining invariant needs no oracle: IRR is the rate that zeroes NPV, XIRR the rate that
// zeroes XNPV. A solver that returns a rate NOT satisfying its own equation is broken.

const flows = [-1000, 300, 400, 500, 200];

describe("IRR zeroes NPV (its defining equation)", () => {
  it("NPV at the IRR is ~0", () => {
    const irr = new IrrNode().data({ list: [flows] }).result as number;
    expect(typeof irr).toBe("number");
    const npvAtIrr = new NpvNode().data({ rate: [irr], list: [flows] }).result as number;
    expect(npvAtIrr).toBeCloseTo(0, 5);
  });
  it("a same-sign series has no IRR (#CONV!), not a fabricated number", () => {
    const r = new IrrNode().data({ list: [[100, 200, 300]] }).result;
    expect(r && typeof r === "object" && "code" in r ? (r as { code: string }).code : r).toBe("#CONV!");
  });
});

describe("XIRR zeroes XNPV (dated, actual/365 from the first date)", () => {
  const d = (s: string) => parseDateToSerial(s);
  const dates = [d("2020-01-01"), d("2020-06-01"), d("2021-01-01"), d("2021-06-01"), d("2022-01-01")];
  it("XNPV at the XIRR is ~0", () => {
    const xirr = new IrrNode({ mode: "dates" }).data({ list: [flows], dates: [dates] }).result as number;
    expect(typeof xirr).toBe("number");
    const xnpvAtXirr = new NpvNode({ mode: "dates" }).data({ rate: [xirr], list: [flows], dates: [dates] }).result as number;
    expect(xnpvAtXirr).toBeCloseTo(0, 4);
  });
});

// Both IRR modes run ONE kernel (`solveDiscountRate`) differing only in the exponent
// — period index vs year fraction. These pin the two properties that kernel exists to
// hold, each of which was a real defect before it: the rate floor, and a convergence
// test that scales with the root.
describe("the discount-rate solver holds its floor and scales its tolerance", () => {
  const npvAt = (cf: number[], r: number) =>
    cf.reduce((a, c, t) => a + c / Math.pow(1 + r, t), 0);

  // Newton overshoots below r = −1 on each of these. Unfloored it either diverged to a
  // non-root (−1.51 on the first) or gave up and reported #CONV!; the floor keeps the
  // step in domain and every one lands on its real root.
  it.each([
    [[-4622, 278, 1374], -0.4238693662187992],
    [[-4742, 1676, -626, 987], -0.353171545803561],
    [[-4119, -136, 468], -0.6790294499465206],
    [[-4689, -332, 1789, 120, -697, 716], -0.29199810606564947],
    [[-4175, 1273, -561, 351, -371, 873], -0.2562888967693534],
  ])("solves %j to its real root, not #CONV!", (cf, root) => {
    const r = new IrrNode().data({ list: [cf as number[]] }).result;
    expect(typeof r).toBe("number");
    expect(r as number).toBeCloseTo(root as number, 10);
    expect(npvAt(cf as number[], r as number)).toBeCloseTo(0, 6);
  });

  // A root crowded against the floor (near r = −0.9), where the discount curve is
  // near-vertical: Newton from its fixed 0.1 guess overshoots the floor and reports
  // #CONV!, so a bracket-and-bisect fallback catches it. Each has a SINGLE real root
  // above the floor, so the fallback isn't choosing among ambiguous multiple roots.
  it.each([
    [[-4943, -2458, 285], -0.9029808860688493],
    [[45, 4730, -325], -0.9313344974219845],
    [[-1688, -3813, 432], -0.891878604425277],
  ])("finds a near-floor root Newton overshoots (%j)", (cf, root) => {
    const r = new IrrNode().data({ list: [cf as number[]] }).result;
    expect(typeof r).toBe("number");
    expect(r as number).toBeCloseTo(root as number, 9);
    expect(npvAt(cf as number[], r as number)).toBeCloseTo(0, 6);
  });

  it("never answers with the floor itself — a pinned solve is #CONV!", () => {
    // Same-sign flows have no root at all; the floor must not read as a settled one.
    const r = new IrrNode().data({ list: [[100, 200, 300]] }).result;
    expect(r).not.toBe(-0.9999);
    expect((r as { code: string }).code).toBe("#CONV!");
  });

  it("a runaway rate still converges (relative tolerance, not absolute)", () => {
    // A tiny outlay against large fast inflows: the honest answer is ~3,104,300%/yr.
    // An absolute epsilon tight enough for a 5% root refuses this one outright.
    const values = [-444, 852, 696, 152, 52, 1545];
    const dates = [45000, 45023, 45541, 46060, 46503, 46599];
    const r = new IrrNode({ mode: "dates" }).data({ list: [values], dates: [dates] }).result;
    expect(typeof r).toBe("number");
    expect(r as number).toBeGreaterThan(1000);
    const d0 = dates[0];
    const xnpv = values.reduce((a, v, i) => a + v / Math.pow(1 + (r as number), (dates[i] - d0) / 365), 0);
    expect(Math.abs(xnpv)).toBeLessThan(1e-6);
  });
});

describe("MIRR matches an independent build of Excel's documented formula", () => {
  it("MIRR = (FVpos@reinvest / −PVneg@finance)^(1/(n−1)) − 1", () => {
    const finrate = 0.10, reinrate = 0.12, n = flows.length;
    // Independent reimplementation of the documented formula (not the node's code path).
    let fvPos = 0, pvNeg = 0;
    flows.forEach((f, i) => {
      if (f > 0) fvPos += f * (1 + reinrate) ** (n - 1 - i);
      else if (f < 0) pvNeg += f / (1 + finrate) ** i;
    });
    const expected = (-fvPos / pvNeg) ** (1 / (n - 1)) - 1;
    const mirr = new MirrNode().data({ list: [flows], finrate: [finrate], reinrate: [reinrate] }).result as number;
    expect(mirr).toBeCloseTo(expected, 9);
  });
});

// capabilityParity / shareImpl: the IRR and XIRR FORMULAS run the node's solver
// (financeOps.solveDiscountRate) — they used to fall through to Formula.js, whose
// Newton answered 1000 (!) on the near-floor series the node solves. And the cash-flow
// blank policy must match across surfaces: a blank period is a ZERO flow (dropping it
// would shift every later period), a blank date makes the schedule unknown.
describe("IRR / XIRR / NPV / MIRR formulas agree with their nodes", () => {
  const d = (s: string) => parseDateToSerial(s);
  const dates = [d("2020-01-01"), d("2020-06-01"), d("2021-01-01"), d("2021-06-01"), d("2022-01-01")];

  it.each([
    [[-4943, -2458, 285]],
    [[45, 4730, -325]],
    [[-1688, -3813, 432]],
    [flows],
  ])("IRR(%j) is the node's root", (cf) => {
    const node = new IrrNode().data({ list: [cf as number[]] }).result as number;
    expect(ev("IRR(c)", { c: cf })).toBeCloseTo(node, 12);
    expect(ev("IRR(c, 0.2)", { c: cf })).toBeCloseTo(node, 12); // guess accepted, ignored
  });
  it("XIRR formula is the node's dated root", () => {
    const node = new IrrNode({ mode: "dates" }).data({ list: [flows], dates: [dates] }).result as number;
    expect(ev("XIRR(c, d)", { c: flows, d: dates })).toBeCloseTo(node, 12);
  });
  it("a same-sign series is #CONV! on both surfaces; too few points is blank", () => {
    const r = ev("IRR(c)", { c: [100, 200, 300] });
    expect(isSolError(r) && r.code).toBe("#CONV!");
    expect(ev("IRR(c)", { c: [100] })).toBeNull();
  });
  it("a blank cash flow is a ZERO period on both surfaces, never a dropped one", () => {
    const cf = [-100, null, 60, 60];
    expect(ev("IRR(c)", { c: cf })).toBeCloseTo(new IrrNode().data({ list: [cf] }).result as number, 12);
    expect(ev("NPV(0.1, c)", { c: cf })).toBeCloseTo(new NpvNode().data({ list: [cf], rate: [0.1] }).result as number, 12);
    expect(ev("MIRR(c, 0.1, 0.12)", { c: cf })).toBeCloseTo(
      new MirrNode().data({ list: [cf], finrate: [0.1], reinrate: [0.12] }).result as number, 12);
  });
  it("a blank DATE makes XIRR blank on both surfaces (the schedule is unknown)", () => {
    const ds = [dates[0], null, dates[2], dates[3], dates[4]];
    expect(ev("XIRR(c, d)", { c: flows, d: ds })).toBeNull();
    expect(new IrrNode({ mode: "dates" }).data({ list: [flows], dates: [ds as number[]] }).result).toBeNull();
  });
});
