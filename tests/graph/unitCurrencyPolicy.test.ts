// [[C25]] firstClassUnits, [[unit-flow#Currency: the display code is the identity]]
import { describe, it, expect } from "vitest";
import { type ArithmeticOp, type UnitCell } from "../../src/graph/unitValue";
import { arithmeticCell } from "./coreVerbs";
import { isSolError } from "../../src/graph/errorValue";



const money = (value: number, code: string): UnitCell =>
  ({ __unitCell: true, value, dim: { currency: 1 }, display: code });
const usd5 = money(5, "usd");
const eur5 = money(5, "eur");
const err = (v: unknown) => isSolError(v) && v.code === "#UNIT!";

describe("every arithmetic op refuses mismatched currencies", () => {
  // Every ArithmeticOp appears (the completeness check below).
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

