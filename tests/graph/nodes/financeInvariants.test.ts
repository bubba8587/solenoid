import { describe, it, expect } from "vitest";
import {
  BondPriceNode, DiscountSecurityNode, DurationNode, OddCouponNode, CouponNode, AccruedInterestNode,
} from "../../../src/graph/nodes/finance";
import { vdb, accrintM } from "../../../src/graph/nodes/financeOps";
import { parseDateToSerial } from "../../../src/graph/nodes/date";

// Formula.js implements almost none of the bond/coupon family, so these functions have
// no external oracle. These tests pin INVARIANTS that must hold whatever the exact value
// is — inverse round-trips, day-count identities, depreciation totals — plus the
// real-Excel GOLDEN values the author verified by hand (2026-08-31).

const d = (s: string) => parseDateToSerial(s);
const settle = d("2024-01-15"), maturity = d("2029-01-15");

describe("real-Excel golden values (author-verified 2026-08-31)", () => {
  it("ODDFPRICE / ODDFYIELD — the first coupon accrues from ISSUE across quasi periods", () => {
    // =ODDFPRICE(DATE(2024,1,25),DATE(2031,1,1),DATE(2023,11,11),DATE(2024,7,1),0.0575,0.06,100,2,0)
    const args = { settle: [d("2024-01-25")], maturity: [d("2031-01-01")], issue: [d("2023-11-11")], firstlast: [d("2024-07-01")], rate: [0.0575], redemption: [100], frequency: [2] };
    expect(new OddCouponNode({ op: "oddfprice" }).data({ ...args, yld: [0.06] }).result!)
      .toBeCloseTo(98.5737779, 6);
    // =ODDFYIELD(DATE(2024,1,25),DATE(2031,1,1),DATE(2023,11,11),DATE(2024,7,1),0.0575,98,100,2,0)
    expect(new OddCouponNode({ op: "oddfyield" }).data({ ...args, pr: [98] }).result!)
      .toBeCloseTo(0.061035365, 8);
  });
  it("ODDLPRICE / ODDLYIELD — the odd-last period discounts with SIMPLE interest", () => {
    // =ODDLPRICE(DATE(2024,2,7),DATE(2024,6,15),DATE(2023,10,15),0.0375,0.0405,100,2,0)
    const args = { settle: [d("2024-02-07")], maturity: [d("2024-06-15")], firstlast: [d("2023-10-15")], rate: [0.0375], redemption: [100], frequency: [2] };
    expect(new OddCouponNode({ op: "oddlprice" }).data({ ...args, yld: [0.0405] }).result!)
      .toBeCloseTo(99.87828601, 7);
    // =ODDLYIELD(DATE(2024,2,7),DATE(2024,6,15),DATE(2023,10,15),0.0375,99.8,100,2,0)
    expect(new OddCouponNode({ op: "oddlyield" }).data({ ...args, pr: [99.8] }).result!)
      .toBeCloseTo(0.042712116, 8);
  });
  it("ACCRINT per basis — E is 360/freq for actual/360, actual only for actual/actual", () => {
    // =ACCRINT(DATE(2023,7,15),DATE(2024,1,15),DATE(2024,1,15),0.06,1000,2,basis)
    const acc = (basis: number) => new AccruedInterestNode().data({
      issue: [d("2023-07-15")], settle: [d("2024-01-15")], rate: [0.06], par: [1000], frequency: [2], basis: [basis],
    }).result!;
    expect(acc(0)).toBeCloseTo(30, 9);
    expect(acc(1)).toBeCloseTo(30, 9);
    expect(acc(2)).toBeCloseTo(30.66666667, 7);
  });
  it("VDB matches Excel, fractional periods included", () => {
    expect(vdb(10000, 1000, 5, 0, 2, 2)!).toBeCloseTo(6400, 9);
    expect(vdb(10000, 1000, 5, 2, 5, 2)!).toBeCloseTo(2600, 9);
    expect(vdb(10000, 1000, 5, 0.5, 2.5, 2)!).toBeCloseTo(5120, 9);
  });
  it("MDURATION matches real Excel — Microsoft's published 5.7355689 is a doc typo", () => {
    // =MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,1) = 5.735669814 in real Excel.
    expect(new DurationNode({ op: "mduration" }).data({
      settle: [d("2008-01-01")], maturity: [d("2016-01-01")], coupon: [0.08], yld: [0.09], frequency: [2], basis: [1],
    }).result!).toBeCloseTo(5.735669814, 7);
  });
  it("the COUP* family matches Excel when settlement lands ON a coupon date", () => {
    // Settle 15-Jan-2024, maturity 15-Jan-2029, semiannual, basis 0 (all six confirmed).
    const coup = (op: "coupdaybs" | "coupdays" | "coupdaysnc" | "coupnum" | "couppcd" | "coupncd") =>
      new CouponNode({ op }).data({ settle: [settle], maturity: [maturity], frequency: [2], basis: [0] }).result!;
    expect(coup("coupdaybs")).toBe(0);
    expect(coup("coupdays")).toBeCloseTo(180, 9);
    expect(coup("coupdaysnc")).toBeCloseTo(180, 9);
    expect(coup("coupnum")).toBe(10);
    expect(coup("couppcd")).toBe(settle);
    expect(coup("coupncd")).toBe(d("2024-07-15"));
  });
});

