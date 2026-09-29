// [[D70]] nullNotEnoughData, [[D86]] blankRoles, [[C17]] shareImpl
import { describe, it, expect } from "vitest";
import {
  CouponNode, AccruedInterestNode, DiscountSecurityNode, DurationNode, BondPricingNode, DepreciationNode,
} from "../../../src/graph/nodes/finance";
import { parseDateToSerial } from "../../../src/graph/nodes/date";
import { compileEvaluator } from "../../../src/graph/excelFormula";

// A wrong argument is Excel's #NUM!, here #DOMAIN! naming what is wrong; only a missing date is a blank.
// Each case runs the node and the formula and requires the same error from both.

const d = (s: string) => parseDateToSerial(s);
const ev = (expr: string, env: Record<string, unknown>) => compileEvaluator(expr)!(env);
const s = d("2024-01-15"), m = d("2029-01-15");

function same(node: unknown, formula: unknown, message: string) {
  expect(node).toMatchObject({ code: "#DOMAIN!", message });
  expect(formula).toMatchObject({ code: "#DOMAIN!", message });
}

describe("finance arguments out of Excel's range are #DOMAIN! on the node and in a formula", () => {
  it("COUP*: a frequency other than 1, 2 or 4, a basis past 4, settlement on or after maturity", () => {
    same(new CouponNode({ op: "coupdaybs" }).data({ settle: [s], maturity: [m], frequency: [3], basis: [0] }).result,
      ev("COUPDAYBS(s, m, 3, 0)", { s, m }), "COUPDAYBS needs a frequency of 1, 2 or 4");
    same(new CouponNode({ op: "coupnum" }).data({ settle: [s], maturity: [m], frequency: [2], basis: [5] }).result,
      ev("COUPNUM(s, m, 2, 5)", { s, m }), "COUPNUM needs a basis from 0 to 4");
    same(new CouponNode({ op: "coupncd" }).data({ settle: [m], maturity: [s], frequency: [2], basis: [0] }).result,
      ev("COUPNCD(m, s, 2, 0)", { s, m }), "COUPNCD needs the settlement date before the maturity date");
  });

  it("ACCRINT / ACCRINTM: issue on or after settlement, a rate or par of 0 or less", () => {
    same(new AccruedInterestNode({ op: "maturity" }).data({ issue: [m], settle: [s], rate: [0.05], par: [1000], basis: [0] }).result,
      ev("ACCRINTM(i, s, 0.05, 1000, 0)", { i: m, s }), "ACCRINTM needs the issue date before the settlement date");
    same(new AccruedInterestNode({ op: "maturity" }).data({ issue: [s], settle: [m], rate: [0], par: [1000], basis: [0] }).result,
      ev("ACCRINTM(i, s, 0, 1000, 0)", { i: s, s: m }), "ACCRINTM needs a rate and par above 0");
    expect(new AccruedInterestNode({ op: "periodic" }).data({ issue: [s], settle: [m], rate: [0.05], par: [1000], frequency: [3], basis: [0] }).result)
      .toMatchObject({ code: "#DOMAIN!", message: "ACCRINT needs a frequency of 1, 2 or 4" });
  });

  it("TBILL*: maturity past one year, a discount or price of 0 or less", () => {
    const tm = d("2024-07-15");
    same(new DiscountSecurityNode({ op: "tbilleq" }).data({ settle: [s], maturity: [m], discount: [0.05] }).result,
      ev("TBILLEQ(s, m, 0.05)", { s, m }), "TBILLEQ needs the maturity date within one year of settlement");
    same(new DiscountSecurityNode({ op: "tbillprice" }).data({ settle: [s], maturity: [tm], discount: [-0.01] }).result,
      ev("TBILLPRICE(s, m, -0.01)", { s, m: tm }), "TBILLPRICE needs a discount above 0");
  });

  it("INTRATE / RECEIVED / DISC: a non-positive amount, a discount of 100% or more over the term", () => {
    same(new DiscountSecurityNode({ op: "intrate" }).data({ settle: [s], maturity: [m], investment: [0], redemption: [1000], basis: [0] }).result,
      ev("INTRATE(s, m, 0, 1000, 0)", { s, m }), "INTRATE needs an investment and redemption above 0");
    same(new DiscountSecurityNode({ op: "received" }).data({ settle: [s], maturity: [m], investment: [1000], discount: [0.5], basis: [0] }).result,
      ev("RECEIVED(s, m, 1000, 0.5, 0)", { s, m }), "RECEIVED needs a discount below 100% over the term");
    expect(new DiscountSecurityNode({ op: "disc" }).data({ settle: [s], maturity: [m], pr: [97], redemption: [100], basis: [9] }).result)
      .toMatchObject({ code: "#DOMAIN!", message: "DISC needs a basis from 0 to 4" });
  });

  it("YIELDDISC / PRICEDISC: settlement on or after maturity, a non-positive price", () => {
    same(new DiscountSecurityNode({ op: "yielddisc" }).data({ settle: [m], maturity: [s], pr: [97], redemption: [100], basis: [0] }).result,
      ev("YIELDDISC(s, m, 97, 100, 0)", { s: m, m: s }), "YIELDDISC needs the settlement date before the maturity date");
    same(new DiscountSecurityNode({ op: "yielddisc" }).data({ settle: [s], maturity: [m], pr: [0], redemption: [100], basis: [0] }).result,
      ev("YIELDDISC(s, m, 0, 100, 0)", { s, m }), "YIELDDISC needs a price and redemption above 0");
    expect(new DiscountSecurityNode({ op: "pricedisc" }).data({ settle: [s], maturity: [m], discount: [0], redemption: [100], basis: [0] }).result)
      .toMatchObject({ code: "#DOMAIN!", message: "PRICEDISC needs a discount and redemption above 0" });
  });

  it("PRICEMAT / YIELDMAT: a negative rate, a price of 0 or less", () => {
    const i = d("2023-01-15");
    same(new DiscountSecurityNode({ op: "pricemat" }).data({ settle: [s], maturity: [m], issue: [i], rate: [-0.01], yld: [0.05], basis: [0] }).result,
      ev("PRICEMAT(s, m, i, -0.01, 0.05, 0)", { s, m, i }), "PRICEMAT needs a rate of 0 or more");
    same(new DiscountSecurityNode({ op: "yieldmat" }).data({ settle: [s], maturity: [m], issue: [i], rate: [0.05], pr: [0], basis: [0] }).result,
      ev("YIELDMAT(s, m, i, 0.05, 0, 0)", { s, m, i }), "YIELDMAT needs a price above 0");
  });

  it("DURATION / MDURATION: a bad frequency, a negative yield", () => {
    same(new DurationNode({ op: "duration" }).data({ settle: [s], maturity: [m], coupon: [0.08], yld: [0.09], frequency: [12], basis: [0] }).result,
      ev("DURATION(s, m, 0.08, 0.09, 12, 0)", { s, m }), "DURATION needs a frequency of 1, 2 or 4");
    same(new DurationNode({ op: "mduration" }).data({ settle: [s], maturity: [m], coupon: [0.08], yld: [-0.01], frequency: [2], basis: [0] }).result,
      ev("MDURATION(s, m, 0.08, -0.01, 2, 0)", { s, m }), "MDURATION needs a coupon and yield of 0 or more");
  });

  it("PRICE / YIELD: a bad frequency, a negative yield, a price or redemption of 0 or less", () => {
    same(new BondPricingNode({ op: "price" }).data({ settle: [s], maturity: [m], rate: [0.06], yld: [0.07], redemption: [100], frequency: [3] }).result,
      ev("PRICE(s, m, 0.06, 0.07, 100, 3)", { s, m }), "PRICE needs a frequency of 1, 2 or 4");
    same(new BondPricingNode({ op: "price" }).data({ settle: [s], maturity: [m], rate: [0.06], yld: [-0.07], redemption: [100], frequency: [2] }).result,
      ev("PRICE(s, m, 0.06, -0.07, 100, 2)", { s, m }), "PRICE needs a yield of 0 or more");
    same(new BondPricingNode({ op: "yield" }).data({ settle: [s], maturity: [m], rate: [0.06], pr: [98], redemption: [0], frequency: [2] }).result,
      ev("YIELD(s, m, 0.06, 98, 0, 2)", { s, m }), "YIELD needs a redemption above 0");
  });

  it("ODDF* / ODDL*: a bad frequency, dates out of order, a price of 0 or less", () => {
    const i = d("2023-11-11"), fc = d("2024-07-01");
    same(new BondPricingNode({ op: "oddfprice" }).data({ settle: [s], maturity: [m], issue: [i], firstcoupon: [fc], rate: [0.0575], yld: [0.06], redemption: [100], frequency: [3] }).result,
      ev("ODDFPRICE(s, m, i, f, 0.0575, 0.06, 100, 3)", { s, m, i, f: fc }), "ODDFPRICE needs a frequency of 1, 2 or 4");
    same(new BondPricingNode({ op: "oddfyield" }).data({ settle: [s], maturity: [m], issue: [fc], firstcoupon: [fc], rate: [0.0575], pr: [98], redemption: [100], frequency: [2] }).result,
      ev("ODDFYIELD(s, m, i, f, 0.0575, 98, 100, 2)", { s, m, i: fc, f: fc }),
      "ODDFYIELD needs maturity after the first coupon, the first coupon after settlement, and settlement on or after issue");
    const li = d("2023-10-15");
    same(new BondPricingNode({ op: "oddlyield" }).data({ settle: [s], maturity: [m], lastinterest: [li], rate: [0.0375], pr: [0], redemption: [100], frequency: [2] }).result,
      ev("ODDLYIELD(s, m, l, 0.0375, 0, 100, 2)", { s, m, l: li }), "ODDLYIELD needs a price above 0");
  });

  it("VDB: a life of 0, a period past the life", () => {
    same(new DepreciationNode({ op: "vdb" }).data({ cost: [10000], salvage: [1000], life: [0], start: [0], end: [1], factor: [2] }).result,
      ev("VDB(10000, 1000, 0, 0, 1)", {}), "VDB needs a cost and salvage of 0 or more, and a life and factor above 0");
    same(new DepreciationNode({ op: "vdb" }).data({ cost: [10000], salvage: [1000], life: [10], start: [0], end: [11], factor: [2] }).result,
      ev("VDB(10000, 1000, 10, 0, 11)", {}), "VDB needs 0 ≤ start ≤ end ≤ life");
  });
});

describe("a missing date stays a quiet blank on both surfaces", () => {
  it("an unwired settlement answers blank, not an error", () => {
    expect(new CouponNode({ op: "coupdays" }).data({ maturity: [m] }).result).toBeNull();
    expect(new BondPricingNode({ op: "price" }).data({ maturity: [m] }).result).toBeNull();
    expect(ev("PRICE(s, m, 0.06, 0.07, 100, 2)", { s: null, m })).toBeNull();
    expect(ev("DURATION(s, m, 0.08, 0.09, 2, 0)", { s: null, m })).toBeNull();
  });
});
