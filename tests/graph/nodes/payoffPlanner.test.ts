// [[C86]] membershipByGesture, [[C17]] shareImpl
import { describe, it, expect } from "vitest";
import { PayoffPlannerNode, type PayoffOrder, type PayoffView } from "../../../src/graph/nodeClasses";
import { extractInit } from "../../../src/graph/nodeInit";
import { parseDateToSerial, formatDateSerial } from "../../../src/graph/nodes/dateSerial";
import { isSolError } from "../../../src/graph/errorValue";
import { isFrameValue, type FrameValue } from "../../../src/graph/frame";

// Payoff Planner: minimums everywhere, the extra + freed minimums cascade onto the head debt (highest APR =
// avalanche, smallest balance = snowball), month by month.

type Debt = { name: string; balance: number; apr: number; min: number };
const debtFrame = (ds: Debt[], unit?: string): FrameValue => ({ __frame: true, columns: [
  { name: "Debt", type: "string", values: ds.map((d) => d.name) },
  { name: "Balance", type: "number", values: ds.map((d) => d.balance), ...(unit ? { unit: unit as never } : {}) },
  { name: "APR", type: "number", values: ds.map((d) => d.apr) },
  { name: "Min", type: "number", values: ds.map((d) => d.min) },
] });

function plan(debts: FrameValue, extra: number, order: PayoffOrder, mode: PayoffView, start: number | null): FrameValue {
  const n = new PayoffPlannerNode({ order, mode });
  const out = n.data({ debts: [debts], extra: [extra], ...(start === null ? {} : { start: [start] }) }).frame;
  if (!isFrameValue(out)) throw out;
  return out;
}
const col = (f: FrameValue, name: string) => f.columns.find((c) => c.name === name)!.values as number[];
const monthsOf = (f: FrameValue, name: string) => col(f, "Months")[(col(f, "Debt") as unknown as string[]).indexOf(name)];
const totalInterest = (f: FrameValue) => col(f, "Interest").reduce((t, x) => t + x, 0);

const debts = debtFrame([
  { name: "Card", balance: 1000, apr: 0.24, min: 100 },
  { name: "Car", balance: 2000, apr: 0.06, min: 100 },
], "usd");

describe("PayoffPlannerNode", () => {
  it("order + view persist through extractInit; stale values fall back", () => {
    const n = new PayoffPlannerNode({ order: "snowball", mode: "schedule" });
    const init = extractInit(n as never);
    expect(init.order).toBe("snowball");
    expect(init.mode).toBe("schedule");
    expect(new PayoffPlannerNode({ order: "x" as never, mode: "y" as never }).order).toBe("avalanche");
  });

  it("summary: one row per debt with months, interest (Balance's unit) and a payoff date off the start", () => {
    const f = plan(debts, 50, "avalanche", "summary", parseDateToSerial("2026-01-01"));
    expect(f.columns.map((c) => c.name)).toEqual(["Debt", "Months", "Interest", "Payoff date"]);
    expect(f.columns[2].unit).toBe("usd");
    const months = f.columns[1].values as number[];
    expect(months[0]).toBeLessThan(months[1]); // the card clears first under avalanche
    const expected = new Date(Date.UTC(2026, months[0], 1));
    expect(formatDateSerial(f.columns[3].values[0] as number, "YYYY-MM")).toBe(`${expected.getUTCFullYear()}-${String(expected.getUTCMonth() + 1).padStart(2, "0")}`);
  });

  it("a start on the 31st lands a payoff date on a short month's last day, as EDATE does", () => {
    const f = plan(debts, 50, "avalanche", "summary", parseDateToSerial("2026-01-31"));
    const months = f.columns[1].values as number[];
    const y = 2026 + Math.floor(months[0] / 12), mo = months[0] % 12;
    const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    expect(formatDateSerial(f.columns[3].values[0] as number, "YYYY-MM-DD")).toBe(`${y}-${String(mo + 1).padStart(2, "0")}-${String(Math.min(31, lastDay)).padStart(2, "0")}`);
  });

  it("schedule: Month plus a balance column per debt, month 0 the starting balances", () => {
    const f = plan(debts, 0, "snowball", "schedule", null);
    expect(f.columns.map((c) => c.name)).toEqual(["Month", "Card", "Car"]);
    expect(f.columns[1].values[0]).toBe(1000);
    expect(f.columns[2].values[0]).toBe(2000);
    expect(f.columns[0].values.length).toBeGreaterThan(10);
  });

  it("the node reads a wired extra (a wired blank = 0) and turns a runaway plan into #VALUE!", () => {
    const n = new PayoffPlannerNode();
    n.literals.extra = 500;
    expect(isFrameValue(n.data({ debts: [debts], extra: [null] }).frame)).toBe(true);
    const runaway = debtFrame([{ name: "Trap", balance: 10000, apr: 0.5, min: 10 }]);
    const out = new PayoffPlannerNode().data({ debts: [runaway] });
    expect(isSolError(out.frame) ? out.frame.message : "").toMatch(/Trap/);
  });
});