describe("PRICE ↔ YIELD are inverses", () => {
  it("YIELD recovers the yield that PRICE was given", () => {
    const price = new BondPriceNode({ op: "price" })
      .data({ settle: [settle], maturity: [maturity], rate: [0.06], yld: [0.065], redemption: [100], frequency: [2] }).result!;
    const yld = new BondPriceNode({ op: "yield" })
      .data({ settle: [settle], maturity: [maturity], rate: [0.06], pr: [price], redemption: [100], frequency: [2] }).result!;
    expect(yld).toBeCloseTo(0.065, 6);
  });
});

describe("PRICEMAT ↔ YIELDMAT are inverses", () => {
  const issue = d("2023-07-15");
  it("PRICEMAT matches real Excel (absolute value, not just the round-trip)", () => {
    // =PRICEMAT(DATE(2024,1,15), DATE(2029,1,15), DATE(2023,7,15), 0.06, 0.065) = 97.37735849.
    expect(new DiscountSecurityNode({ op: "pricemat" })
      .data({ settle: [settle], maturity: [maturity], issue: [issue], rate: [0.06], yld: [0.065], basis: [0] }).result!)
      .toBeCloseTo(97.37735849, 6);
  });
  it("YIELDMAT recovers the yield that PRICEMAT was given", () => {
    const price = new DiscountSecurityNode({ op: "pricemat" })
      .data({ settle: [settle], maturity: [maturity], issue: [issue], rate: [0.06], yld: [0.065], basis: [0] }).result!;
    const yld = new DiscountSecurityNode({ op: "yieldmat" })
      .data({ settle: [settle], maturity: [maturity], issue: [issue], rate: [0.06], pr: [price], basis: [0] }).result!;
    expect(yld).toBeCloseTo(0.065, 6);
  });
});

describe("ODDFPRICE ↔ ODDFYIELD and ODDLPRICE ↔ ODDLYIELD are inverses", () => {
  it("odd-FIRST price/yield round-trip", () => {
    const args = { settle: [d("2024-01-25")], maturity: [d("2031-01-01")], issue: [d("2023-11-11")], firstlast: [d("2024-07-01")], rate: [0.0575], redemption: [100], frequency: [2] };
    const price = new OddCouponNode({ op: "oddfprice" }).data({ ...args, yld: [0.06] }).result!;
    const yld = new OddCouponNode({ op: "oddfyield" }).data({ ...args, pr: [price] }).result!;
    expect(yld).toBeCloseTo(0.06, 5);
  });
  it("odd-LAST price/yield round-trip", () => {
    const args = { settle: [d("2024-02-07")], maturity: [d("2024-06-15")], firstlast: [d("2023-10-15")], rate: [0.0375], redemption: [100], frequency: [2] };
    const price = new OddCouponNode({ op: "oddlprice" }).data({ ...args, yld: [0.0405] }).result!;
    const yld = new OddCouponNode({ op: "oddlyield" }).data({ ...args, pr: [price] }).result!;
    expect(yld).toBeCloseTo(0.0405, 5);
  });
});

