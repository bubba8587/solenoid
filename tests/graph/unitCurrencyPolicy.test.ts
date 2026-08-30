import { describe, it, expect } from "vitest";
import * as UV from "../../src/graph/unitValue";
import { arithmeticCell, compareUnits, forAggregateUnits, type ArithmeticOp, type UnitCell } from "../../src/graph/unitValue";
import { isSolError } from "../../src/graph/errorValue";

// ─── The currency policy sweep (matrixUnitPolicy's shape, applied to currency) ──
// FX is out of scope, so every currency collapses onto ONE `currency` axis at
// scale 1 — $5 and 5€ store the same base magnitude. That makes the display CODE
// the real unit identity, and every combinator must refuse two different explicit
// codes ("no exchange rate") rather than silently combining magnitudes. The
// checks lived in some combinators and not others — the live arithmetic path
// answered $5 + 5€ = $10 and minted $10 ÷ 5€ into a 2:1 "ratio" (a fabricated FX
// rate) while the currency-aware copy sat DEAD — so this sweep quantifies the
// policy over EVERY op and every combinator, with a completeness check that a
// new one must join.

const money = (value: number, code: string): UnitCell =>
  ({ __unitCell: true, value, dim: { currency: 1 }, display: code });
const usd5 = money(5, "usd");
const eur5 = money(5, "eur");
const err = (v: unknown) => isSolError(v) && v.code === "#UNIT!";

describe("every arithmetic op refuses mismatched currencies", () => {
  // The policy per op — every ArithmeticOp MUST appear (the completeness check
  // below). All seven refuse: +/−/mod can't combine, ×/÷/quotient would fabricate
  // an exchange rate (÷ mints a RATIO — a unitless $/€ number IS an FX claim),
  // and pow's currency exponent is doubly wrong.
  const POLICY: Record<ArithmeticOp, "refuse"> = {
    add: "refuse", sub: "refuse", mul: "refuse", div: "refuse",
    mod: "refuse", quotient: "refuse", pow: "refuse",
  };

  it.each(Object.keys(POLICY) as ArithmeticOp[])("%s($5, 5€) → #UNIT!", (op) => {
    expect(err(arithmeticCell(op, usd5, eur5)), `${op} combined mismatched currencies`).toBe(true);
  });

  it("the policy table covers every ArithmeticOp (completeness)", () => {
    // arithmeticCell's switch is exhaustive over the union; this pins that a NEW
    // op added to the union must also declare its currency policy here.
    const ops: ArithmeticOp[] = ["add", "sub", "mul", "div", "mod", "pow", "quotient"];
    for (const op of ops) expect(POLICY[op], `no currency policy declared for ${op}`).toBeDefined();
    expect(Object.keys(POLICY).sort()).toEqual([...ops].sort());
  });

  it("same-code currency still computes (the guard is the CODE, not the dimension)", () => {
    const sum = arithmeticCell("add", usd5, money(2, "usd")) as UnitCell;
    expect(sum.value).toBe(7);
    expect(sum.display).toBe("usd");
    // $10 ÷ $5 = a genuine 2:1 ratio — same currency cancels honestly.
    const ratio = arithmeticCell("div", money(10, "usd"), usd5) as UnitCell;
    expect(ratio.ratio).toBe(true);
    expect(ratio.value).toBe(2);
  });

  it("an UNCODED currency cell adopts leniently (a computed result has no code)", () => {
    const bare: UnitCell = { __unitCell: true, value: 5, dim: { currency: 1 } };
    const sum = arithmeticCell("add", usd5, bare) as UnitCell;
    expect(sum.value).toBe(10);
    expect(sum.display).toBe("usd");
  });
});

describe("the non-arithmetic combinators carry the same policy", () => {
  it("compareUnits: $5 vs 5€ → #UNIT!", () => {
    expect(err(compareUnits(usd5, eur5))).toBe(true);
  });
  it("forAggregateUnits: mixed codes → #UNIT!", () => {
    const r = forAggregateUnits([usd5, eur5]);
    expect(r.error?.code).toBe("#UNIT!");
  });
});