describe("the payoff plan", () => {
  const three = debtFrame([
    { name: "Card", balance: 3000, apr: 0.24, min: 90 },
    { name: "Car", balance: 8000, apr: 0.06, min: 250 },
    { name: "Store", balance: 500, apr: 0.18, min: 25 },
  ]);

  it("clears every debt, avalanche pays less interest than snowball, and the freed minimums cascade", () => {
    const a = plan(three, 200, "avalanche", "summary", null);
    const s = plan(three, 200, "snowball", "summary", null);
    expect(totalInterest(a)).toBeLessThan(totalInterest(s));
    expect(Math.max(...col(a, "Months"))).toBeLessThanOrEqual(Math.max(...col(s, "Months")));
    // Snowball clears the Store card first; avalanche the Card first.
    expect(monthsOf(s, "Store")).toBeLessThan(monthsOf(s, "Card"));
    expect(monthsOf(a, "Card")).toBeLessThan(monthsOf(a, "Car"));
    // Month 0 is the starting balances, and the last month clears them all.
    const sched = plan(three, 200, "avalanche", "schedule", null);
    const rows = sched.columns[0].values.length;
    expect(sched.columns.slice(1).map((c) => c.values[0])).toEqual([3000, 8000, 500]);
    expect(sched.columns.slice(1).every((c) => c.values[rows - 1] === 0)).toBe(true);
  });

  it("an APR of 1 or more reads as a percent", () => {
    const pct = plan(debtFrame([{ name: "A", balance: 1000, apr: 24, min: 100 }]), 0, "avalanche", "summary", null);
    const frac = plan(debtFrame([{ name: "A", balance: 1000, apr: 0.24, min: 100 }]), 0, "avalanche", "summary", null);
    expect(col(pct, "Interest")[0]).toBeCloseTo(col(frac, "Interest")[0], 9);
  });

  it("a single debt with no extra amortizes by its minimum; an already-clear debt is months 0", () => {
    const f = plan(debtFrame([{ name: "A", balance: 1000, apr: 0, min: 100 }, { name: "B", balance: 0, apr: 0.1, min: 50 }]), 0, "avalanche", "summary", null);
    expect(col(f, "Months")).toEqual([10, 0]);
    expect(totalInterest(f)).toBe(0);
  });

  it("avalanche compares rates as charged: 24% (a fraction) outranks 18 (a percent)", () => {
    const f = plan(debtFrame([{ name: "A", balance: 100, apr: 18, min: 10 }, { name: "B", balance: 100, apr: 0.24, min: 10 }]), 50, "avalanche", "summary", null);
    expect(monthsOf(f, "B")).toBeLessThan(monthsOf(f, "A"));
  });
});
