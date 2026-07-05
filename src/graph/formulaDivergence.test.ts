import { describe, it, expect } from "vitest";
import * as FX from "@formulajs/formulajs";
import { resolveExcelFunction } from "./excelFunctions";
import { isSolError } from "./errorValue";

// ─── Formula-engine divergence re-sweep (periodic, author-flagged 2026-06-25) ────
// The 2026-06-25 consolidation compared every formula-reachable function (our impl
// vs Formula.js) and OVERRODE the handful where FX is wrong, so `resolveExcelFunction`
// returns the Excel-correct answer AND the visual node calls the SAME impl. Those
// overrides are load-bearing and easy to regress on an FX upgrade or a refactor, so
// this pins them. It doubles as the "re-run the sweep" guard the backlog asks for:
//   • the "Excel-correct" blocks assert OUR result matches Excel (robust — always valid);
//   • the "FX still diverges" tripwires assert FX STILL returns its wrong answer, so an
//     FX upgrade that changes/fixes one trips this test → re-evaluate the override
//     (a judgment call to surface, not a silent regression).
// Recovered from the audit notes (dev-notes "Divergence audit"), since the original
// `_sweep` script was never committed — only referenced.

const call = (name: string, ...args: unknown[]): unknown => {
  const fn = resolveExcelFunction(name);
  expect(fn, `resolveExcelFunction("${name}") should exist`).not.toBeNull();
  return fn!(...args);
};
const num = (v: unknown): number => {
  expect(typeof v === "number", `expected a number, got ${JSON.stringify(v)}`).toBe(true);
  return v as number;
};

describe("MOD — Excel result takes the DIVISOR's sign (FX is wrong)", () => {
  it("our impl matches Excel across sign combinations", () => {
    expect(num(call("MOD", 10, -3))).toBeCloseTo(-2, 9); // divisor negative → negative
    expect(num(call("MOD", -3, 5))).toBeCloseTo(2, 9);
    expect(num(call("MOD", 3, -5))).toBeCloseTo(-2, 9);
    expect(num(call("MOD", 10, 3))).toBeCloseTo(1, 9);
    expect(isSolError(call("MOD", 5, 0))).toBe(true); // ÷0 → #DIV/0!, not FX's null
  });
  it("FX still has the sign bug (tripwire — re-evaluate the override if this fails)", () => {
    expect((FX as { MOD: (a: number, b: number) => unknown }).MOD(10, -3)).not.toBe(-2);
  });
});

describe("QUOTIENT — integer division, truncated toward zero; ÷0 is #DIV/0!", () => {
  it("matches Excel", () => {
    expect(num(call("QUOTIENT", 7, 2))).toBe(3);
    expect(num(call("QUOTIENT", -7, 2))).toBe(-3); // trunc toward zero, not floor
    expect(isSolError(call("QUOTIENT", 5, 0))).toBe(true);
  });
});

describe("ATAN2 — Excel arg order is (x, y) = atan2(y, x); FX swaps them", () => {
  it("our impl uses x-first", () => {
    expect(num(call("ATAN2", 1, 0))).toBeCloseTo(0, 9);          // point (1,0) → 0 rad
    expect(num(call("ATAN2", 0, 1))).toBeCloseTo(Math.PI / 2, 9); // point (0,1) → π/2
    expect(num(call("ATAN2", 1, 1))).toBeCloseTo(Math.PI / 4, 9);
    expect(num(call("ATAN2", -1, 0))).toBeCloseTo(Math.PI, 9);
  });
  it("FX still swaps the args (tripwire)", () => {
    // FX.ATAN2(1,0) computes atan2(1,0)=π/2 instead of Excel's 0.
    expect((FX as { ATAN2: (a: number, b: number) => unknown }).ATAN2(1, 0)).not.toBeCloseTo(0, 6);
  });
});

