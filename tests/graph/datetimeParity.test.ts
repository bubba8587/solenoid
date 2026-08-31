import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";

// Datetime formula-surface regressions found by an invariant sweep (calendar facts, not
// golden numbers from memory). Dates are built with DATE(); the surface returns serials.
const ev = (e: string) => compileEvaluator(e)!({}) as number;

describe("WORKDAY.INTL returns a serial, not a raw Date", () => {
  it("matches plain WORKDAY (both land on the same working day)", () => {
    const intl = ev("WORKDAY.INTL(DATE(2024,1,1), 5, 1)"); // weekend code 1 = Sat/Sun (the default)
    const plain = ev("WORKDAY(DATE(2024,1,1), 5)");
    expect(typeof intl).toBe("number");
    expect(intl).toBe(plain);            // 2024-01-01 (Mon) + 5 workdays = 2024-01-08
    expect(intl - ev("DATE(2024,1,8)")).toBe(0); // and serial arithmetic works
  });
});

describe("NETWORKDAYS is the negation of the forward count on a reversed span", () => {
  const fwd = "NETWORKDAYS(DATE(2024,1,1), DATE(2024,1,5))";
  it("Fri→Mon reversed is −5, not FX's −3", () => {
    expect(ev(fwd)).toBe(5);
    expect(ev("NETWORKDAYS(DATE(2024,1,5), DATE(2024,1,1))")).toBe(-5);
    expect(ev("NETWORKDAYS(DATE(2024,1,4), DATE(2024,1,2))")).toBe(-3); // Thu→Tue
    expect(ev("NETWORKDAYS.INTL(DATE(2024,1,5), DATE(2024,1,1), 1)")).toBe(-5);
  });
  it("the reversal identity holds for any span", () => {
    expect(ev("NETWORKDAYS(DATE(2024,3,15), DATE(2024,2,1))"))
      .toBe(-ev("NETWORKDAYS(DATE(2024,2,1), DATE(2024,3,15))"));
    expect(ev("NETWORKDAYS(DATE(2024,1,3), DATE(2024,1,3))")).toBe(1); // same weekday = 1
  });
});
