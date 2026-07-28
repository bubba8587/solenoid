import { describe, it, expect } from "vitest";
import * as UV from "./unitValue";
import { arithmeticCell, compareUnits, forAggregateUnits, type ArithmeticOp, type UnitCell } from "./unitValue";
import { isSolError } from "./errorValue";

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