describe("ROUND — half-AWAY-from-zero (Excel), not JS half-to-even/up", () => {
  it("rounds .5 away from zero on both signs", () => {
    expect(num(call("ROUND", 2.5, 0))).toBe(3);
    expect(num(call("ROUND", -2.5, 0))).toBe(-3); // the distinguishing case (Math.round → -2)
    expect(num(call("ROUND", 0.125, 2))).toBeCloseTo(0.13, 9);
    expect(num(call("ROUND", -0.125, 2))).toBeCloseTo(-0.13, 9);
  });
});

describe("RANK — a value not in the list is #N/A (Excel); FX wrongly returns 0", () => {
  it("descending rank, ties share the lowest; absent value → #N/A", () => {
    expect(num(call("RANK", 3, [1, 2, 3]))).toBe(1); // largest = rank 1
    expect(num(call("RANK", 2, [1, 2, 3]))).toBe(2);
    expect(isSolError(call("RANK", 5, [1, 2, 3]))).toBe(true); // not present
    // RANK.AVG averages a tie's rank band.
    expect(num(call("RANK.AVG", 10, [10, 10, 20]))).toBeCloseTo(2.5, 9);
  });
});

describe("TRIMMEAN — Excel rounds the trimmed count DOWN to a multiple of 2; FX over-trims", () => {
  it("trims floor(n·pct/2) from each end", () => {
    expect(num(call("TRIMMEAN", [1, 2, 3, 4, 5], 0.4))).toBeCloseTo(3, 9);   // trim 1 each end → mean[2,3,4]
    expect(num(call("TRIMMEAN", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.2))).toBeCloseTo(5.5, 9); // trim 1 → mean[2..9]
    expect(isSolError(call("TRIMMEAN", [1, 2], 1))).toBe(true); // trims everything → #DOMAIN!
  });
});

describe("PERCENTRANK — linear interpolation + TRUNCATE to sig digits (Excel); out-of-range #N/A", () => {
  it("interpolates and truncates", () => {
    expect(num(call("PERCENTRANK", [1, 2, 3, 4], 2))).toBeCloseTo(0.333, 9); // pos 1/(4-1)=0.333…
    expect(num(call("PERCENTRANK", [1, 2, 3, 4], 1))).toBeCloseTo(0, 9);
    expect(num(call("PERCENTRANK", [1, 2, 3, 4], 4))).toBeCloseTo(1, 9);
    expect(isSolError(call("PERCENTRANK", [1, 2, 3, 4], 5))).toBe(true); // outside the range
  });
});

describe("Pass-through stats family holds the Excel value (catches FX drift on upgrade)", () => {
  // These have NO internal override — resolveExcelFunction returns FX directly — so
  // pinning HARDCODED Excel references (not comparing FX to itself) is what actually
  // guards them: a future FX upgrade that shifts one of these to a wrong value trips
  // the sweep. The audit found this whole family already AGREES with Excel today.
  it("MEDIAN / GEOMEAN / HARMEAN / AVEDEV / DEVSQ / SUMSQ match Excel", () => {
    expect(num(call("MEDIAN", [1, 2, 3, 4]))).toBeCloseTo(2.5, 9);
    expect(num(call("MEDIAN", [3, 1, 4, 1, 5, 9, 2, 6]))).toBeCloseTo(3.5, 9);
    expect(num(call("GEOMEAN", [1, 4]))).toBeCloseTo(2, 9);       // √(1·4)
    expect(num(call("HARMEAN", [1, 4]))).toBeCloseTo(1.6, 9);     // 2 / (1 + 1/4)
    expect(num(call("AVEDEV", [1, 2, 3]))).toBeCloseTo(2 / 3, 9); // mean |x−2|
    expect(num(call("DEVSQ", [1, 2, 3]))).toBeCloseTo(2, 9);      // Σ(x−2)²
    expect(num(call("SUMSQ", [1, 2, 3]))).toBeCloseTo(14, 9);     // 1+4+9
  });
});
