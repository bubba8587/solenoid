// [[D101]] financeCarriesMoney: the finance functions carry the currency their money arguments share.
import { describe, it, expect } from "vitest";
import { parseFormula } from "../../src/graph/excelFormula";
import { dimEvalWithCode } from "../../src/graph/unitDimExpr";
import { fromUnit, isUnitCell, type UnitCell } from "../../src/graph/unitValue";
import { fcUnitToUnit } from "../../src/graph/unitBridge";
import { columnUnitFromSpec } from "../../src/graph/unitColumn";
import { isSolError } from "../../src/graph/errorValue";
import type { FrameColumn, FrameValue } from "../../src/graph/frame";
import { ExpressionNode } from "../../src/graph/nodes/expression";
import { ComputedColumnNode } from "../../src/graph/nodes/frame";
import {
  NPVNode, IRRNode, DepreciationNode, AmortizationNode, IspmtNode, PaymentBreakdownNode, TvmNode,
} from "../../src/graph/nodes/finance";

const usd = (n: number) => fromUnit(n, fcUnitToUnit("usd")!, "usd") as UnitCell;
const eur = (n: number) => fromUnit(n, fcUnitToUnit("eur")!, "eur") as UnitCell;
const km = (n: number) => fromUnit(n, fcUnitToUnit("km")!, "km") as UnitCell;
const CUR = { currency: 1 };
const code = (v: unknown) => (isSolError(v) ? v.code : v);

const dimOf = (src: string, env: Record<string, Record<string, number>>, codes: Record<string, string> = {}) =>
  dimEvalWithCode(parseFormula(src)!, env, codes);

describe("the formula's dimension pass", () => {
  it("money in is money out, in the money's currency", () => {
    expect(dimOf("PMT(r, n, p)", { p: CUR }, { p: "usd" })).toEqual({ dim: CUR, code: "usd" });
    expect(dimOf("NPV(r, xs)", { xs: CUR }, { xs: "eur" })).toEqual({ dim: CUR, code: "eur" });
    expect(dimOf("SLN(c, s, 5)", { c: CUR, s: CUR }, { c: "usd", s: "usd" })).toEqual({ dim: CUR, code: "usd" });
  });
  it("a rate or a count of periods from money is a plain number", () => {
    expect(dimOf("IRR(xs)", { xs: CUR }, { xs: "usd" })).toEqual({ dim: {} });
    expect(dimOf("NPER(r, pm, p)", { pm: CUR, p: CUR }, { pm: "usd", p: "usd" })).toEqual({ dim: {} });
  });
  it("a plain number where money goes reads in the money's currency", () => {
    expect(dimOf("PMT(r, n, p, 0)", { p: CUR }, { p: "usd" })).toEqual({ dim: CUR, code: "usd" });
  });
  it("two currencies, money that isn't a currency, or a unit on a rate or period count is #UNIT!", () => {
    expect(code(dimOf("PMT(r, n, p, f)", { p: CUR, f: CUR }, { p: "usd", f: "eur" }))).toBe("#UNIT!");
    expect(code(dimOf("PMT(r, n, p)", { p: { length: 1 } }))).toBe("#UNIT!");
    expect(code(dimOf("PMT(r, n, p)", { n: { time: 1 }, p: CUR }, { p: "usd" }))).toBe("#UNIT!");
  });
  it("all plain numbers stay plain", () => {
    expect(dimOf("PMT(r, n, p)", {})).toEqual({ dim: {} });
  });
});

describe("Expression and a computed column", () => {
  it("PMT over a dollar loan answers dollars", () => {
    const n = new ExpressionNode({ expr: "PMT(r, n, p)" } as never) as unknown as { data: (i: unknown) => { result: unknown } };
    const r = n.data({ r: [0.005], n: [360], p: [usd(200000)] }).result as UnitCell;
    expect(r.dim).toEqual(CUR);
    expect(r.display).toBe("usd");
    expect(r.value).toBeCloseTo(-1199.101050, 5);
  });
  it("a loan table's payment column is in the principal's currency", () => {
    const col = (name: string, values: number[], spec?: string): FrameColumn =>
      ({ name, type: "number", values, ...(spec ? { unit: columnUnitFromSpec(spec)! } : {}) });
    const f: FrameValue = { __frame: true, columns: [col("rate", [0.005, 0.004]), col("n", [360, 180]), col("principal", [200000, 50000], "usd")] };
    const node = new ComputedColumnNode({ expr: "PMT(@rate, @n, -@principal)" });
    node.stringLiterals.name = "payment";
    const out = (node.data({ frame: [f] } as never) as { frame: FrameValue }).frame;
    const pay = out.columns.find((c) => c.name === "payment")!;
    expect(pay.unit).toEqual(columnUnitFromSpec("usd"));
    expect(pay.values[0] as number).toBeCloseTo(1199.101050, 5);
  });
});

describe("the cards answer as their formulas do", () => {
  it("NPV of dollar flows is dollars; IRR of them is a plain rate", () => {
    const flows = [usd(-100), usd(60), usd(60)];
    const npv = new NPVNode().data({ rate: [0.1], list: [flows] }).result as UnitCell;
    expect(npv.display).toBe("usd");
    expect(npv.value).toBeCloseTo(-100 / 1.1 + 60 / 1.21 + 60 / 1.331, 9);
    const irr = new IRRNode().data({ list: [flows] }).result;
    expect(typeof irr).toBe("number");
  });
  it("depreciation of a dollar cost is dollars", () => {
    const r = new DepreciationNode({ op: "sln" }).data({ cost: [usd(1000)], salvage: [usd(100)], life: [9] }).result as UnitCell;
    expect(r).toEqual({ __unitCell: true, value: 100, dim: CUR, display: "usd" });
  });
  it("an amortization schedule of a dollar loan has dollar money columns", () => {
    const f = new AmortizationNode().data({ rate: [0.005], nper: [12], pv: [usd(10000)], fv: [0] }).frame as FrameValue;
    expect(f.columns.map((c) => c.unit?.display ?? null)).toEqual([null, "usd", "usd", "usd", "usd"]);
  });
  it("two currencies, money that isn't a currency, or a unit on a rate is #UNIT!", () => {
    expect(code(new PaymentBreakdownNode({ op: "ipmt" }).data({ pv: [usd(1000)], fv: [eur(5)] }).result)).toBe("#UNIT!");
    expect(code(new IspmtNode().data({ pv: [km(1000)] }).result)).toBe("#UNIT!");
    expect(code(new NPVNode().data({ rate: [km(1)], list: [[usd(1)]] }).result)).toBe("#UNIT!");
  });
  it("plain numbers stay plain", () => {
    expect(new DepreciationNode({ op: "sln" }).data({ cost: [1000], salvage: [100], life: [9] }).result).toBe(100);
  });
  it("the TVM card keeps the currency's code on what it solves", () => {
    const out = new TvmNode().data({ rate: [0.005], nper: [360], pv: [usd(200000)], fv: [0] });
    const pmt = out.pmt as UnitCell;
    expect(isUnitCell(pmt) && pmt.display).toBe("usd");
  });
});