describe("COUP* day counts are internally consistent", () => {
  const coup = (op: "coupdaybs" | "coupdays" | "coupdaysnc" | "coupncd" | "couppcd" | "coupnum") =>
    new CouponNode({ op }).data({ settle: [settle], maturity: [maturity], frequency: [2], basis: [0] }).result!;
  it("the coupon period splits at settlement (DAYBS + DAYSNC = DAYS)", () => {
    expect(coup("coupdaybs") + coup("coupdaysnc")).toBeCloseTo(coup("coupdays"), 9);
  });
  it("the previous coupon is on/before settlement and the next is after it", () => {
    expect(coup("couppcd")).toBeLessThanOrEqual(settle);
    expect(coup("coupncd")).toBeGreaterThan(settle);
  });
  it("at least one coupon remains, and 30/360 COUPDAYS is 360/freq", () => {
    expect(coup("coupnum")).toBeGreaterThanOrEqual(1);
    expect(coup("coupdays")).toBeCloseTo(180, 9); // 360 / 2
  });
});

describe("DURATION / MDURATION relationship", () => {
  const dur = (op: "duration" | "mduration", basis = 0) =>
    new DurationNode({ op }).data({ settle: [settle], maturity: [maturity], coupon: [0.06], yld: [0.065], frequency: [2], basis: [basis] }).result!;
  it("modified duration = Macaulay / (1 + y/freq), and is strictly smaller", () => {
    const mac = dur("duration"), mod = dur("mduration");
    expect(mod).toBeCloseTo(mac / (1 + 0.065 / 2), 6);
    expect(mod).toBeLessThan(mac);
    expect(mac).toBeGreaterThan(0);
    expect(mac).toBeLessThan(5); // shorter than the 5-year maturity
  });
  it("matches Microsoft's documented DURATION example", () => {
    // =DURATION(DATE(2018,7,1), DATE(2048,1,1), 0.08, 0.09, 2, 1) = 10.9191453.
    const v = new DurationNode({ op: "duration" }).data({
      settle: [d("2018-07-01")], maturity: [d("2048-01-01")],
      coupon: [0.08], yld: [0.09], frequency: [2], basis: [1],
    }).result!;
    expect(v).toBeCloseTo(10.9191453, 7);
  });

  // The first-period fraction is Excel's DSC/E and must be day-counted per the BASIS;
  // it used to count actual days whatever the basis, so the DEFAULT basis 0 was wrong.
  // One remaining coupon makes the whole cash-flow stream a single payment, so Macaulay
  // duration collapses to DSC/E/freq exactly — an absolute pin that needs no oracle.
  describe("the basis input is applied to the first-period fraction", () => {
    const s = d("2023-02-15"), m = d("2023-07-01"); // mid-period settlement, one coupon left
    const durB = (basis: number) => new DurationNode({ op: "duration" })
      .data({ settle: [s], maturity: [m], coupon: [0.06], yld: [0.05], frequency: [2], basis: [basis] }).result!;
    const coupB = (op: "coupdaysnc" | "coupdays", basis: number) => new CouponNode({ op })
      .data({ settle: [s], maturity: [m], frequency: [2], basis: [basis] }).result!;
    for (const basis of [0, 1, 2, 3, 4]) {
      it(`basis ${basis}: duration = COUPDAYSNC / COUPDAYS / freq`, () => {
        expect(durB(basis)).toBeCloseTo(coupB("coupdaysnc", basis) / coupB("coupdays", basis) / 2, 12);
      });
    }
    it("30/360 (basis 0) and actual (basis 2) disagree, so the basis really reaches the math", () => {
      expect(durB(0)).not.toBeCloseTo(durB(2), 6);
    });
  });
});

