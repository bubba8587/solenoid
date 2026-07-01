import { describe, it, expect } from "vitest";
import {
  TvmNode,
  RateNode,
  IpmtPpmtNode,
  NpvNode,
  IrrNode,
  MirrNode,
  DepreciationNode,
} from "./finance";

// Reference values are what Excel's matching function returns. Excel cash-flow
// sign convention: money received is positive, money paid out is negative, so a
// loan's PMT/IPMT/PPMT are all negative when PV is positive.

describe("TVM", () => {
  it("PMT matches =PMT(0.08, 10, 10000)", () => {
    const r = new TvmNode({ op: "pmt" }).data({ rate: [0.08], nper: [10], pv: [10000], fv: [0] });
    expect(r.result).toBeCloseTo(-1490.29, 2);
  });

  it("PV matches =PV(0.05, 10, -100)", () => {
    const r = new TvmNode({ op: "pv" }).data({ rate: [0.05], nper: [10], pmt: [-100], fv: [0] });
    expect(r.result).toBeCloseTo(772.17, 2);
  });

  it("FV matches =FV(0.06, 10, -200, -500)", () => {
    const r = new TvmNode({ op: "fv" }).data({ rate: [0.06], nper: [10], pmt: [-200], pv: [-500] });
    expect(r.result).toBeCloseTo(3531.58, 2);
  });

  it("NPER matches =NPER(0.05, -100, 1000)", () => {
    const r = new TvmNode({ op: "nper" }).data({ rate: [0.05], pmt: [-100], pv: [1000], fv: [0] });
    expect(r.result).toBeCloseTo(14.2067, 3);
  });

  it("PMT at zero rate is straight-line", () => {
    const r = new TvmNode({ op: "pmt" }).data({ rate: [0], nper: [10], pv: [1000], fv: [0] });
    expect(r.result).toBeCloseTo(-100, 9);
  });
});

describe("RATE", () => {
  it("solves =RATE(12, -100, 1000)", () => {
    const r = new RateNode().data({ nper: [12], pmt: [-100], pv: [1000], fv: [0], guess: [0.1] });
    expect(r.result).toBeCloseTo(0.029215, 4);
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
    const pmt = new TvmNode({ op: "pmt" }).data({ rate: [0.05], nper: [12], pv: [1000], fv: [0] }).result!;
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
