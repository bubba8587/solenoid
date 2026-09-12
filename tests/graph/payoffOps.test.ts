import { describe, it, expect } from "vitest";
import { payoffPlan, payoffOrder, monthlyRate, type Debt } from "../../src/graph/nodes/payoffOps";

// 1.4 H1 Payoff Planner: minimums everywhere, the extra + freed minimums cascade onto the
// head debt (highest APR = avalanche, smallest balance = snowball), month by month.

const debts: Debt[] = [
  { name: "Card", balance: 3000, apr: 0.24, min: 90 },
  { name: "Car", balance: 8000, apr: 0.06, min: 250 },
  { name: "Store", balance: 500, apr: 0.18, min: 25 },
];

describe("payoffPlan", () => {
  it("orders by APR (avalanche) or balance (snowball); an APR ≥ 1 reads as a percent", () => {
    expect(payoffOrder(debts, "avalanche").map((i) => debts[i].name)).toEqual(["Card", "Store", "Car"]);
    expect(payoffOrder(debts, "snowball").map((i) => debts[i].name)).toEqual(["Store", "Card", "Car"]);
    expect(monthlyRate(24)).toBeCloseTo(0.02, 12);
    expect(monthlyRate(0.24)).toBeCloseTo(0.02, 12);
  });

  it("clears every debt, avalanche pays less interest than snowball, and the freed minimums cascade", () => {
    const a = payoffPlan(debts, 200, "avalanche");
    const s = payoffPlan(debts, 200, "snowball");
    expect(a.schedule[a.months].every((b) => b === 0)).toBe(true);
    expect(s.schedule[s.months].every((b) => b === 0)).toBe(true);
    expect(a.totalInterest).toBeLessThan(s.totalInterest);
    expect(a.months).toBeLessThanOrEqual(s.months);
    // Snowball clears the Store card first; avalanche the Card first.
    const monthsOf = (p: typeof a, name: string) => p.perDebt.find((d) => d.name === name)!.months;
    expect(monthsOf(s, "Store")).toBeLessThan(monthsOf(s, "Card"));
    expect(monthsOf(a, "Card")).toBeLessThan(monthsOf(a, "Car"));
    // Month 0 is the starting balances; per-debt interest sums to the total.
    expect(a.schedule[0]).toEqual([3000, 8000, 500]);
    expect(a.perDebt.reduce((t, d) => t + d.interest, 0)).toBeCloseTo(a.totalInterest, 1);
  });

  it("a single debt with no extra amortizes by its minimum; an already-clear debt is months 0", () => {
    const p = payoffPlan([{ name: "A", balance: 1000, apr: 0, min: 100 }, { name: "B", balance: 0, apr: 0.1, min: 50 }], 0, "avalanche");
    expect(p.months).toBe(10);
    expect(p.perDebt[1].months).toBe(0);
    expect(p.totalInterest).toBe(0);
  });

  it("payments that never cover the interest throw, naming the debt", () => {
    expect(() => payoffPlan([{ name: "Runaway", balance: 10000, apr: 0.5, min: 10 }], 0, "avalanche")).toThrow(/Runaway/);
  });
});

describe("review pins: avalanche compares rates as charged", () => {
  it("18 (a percent) outranks 0.24 (a fraction)? no: 24% comes first", () => {
    const mixed: Debt[] = [{ name: "A", balance: 100, apr: 18, min: 10 }, { name: "B", balance: 100, apr: 0.24, min: 10 }];
    expect(payoffOrder(mixed, "avalanche")).toEqual([1, 0]);
  });
});
