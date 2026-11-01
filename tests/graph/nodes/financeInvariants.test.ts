// [[B11]]
import { describe, it, expect } from "vitest";
import {
  BondPricingNode, DiscountSecurityNode, DurationNode, CouponNode, AccruedInterestNode,
  PaymentBreakdownNode,
} from "../../../src/graph/nodes/finance";
import { coreFunction } from "../coreFunction";
import { parseDateToSerial } from "../../../src/graph/nodes/date";

// Formula.js implements almost none of the bond/coupon family, so these functions have
// no external oracle. These tests pin INVARIANTS that must hold whatever the exact value
// is — inverse round-trips, day-count identities, depreciation totals — plus the
// real-Excel GOLDEN values the author verified by hand (2026-08-31).

const d = (s: string) => parseDateToSerial(s);
const accrintM = (...a: number[]) => coreFunction("ACCRINTM")!(...a) as number;
const settle = d("2024-01-15"), maturity = d("2029-01-15");

describe("real-Excel golden values (author-verified 2026-08-31)", () => {
  const vdb = (cost: number, salvage: number, life: number, start: number, end: number, factor: number) =>
    coreFunction("VDB")!(cost, salvage, life, start, end, factor) as number;
  it("VDB matches Excel, fractional periods included", () => {
    expect(vdb(10000, 1000, 5, 0, 2, 2)!).toBeCloseTo(6400, 9);
    expect(vdb(10000, 1000, 5, 2, 5, 2)!).toBeCloseTo(2600, 9);
    expect(vdb(10000, 1000, 5, 0.5, 2.5, 2)!).toBeCloseTo(5120, 9);
  });
});




describe("DURATION / MDURATION relationship", () => {
  const dur = (op: "duration" | "mduration", basis = 0) =>
    new DurationNode({ op }).data({ settle: [settle], maturity: [maturity], coupon: [0.06], yld: [0.065], frequency: [2], basis: [basis] }).result as number;
  it("modified duration = Macaulay / (1 + y/freq), and is strictly smaller", () => {
    const mac = dur("duration"), mod = dur("mduration");
    expect(mod).toBeCloseTo(mac / (1 + 0.065 / 2), 6);
    expect(mac).toBeGreaterThan(0);
    expect(mac).toBeLessThan(5); // shorter than the 5-year maturity
  });

  // The first-period fraction is Excel's DSC/E and must be day-counted per the BASIS;
  // it used to count actual days whatever the basis, so the DEFAULT basis 0 was wrong.
  // One remaining coupon makes the whole cash-flow stream a single payment, so Macaulay
  // duration collapses to DSC/E/freq exactly — an absolute pin that needs no oracle.
  describe("the basis input is applied to the first-period fraction", () => {
    const s = d("2023-02-15"), m = d("2023-07-01"); // mid-period settlement, one coupon left
    const durB = (basis: number) => new DurationNode({ op: "duration" })
      .data({ settle: [s], maturity: [m], coupon: [0.06], yld: [0.05], frequency: [2], basis: [basis] }).result as number;
    const coupB = (op: "coupdaysnc" | "coupdays", basis: number) => new CouponNode({ op })
      .data({ settle: [s], maturity: [m], frequency: [2], basis: [basis] }).result as number;
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
    const half = accrintM(issue, mat, 0.06, 1000, 0) as number;
    const full = accrintM(issue, d("2024-07-15"), 0.06, 1000, 0) as number; // a full 30/360 year
    expect(full).toBeCloseTo(2 * half, 9);
  });
});

describe("VDB depreciation is total-conserving and additive", () => {
  it("over the whole life it depreciates exactly cost − salvage", () => {
    expect(coreFunction("VDB")!(10000, 1000, 5, 0, 5, 2)).toBeCloseTo(9000, 6);
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
});

describe("ONE Payment Breakdown card: Span drives the socket reshape", () => {
  it("One period ↔ Range keeps the shared rate/nper/pv (cables and literals), swaps per/fv for start/end", () => {
    const node = new PaymentBreakdownNode({ op: "ipmt" });
    expect(Object.keys(node.inputs)).toEqual(["rate", "per", "nper", "pv", "fv"]);
    const keptRate = node.inputs.rate, keptNper = node.inputs.nper, keptPv = node.inputs.pv;
    // Share flip stays within the pair — no socket change.
    expect(node.keysDroppedBySwitch("ppmt")).toEqual([]);
    // Span flip to the Range pair drops per/fv, adds start/end.
    expect(node.keysDroppedBySwitch("cumipmt").sort()).toEqual(["fv", "per"]);
    node.setOp("cumipmt");
    expect(Object.keys(node.inputs)).toEqual(["rate", "nper", "pv", "start", "end"]);
    expect(node.inputs.rate).toBe(keptRate); // shared sockets are the SAME objects (cables ride along)
    expect(node.inputs.nper).toBe(keptNper);
    expect(node.inputs.pv).toBe(keptPv);
    node.setOp("ipmt");
    expect(Object.keys(node.inputs)).toEqual(["rate", "per", "nper", "pv", "fv"]);
  });
});

describe("ONE Bond Pricing card: the odd-coupon dates are their own sockets", () => {
  it("PRICE shows yield not price; the odd-first ops add issue + first coupon; the odd-last ops swap in last interest", () => {
    const node = new BondPricingNode();
    expect(Object.keys(node.inputs)).toEqual(["settle", "maturity", "rate", "yld", "redemption", "frequency"]);
    node.setOp("oddfyield");
    expect(Object.keys(node.inputs)).toEqual(["settle", "maturity", "issue", "firstcoupon", "rate", "pr", "redemption", "frequency"]);
    expect(node.keysDroppedBySwitch("oddlyield").sort()).toEqual(["firstcoupon", "issue"]);
    node.setOp("oddlyield");
    expect(Object.keys(node.inputs)).toEqual(["settle", "maturity", "lastinterest", "rate", "pr", "redemption", "frequency"]);
  });
});