describe("completeness — a new combinator must join this sweep", () => {
  it("the swept set IS unitValue's combinator surface", () => {
    // Every exported function that COMBINES two-or-more dimensioned operands is
    // listed here with its sweep above. A new `*Units` export (or arithmetic
    // entry point) fails this until it registers — the matrixUnitPolicy pattern.
    const SWEPT = ["arithmeticCell", "compareUnits", "forAggregateUnits"];
    const combinators = Object.keys(UV).filter(
      (k) => /Units$/.test(k) || k === "arithmeticCell",
    ).filter((k) => typeof (UV as Record<string, unknown>)[k] === "function");
    expect(combinators.sort()).toEqual([...SWEPT].sort());
  });
});

describe("the formula surface — codes ride the dim pass (the Expression gap, closed)", () => {
  // The numeric evaluator computes on stripped magnitudes and can't see codes,
  // so `$5 + 5€` answered 10 in an Expression while arithmeticCell refused.
  // The codes now ride the DIMENSIONAL pass (unitDimExpr CodeEnv): operators
  // refuse a mismatch with the same #UNIT!, and a coded result carries its
  // code's dim. CALLS drop codes — the recorded limitation (SUM over two coded
  // inputs still combines in a formula; the node-side aggregators refuse).
  const mkUsd = (v: number): UnitCell => money(v, "usd");
  const mkEur = (v: number): UnitCell => money(v, "eur");

  it("operators refuse mismatched codes in an Expression", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    for (const expr of ["a + b", "a - b", "a * b", "a / b", "a > b"]) {
      const n = new ExpressionNode({ expr });
      const r = n.data({ a: [mkUsd(5)], b: [mkEur(5)] }).result;
      expect(isSolError(r), `${expr} combined mismatched currencies`).toBe(true);
      expect((r as { code: string }).code).toBe("#UNIT!");
    }
  });

  it("same-code and dimensionless-adopt still compute", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const sum = new ExpressionNode({ expr: "a + b" });
    expect((sum.data({ a: [mkUsd(5)], b: [mkUsd(2)] }).result as UnitCell).value).toBe(7);
    const scale = new ExpressionNode({ expr: "a * 2" });
    const scaled = scale.data({ a: [mkUsd(5)] }).result as UnitCell;
    expect(scaled.value).toBe(10);
    expect(scaled.dim).toEqual({ currency: 1 });
  });

  it("dimEval refuses codes directly (the pure pass)", async () => {
    const { dimEval } = await import("../../src/graph/unitDimExpr");
    const { parseFormula } = await import("../../src/graph/excelFormula");
    const env = { a: { currency: 1 }, b: { currency: 1 } };
    const mismatch = dimEval(parseFormula("a + b")!, env, { a: "usd", b: "eur" });
    expect(isSolError(mismatch) && mismatch.code === "#UNIT!").toBe(true);
    // Same code passes; an uncoded computed currency adopts leniently.
    expect(dimEval(parseFormula("a + b")!, env, { a: "usd", b: "usd" })).toEqual({ currency: 1 });
    expect(dimEval(parseFormula("a + b")!, env, { a: "usd" })).toEqual({ currency: 1 });
  });
});

describe("the Equation surface — `=` is itself a combination", () => {
  it("$5 = €5 refuses; $5 = $5 holds", async () => {
    // No operator inside either side ever sees both codes, so the equals
    // compares the sides' RESULT codes (dimEvalWithCode).
    const { EquationNode } = await import("../../src/graph/nodes/equation");
    const n = new EquationNode({ expr: "p = c" });
    n.data({ p: [money(5, "usd")], c: [money(5, "eur")] });
    expect((n.cachedHolds as { code?: string })?.code).toBe("#UNIT!");
    const m = new EquationNode({ expr: "p = c" });
    m.data({ p: [money(5, "usd")], c: [money(5, "usd")] });
    expect(m.cachedHolds).toBe(true);
  });
});
