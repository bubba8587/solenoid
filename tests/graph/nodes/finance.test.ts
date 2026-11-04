// [[C17]], [[equation-solver#Which cards are relations]]
import { solDate } from "../../../src/graph/dateValue";
import { dated } from "../datedInputs";
import { describe, it, expect } from "vitest";
import {
  TvmNode,
  PaymentBreakdownNode,
  DiscountSecurityNode,
  NPVNode,
  IRRNode,
  DepreciationNode,
  FvScheduleNode,
} from "../../../src/graph/nodes/finance";
import { coreFunction } from "../coreFunction";

const securityDisc = (op: string, s: number, m: number, ...a: number[]) => coreFunction(op)!(solDate(s), solDate(m), ...a) as number;
const priceMat = (op: string, s: number, m: number, i: number, ...a: number[]) => coreFunction(op)!(solDate(s), solDate(m), solDate(i), ...a);
import { parseDateToSerial } from "../../../src/graph/nodes/date";
import { compileEvaluator } from "../../../src/graph/excelFormula";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);

// Reference values are what Excel's matching function returns. Excel cash-flow
// sign convention: money received is positive, money paid out is negative, so a
// loan's PMT/IPMT/PPMT are all negative when PV is positive.

describe("TVM (equation)", () => {





  it("solves PMT at zero rate exactly (straight-line limit relation)", () => {
    const r = new TvmNode().data({ rate: [0], nper: [10], pv: [1000], fv: [0] });
    expect(r.pmt).toBeCloseTo(-100, 9);
    expect(r.rate).toBe(0); // the fixed rate still flows out its own socket
  });




  it("timing switch swaps the locked relation without changing sockets", () => {
    const node = new TvmNode();
    const before = [...node.varNames];
    node.setPaymentTiming("beg");
    expect(node.varNames).toEqual(before);
    expect(node.expr).toContain("pmt*(1+rate)*");
  });
});

describe("Payment Breakdown (IPMT / PPMT / CUMIPMT / CUMPRINC)", () => {
  // =IPMT(0.05, 1, 12, 1000) = -50.00, =PPMT(0.05, 1, 12, 1000) = -62.83





  // The Range span (CUMIPMT / CUMPRINC) reads rate/nper/pv/start/end.

  // =CUMIPMT(0.05,12,1000,1,12) = -353.90, =CUMPRINC(0.05,12,1000,1,12) = -1000 (Excel).



  it("CUMIPMT / CUMPRINC outside Excel's domain are #DOMAIN!, as the formula answers", async () => {
    const { compileEvaluator } = await import("../../../src/graph/excelFormula");
    const bad = [
      { rate: 0, nper: 10, pv: 1000, start: 1, end: 2 },
      { rate: 0.01, nper: 10, pv: -1000, start: 1, end: 2 },
      { rate: 0.01, nper: 0, pv: 1000, start: 1, end: 2 },
      { rate: 0.01, nper: 10, pv: 1000, start: 0, end: 2 },
      { rate: 0.01, nper: 10, pv: 1000, start: 3, end: 2 },
    ];
    for (const op of ["cumipmt", "cumprinc"] as const) {
      for (const a of bad) {
        const node = new PaymentBreakdownNode({ op }).data({ rate: [a.rate], nper: [a.nper], pv: [a.pv], start: [a.start], end: [a.end] }).result;
        const formula = compileEvaluator(`${op.toUpperCase()}(${a.rate},${a.nper},${a.pv},${a.start},${a.end},0)`)!({});
        expect((node as { code?: string } | null)?.code, `${op} ${JSON.stringify(a)}`).toBe("#DOMAIN!");
        expect((formula as { code?: string }).code).toBe("#DOMAIN!");
      }
    }
  });

});


describe("TBILL — money-market day-count conventions", () => {
  const d = (s: string) => parseDateToSerial(s);
  it("TBILLEQ switches to the compounding form past 182 days (real Excel = 0.052539935)", () => {
    // =TBILLEQ(DATE(2024,1,15), DATE(2024,12,15), 0.05); DSM = 335 > 182.
    expect(new DiscountSecurityNode({ op: "tbilleq" }).data(dated({ settle: [d("2024-01-15")], maturity: [d("2024-12-15")], discount: [0.05] })).result)
      .toBeCloseTo(0.052539935, 9);
  });
});

