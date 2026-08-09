import { describe, it, expect } from "vitest";
import {
  TvmNode,
  IpmtPpmtNode,
  NpvNode,
  IrrNode,
  MirrNode,
  DepreciationNode,
} from "./finance";
import { EquationNode } from "./equation";

// Reference values are what Excel's matching function returns. Excel cash-flow
// sign convention: money received is positive, money paid out is negative, so a
// loan's PMT/IPMT/PPMT are all negative when PV is positive.

// The TVM node is now ONE acausal Equation: wire four of {rate, nper, pmt, pv,
// fv}, read the fifth off its own output — no op selector, no guess input.
describe("TVM (equation)", () => {
  it("solves PMT like =PMT(0.08, 10, 10000)", () => {
    const r = new TvmNode().data({ rate: [0.08], nper: [10], pv: [10000], fv: [0] });
    expect(r.pmt).toBeCloseTo(-1490.29, 2);
  });

  it("solves PV like =PV(0.05, 10, -100)", () => {
    const r = new TvmNode().data({ rate: [0.05], nper: [10], pmt: [-100], fv: [0] });
    expect(r.pv).toBeCloseTo(772.17, 2);
  });

  it("solves FV like =FV(0.06, 10, -200, -500)", () => {
    const r = new TvmNode().data({ rate: [0.06], nper: [10], pmt: [-200], pv: [-500] });
    expect(r.fv).toBeCloseTo(3531.58, 2);
  });

  it("solves NPER like =NPER(0.05, -100, 1000)", () => {
    const r = new TvmNode().data({ rate: [0.05], pmt: [-100], pv: [1000], fv: [0] });
    expect(r.nper).toBeCloseTo(14.2067, 3);
  });

  it("solves RATE like =RATE(12, -100, 1000) — smallest-magnitude root, no guess", () => {
    const r = new TvmNode().data({ nper: [12], pmt: [-100], pv: [1000], fv: [0] });
    expect(r.rate).toBeCloseTo(0.029215, 4);
  });

  it("solves PMT at zero rate exactly (straight-line limit relation)", () => {
    const r = new TvmNode().data({ rate: [0], nper: [10], pv: [1000], fv: [0] });
    expect(r.pmt).toBeCloseTo(-100, 9);
    expect(r.rate).toBe(0); // the fixed rate still flows out its own socket
  });

  it("annuity-due PMT matches =PMT(0.08, 10, 10000, 0, 1)", () => {
    const node = new TvmNode({ paymentTiming: "beg" });
    const r = node.data({ rate: [0.08], nper: [10], pv: [10000], fv: [0] });
    expect(r.pmt).toBeCloseTo(-1490.294887 / 1.08, 2);
  });

  it("truth-checks when all five are wired", () => {
    const pmt = new TvmNode().data({ rate: [0.08], nper: [10], pv: [10000], fv: [0] }).pmt as number;
    const check = new TvmNode().data({ rate: [0.08], nper: [10], pv: [10000], fv: [0], pmt: [pmt] });
    expect(check.holds).toBe(true);
    const wrong = new TvmNode().data({ rate: [0.08], nper: [10], pv: [10000], fv: [0], pmt: [pmt + 1] });
    expect(wrong.holds).toBe(false);
  });

  it("zero-rate truth check is exact", () => {
    const r = new TvmNode().data({ rate: [0], nper: [10], pv: [1000], fv: [0], pmt: [-100] });
    expect(r.holds).toBe(true);
  });

  it("timing switch swaps the locked relation without changing sockets", () => {
    const node = new TvmNode();
    const before = [...node.varNames];
    node.setPaymentTiming("beg");
    expect(node.varNames).toEqual(before);
    expect(node.expr).toContain("pmt*(1+rate)*");
  });
});

// The two locked Equation presets that replaced PDURATION/RRI and
// EFFECT/NOMINAL (nodeCatalog.ts Finance) — same exprs, pinned to the Excel
// functions they stand in for.
describe("Compound Growth / Effective Rate presets", () => {
  const growth = () => new EquationNode({ expr: "fv = pv * (1 + rate)^nper", locked: true });
  const effective = () => new EquationNode({ expr: "eff = (1 + nom/npery)^npery - 1", locked: true });

  it("solves nper like =PDURATION(0.05, 1000, 2000)", () => {
    expect(growth().data({ rate: [0.05], pv: [1000], fv: [2000] }).nper).toBeCloseTo(14.2067, 3);
  });

  it("solves rate like =RRI(5, 1000, 2000)", () => {
    expect(growth().data({ nper: [5], pv: [1000], fv: [2000] }).rate).toBeCloseTo(0.148698, 5);
  });

  it("solves fv and pv lump-sum both ways", () => {
    expect(growth().data({ rate: [0.06], nper: [10], pv: [500] }).fv).toBeCloseTo(895.42, 2);
    expect(growth().data({ rate: [0.06], nper: [10], fv: [895.42] }).pv).toBeCloseTo(500, 2);
  });

  it("solves eff like =EFFECT(0.05, 12)", () => {
    expect(effective().data({ nom: [0.05], npery: [12] }).eff).toBeCloseTo(0.051162, 5);
  });

  it("solves nom like =NOMINAL(0.051162, 12)", () => {
    expect(effective().data({ eff: [0.0511619], npery: [12] }).nom).toBeCloseTo(0.05, 6);
  });
});