describe("ACCRINTM = par·rate·A/D (Excel's documented closed form)", () => {
  const issue = d("2023-07-15"), mat = d("2024-01-15");
  it("30/360 accrues over A=180, D=360 → par·rate·½", () => {
    expect(accrintM(issue, mat, 0.06, 1000, 0)).toBeCloseTo(1000 * 0.06 * 180 / 360, 9);
  });
  it("actual/360 (basis 2) counts real days (184)", () => {
    expect(accrintM(issue, mat, 0.06, 1000, 2)).toBeCloseTo(1000 * 0.06 * 184 / 360, 9);
  });
  it("scales linearly with the accrual span", () => {
    const half = accrintM(issue, mat, 0.06, 1000, 0)!;
    const full = accrintM(issue, d("2024-07-15"), 0.06, 1000, 0)!; // a full 30/360 year
    expect(full).toBeCloseTo(2 * half, 9);
  });
});

describe("VDB depreciation is total-conserving and additive", () => {
  it("over the whole life it depreciates exactly cost − salvage", () => {
    expect(vdb(10000, 1000, 5, 0, 5, 2)).toBeCloseTo(9000, 6);
  });
  it("splitting the window sums to the whole (VDB[0,k] + VDB[k,n] = VDB[0,n])", () => {
    const whole = vdb(10000, 1000, 5, 0, 5, 2)!;
    const a = vdb(10000, 1000, 5, 0, 2, 2)!;
    const b = vdb(10000, 1000, 5, 2, 5, 2)!;
    expect(a + b).toBeCloseTo(whole, 6);
  });
});

describe("ONE Discount Security card: the op table drives the sockets", () => {
  it("a switch keeps the inputs both ops share (cables and literals stay), drops the rest, and orders the sockets per the new op", () => {
    const node = new DiscountSecurityNode({ op: "disc" });
    expect(Object.keys(node.inputs)).toEqual(["settle", "maturity", "pr", "redemption", "basis"]);
    const kept = node.inputs.pr;
    expect(node.keysDroppedBySwitch("received").sort()).toEqual(["pr", "redemption"]);
    node.setOp("received");
    expect(Object.keys(node.inputs)).toEqual(["settle", "maturity", "investment", "discount", "basis"]);
    node.setOp("yieldmat");
    expect(Object.keys(node.inputs)).toEqual(["settle", "maturity", "issue", "rate", "pr", "basis"]);
    expect(node.inputs.pr).not.toBe(kept); // it left and came back — a fresh socket
    expect(node.inputs.basis).toBeDefined();
  });
  it("every op reads only its own inputs: a blank on a socket the op does not show is not a blank answer", () => {
    const settle = d("2024-01-15"), maturity = d("2024-07-15");
    const n = new DiscountSecurityNode({ op: "pricedisc" });
    expect(typeof n.data({ settle: [settle], maturity: [maturity], pr: [null as unknown as number] }).result).toBe("number");
    expect(n.data({ settle: [settle], maturity: [maturity], discount: [null as unknown as number] }).result).toBeNull();
  });
});

describe("ONE Accrued Interest card: frequency is the periodic form's socket", () => {
  it("switching to At maturity drops frequency (and nothing else); switching back restores it in place", () => {
    const node = new AccruedInterestNode();
    expect(Object.keys(node.inputs)).toEqual(["issue", "settle", "rate", "par", "frequency", "basis"]);
    expect(node.keysDroppedBySwitch("maturity")).toEqual(["frequency"]);
    node.setOp("maturity");
    expect(Object.keys(node.inputs)).toEqual(["issue", "settle", "rate", "par", "basis"]);
    expect(node.keysDroppedBySwitch("periodic")).toEqual([]);
    node.setOp("periodic");
    expect(Object.keys(node.inputs)).toEqual(["issue", "settle", "rate", "par", "frequency", "basis"]);
  });
  it("At maturity is ACCRINTM: the kernel the formula uses", () => {
    const issue = d("2023-07-15"), settle = d("2024-01-15");
    const viaNode = new AccruedInterestNode({ op: "maturity" }).data({ issue: [issue], settle: [settle], rate: [0.06], par: [1000], basis: [0] }).result;
    expect(viaNode).toBeCloseTo(accrintM(issue, settle, 0.06, 1000, 0)!, 12);
  });
});