describe("TBILL and PRICEMAT answer #DOMAIN! where Excel answers #NUM! ([[C24]] arraySemantics)", () => {
  const d = (s: string) => parseDateToSerial(s);
  const domain = (r: unknown) => expect(r).toMatchObject({ code: "#DOMAIN!" });
  it("a T-bill maturing more than one year after settlement is an error", () => {
    const tb = new DiscountSecurityNode({ op: "tbillprice" });
    expect(tb.data(dated({ settle: [d("2024-01-15")], maturity: [d("2025-02-20")], discount: [0.05] })).result)
      .toMatchObject({ code: "#DOMAIN!", message: "TBILLPRICE needs the maturity date within one year of settlement" });
    domain(ev("TBILLPRICE(s, m, 0.05)", { s: solDate(d("2024-01-15")), m: solDate(d("2025-02-20")) }));
    expect(tb.data(dated({ settle: [d("2024-01-15")], maturity: [d("2025-01-15")], discount: [0.05] })).result).toBeCloseTo(100 * (1 - 0.05 * 366 / 360), 9);
  });
  it("a zero or negative discount or price is an error", () => {
    const s = d("2024-01-15"), m = d("2024-07-15");
    domain(new DiscountSecurityNode({ op: "tbillprice" }).data(dated({ settle: [s], maturity: [m], discount: [0] })).result);
    domain(new DiscountSecurityNode({ op: "tbilleq" }).data(dated({ settle: [s], maturity: [m], discount: [-0.05] })).result);
    expect(new DiscountSecurityNode({ op: "tbillyield" }).data(dated({ settle: [s], maturity: [m], pr: [0] })).result)
      .toMatchObject({ code: "#DOMAIN!", message: "TBILLYIELD needs a price above 0" });
    domain(ev("TBILLYIELD(s, m, -1)", { s: solDate(s), m: solDate(m) }));
  });
  it("a missing date stays a quiet blank", () => {
    expect(new DiscountSecurityNode({ op: "tbillprice" }).data(dated({ maturity: [d("2024-07-15")], discount: [0.05] })).result).toBeNull();
  });
  it("PRICEMAT and YIELDMAT refuse a settlement on or after maturity", () => {
    const issue = d("2023-01-01"), s = d("2025-01-01"), m = d("2024-06-01");
    expect(priceMat("pricemat", s, m, issue, 0.05, 0.06))
      .toMatchObject({ code: "#DOMAIN!", message: "PRICEMAT needs the settlement date before the maturity date" });
    domain(priceMat("yieldmat", s, m, issue, 0.05, 99));
    domain(priceMat("pricemat", m, m, issue, 0.05, 0.06));
    domain(ev("PRICEMAT(s, m, i, 0.05, 0.06)", { s: solDate(s), m: solDate(m), i: solDate(issue) }));
  });
});

describe("securityDisc — DSM honors the day-count basis", () => {
  const d = (s: string) => parseDateToSerial(s);
  it("=DISC(2024-01-01, 2024-07-01, 97, 100, 0) = 0.06 (30/360, not actual days)", () => {
    // Actual days over this half-year are 182, so ignoring basis 0 gave 0.05934.
    expect(securityDisc("disc", d("2024-01-01"), d("2024-07-01"), 97, 100, 0)).toBeCloseTo(0.06, 10);
  });
  it("defaults to basis 0 when omitted", () => {
    expect(securityDisc("disc", d("2024-01-01"), d("2024-07-01"), 97, 100)).toBeCloseTo(0.06, 10);
  });
  it("basis 2 (actual/360) still counts real days", () => {
    // 182 actual days: ((100-97)/100)*(360/182).
    expect(securityDisc("disc", d("2024-01-01"), d("2024-07-01"), 97, 100, 2)).toBeCloseTo(0.03 * 360 / 182, 10);
  });
});