describe("IPMT / PPMT", () => {
  // =IPMT(0.05, 1, 12, 1000) = -50.00, =PPMT(0.05, 1, 12, 1000) = -62.83
  it("IPMT period 1 is the first-period interest, sharing PMT's sign", () => {
    const r = new IpmtPpmtNode({ op: "ipmt" }).data({ rate: [0.05], per: [1], nper: [12], pv: [1000], fv: [0] });
    expect(r.result).toBeCloseTo(-50, 2);
  });

  it("IPMT period 2 matches Excel", () => {
    const r = new IpmtPpmtNode({ op: "ipmt" }).data({ rate: [0.05], per: [2], nper: [12], pv: [1000], fv: [0] });
    expect(r.result).toBeCloseTo(-46.86, 2);
  });

  it("PPMT period 1 matches Excel", () => {
    const r = new IpmtPpmtNode({ op: "ppmt" }).data({ rate: [0.05], per: [1], nper: [12], pv: [1000], fv: [0] });
    expect(r.result).toBeCloseTo(-62.83, 2);
  });

  it("annuity-due IPMT is zero in period 1 (payment is up front)", () => {
    const r = new IpmtPpmtNode({ op: "ipmt", paymentTiming: "beg" })
      .data({ rate: [0.05], per: [1], nper: [12], pv: [1000], fv: [0] });
    expect(r.result).toBeCloseTo(0, 9);
  });

  it("IPMT + PPMT = PMT for the period", () => {
    const args = { rate: [0.05], per: [3], nper: [12], pv: [1000], fv: [0] };
    const ipmt = new IpmtPpmtNode({ op: "ipmt" }).data(args).result!;
    const ppmt = new IpmtPpmtNode({ op: "ppmt" }).data(args).result!;
    const pmt = new TvmNode().data({ rate: [0.05], nper: [12], pv: [1000], fv: [0] }).pmt as number;
    expect(ipmt + ppmt).toBeCloseTo(pmt, 6);
  });
});

describe("NPV", () => {
  it("matches =NPV(0.1, 100, 200, 300)", () => {
    const r = new NpvNode().data({ rate: [0.1], list: [[100, 200, 300]] });
    expect(r.result).toBeCloseTo(481.59, 2);
  });
});

describe("IRR", () => {
  it("finds the rate where NPV = 0", () => {
    // -100 now, 146.41 in 4 periods → exactly 10%
    const r = new IrrNode().data({ list: [[-100, 0, 0, 0, 146.41]] });
    expect(r.result).toBeCloseTo(0.1, 4);
  });

  it("matches a typical project IRR", () => {
    const r = new IrrNode().data({ list: [[-1000, 300, 400, 500, 600]] });
    expect(r.result).toBeCloseTo(0.248886, 4);
  });
});

describe("MIRR", () => {
  it("matches =MIRR({-1000,300,400,500}, 0.1, 0.12)", () => {
    const r = new MirrNode().data({ list: [[-1000, 300, 400, 500]], finrate: [0.1], reinrate: [0.12] });
    expect(r.result).toBeCloseTo(0.09816, 4);
  });
});

describe("Depreciation", () => {
  it("SLN is constant", () => {
    const r = new DepreciationNode({ op: "sln" }).data({ cost: [10000], salvage: [1000], life: [5] });
    expect(r.result).toBeCloseTo(1800, 9);
  });

  it("SYD weights early periods", () => {
    const r = new DepreciationNode({ op: "syd" }).data({ cost: [10000], salvage: [1000], life: [5], per: [1] });
    expect(r.result).toBeCloseTo(3000, 9);
  });

  it("DDB doubles the straight-line rate against book value", () => {
    const p1 = new DepreciationNode({ op: "ddb" }).data({ cost: [10000], salvage: [1000], life: [5], per: [1], factor: [2] });
    expect(p1.result).toBeCloseTo(4000, 9);
    const p2 = new DepreciationNode({ op: "ddb" }).data({ cost: [10000], salvage: [1000], life: [5], per: [2], factor: [2] });
    expect(p2.result).toBeCloseTo(2400, 9);
  });
});

describe("Depreciation — VDB absorbed as an op", () => {
  it("VDB matches the standalone kernel's period-range result", () => {
    const r = new DepreciationNode({ op: "vdb" }).data({ cost: [10000], salvage: [1000], life: [10], start: [0], end: [1], factor: [2] });
    expect(r.result).toBeCloseTo(2000, 6); // first-period DDB at factor 2
  });

  it("the op switch swaps the method's own tail rows, keeping cost/salvage/life", () => {
    const n = new DepreciationNode({ op: "ddb" });
    expect(Object.keys(n.inputs)).toEqual(["cost", "salvage", "life", "per", "factor"]);
    expect(n.keysDroppedBySwitch("vdb")).toEqual(["per"]);
    expect(n.keysDroppedBySwitch("sln").sort()).toEqual(["factor", "per"]);
    n.setOp("vdb");
    expect(Object.keys(n.inputs)).toEqual(["cost", "salvage", "life", "start", "end", "factor"]);
    n.setOp("sln");
    expect(Object.keys(n.inputs)).toEqual(["cost", "salvage", "life"]);
  });
});
