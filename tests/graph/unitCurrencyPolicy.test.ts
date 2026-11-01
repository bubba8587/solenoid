// [[C25]]
import { describe, it, expect } from "vitest";
import { type ArithmeticOp, type UnitCell } from "../../src/graph/unitValue";
import { arithmeticCell } from "./coreVerbs";
import { isSolError } from "../../src/graph/errorValue";

// ─── The currency policy sweep (matrixUnitPolicy's shape, applied to currency) ──
// FX is out of scope, so every currency collapses onto ONE `currency` axis at
// scale 1 — $5 and 5€ store the same base magnitude. That makes the display CODE
// the real unit identity, and every combinator must refuse two different explicit
// codes ("no exchange rate") rather than silently combining magnitudes. The
// checks lived in some combinators and not others — the live arithmetic path
// answered $5 + 5€ = $10 and minted $10 ÷ 5€ into a 2:1 "ratio" (a fabricated FX
// rate) while the currency-aware copy sat DEAD — so this sweep quantifies the
// policy over EVERY op and every combinator.

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


describe("the formula surface — codes ride the dim pass (the Expression gap, closed)", () => {
  // The numeric evaluator computes on stripped magnitudes and can't see codes,
  // so `$5 + 5€` answered 10 in an Expression while arithmeticCell refused.
  // The codes now ride the DIMENSIONAL pass (unitDimExpr CodeEnv): operators
  // refuse a mismatch with the same #UNIT!, and a coded result carries its
  // code's dim. CALLS drop codes — the recorded limitation (SUM over two coded
  // inputs still combines in a formula; the node-side aggregators refuse).



  it("the dimension pass refuses codes directly", async () => {
    const { dimOf } = await import("./coreDims");
    const env = { a: { currency: 1 }, b: { currency: 1 } };
    const mismatch = dimOf("a + b", env, { a: "usd", b: "eur" });
    expect(isSolError(mismatch) && mismatch.code === "#UNIT!").toBe(true);
    // Same code passes; an uncoded computed currency adopts leniently.
    expect(dimOf("a + b", env, { a: "usd", b: "usd" })).toEqual({ currency: 1 });
    expect(dimOf("a + b", env, { a: "usd" })).toEqual({ currency: 1 });
  });
});