describe("FVSCHEDULE", () => {
  it("compounds the whole schedule, on the card and in a formula (Excel: 1.33089)", () => {
    const schedule = [0.09, 0.11, 0.1];
    expect(new FvScheduleNode().data({ pv: [1], schedule: [schedule] }).result).toBeCloseTo(1.33089, 10);
    expect(compileEvaluator("FVSCHEDULE(1, s)")!({ s: schedule })).toBeCloseTo(1.33089, 10);
  });
  it("an overflow is #OVERFLOW! on both, never a quiet blank", () => {
    const schedule = [1e200, 1e200];
    const code = (v: unknown) => (v as { code?: string }).code;
    expect(code(new FvScheduleNode().data({ pv: [1], schedule: [schedule] }).result)).toBe("#OVERFLOW!");
    expect(code(compileEvaluator("FVSCHEDULE(1, s)")!({ s: schedule }))).toBe("#OVERFLOW!");
  });
});



describe("Depreciation", () => {



  it("DB honours the first-year Month, matching =DB (Microsoft's worked example)", () => {
    const db = (per: number, month?: number) => new DepreciationNode({ op: "db" })
      .data({ cost: [1000000], salvage: [100000], life: [6], per: [per], ...(month != null ? { month: [month] } : {}) }).result;
    // =DB(1000000,100000,6,period,7) — a 7-month first year. Before the Month input the
    // node was locked to month=12; now it matches the formula surface for month≠12.
    expect(db(1, 7)).toBeCloseTo(186083.33, 2);
    expect(db(2, 7)).toBeCloseTo(259639.42, 2);
    expect(db(1, 7)).toBe(ev("DB(c,s,l,p,m)", { c: 1000000, s: 100000, l: 6, p: 1, m: 7 }));
    expect(db(2, 7)).toBe(ev("DB(c,s,l,p,m)", { c: 1000000, s: 100000, l: 6, p: 2, m: 7 }));
    // Month defaults to 12 when unwired — same as the formula's omitted 5th arg.
    expect(db(1)).toBe(ev("DB(c,s,l,p)", { c: 1000000, s: 100000, l: 6, p: 1 }));
  });
});

describe("Depreciation answers its formula's domain errors ([[C24]] arraySemantics)", () => {
  it("a period past the life is the formula's error, and a missing input stays blank", async () => {
    const { compileEvaluator } = await import("../../../src/graph/excelFormula");
    for (const op of ["syd", "ddb", "db"] as const) {
      const card = new DepreciationNode({ op }).data({ cost: [10000], salvage: [1000], life: [5], per: [7] }).result;
      const fx = compileEvaluator(`${op.toUpperCase()}(10000, 1000, 5, 7)`)!({});
      expect((card as { code?: string }).code).toBeDefined();
      expect(card).toEqual(fx);
    }
    expect(new DepreciationNode({ op: "syd" }).data({ cost: [10000], salvage: [1000], life: [5], per: [null as unknown as number] }).result).toBeNull();
  });
});

describe("Depreciation — VDB absorbed as an op", () => {

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

describe("NPV / IRR — the Dated toggle (old XNPV / XIRR)", () => {

  it("dated NPV answers Excel's XNPV example and refuses a date before the first", () => {
    const xnpv = (dates: number[]) => new NPVNode({ op: "dates" }).data(dated({
      rate: [0.09], list: [[-10000, 2750, 4250, 3250, 2750]], dates: [dates],
    })).result;
    expect(xnpv([39448, 39508, 39751, 39859, 39904]) as number).toBeCloseTo(2086.65, 2);
    expect((xnpv([39448, 39508, 39400, 39859, 39904]) as { code?: string }).code).toBe("#DOMAIN!");
    const ev = compileEvaluator("XNPV(0.09, a, b)")!;
    expect(ev({ a: [-10000, 2750, 4250, 3250, 2750], b: [39448, 39508, 39751, 39859, 39904].map(solDate) }) as number).toBeCloseTo(2086.65, 2);
    expect((ev({ a: [-10000, 2750], b: [39448, 39400].map(solDate) }) as { code?: string }).code).toBe("#DOMAIN!");
  });


  it("the toggle adds/removes only the Dates socket", () => {
    const n = new NPVNode();
    expect(Object.keys(n.inputs)).toEqual(["rate", "list"]);
    n.setOp("dates");
    expect(Object.keys(n.inputs)).toEqual(["rate", "list", "dates"]);
    n.setOp("periods");
    expect(Object.keys(n.inputs)).toEqual(["rate", "list"]);
    const i = new IRRNode({ op: "dates" });
    expect(Object.keys(i.inputs)).toEqual(["list", "dates"]);
  });
});
