import { describe, it, expect } from "vitest";
import { networkDays, plannedFraction, earnedValue, type EvTaskInput } from "../../../src/graph/nodes/earnedValueOps";
import { parseDateToSerial } from "../../../src/graph/nodes/dateSerial";

const d = (iso: string) => parseDateToSerial(iso);

describe("earnedValueOps", () => {
  it("networkDays counts Mon–Fri inclusive and skips the weekend", () => {
    expect(networkDays(d("2026-01-05"), d("2026-01-05"))).toBe(1); // a Monday
    expect(networkDays(d("2026-01-05"), d("2026-01-09"))).toBe(5); // Mon–Fri
    expect(networkDays(d("2026-01-05"), d("2026-01-11"))).toBe(5); // + Sat, Sun add nothing
    expect(networkDays(d("2026-01-10"), d("2026-01-11"))).toBe(0); // a weekend
    expect(networkDays(d("2026-01-12"), d("2026-01-05"))).toBe(0); // to < from
  });

  it("plannedFraction clamps to [0,1] over the baseline working span", () => {
    const s = d("2026-01-07"), f = d("2026-01-09"); // Wed–Fri, 3 working days
    expect(plannedFraction(s, f, d("2026-01-05"))).toBe(0);      // before start
    expect(plannedFraction(s, f, d("2026-01-12"))).toBe(1);      // after finish
    expect(plannedFraction(s, f, d("2026-01-08"))).toBeCloseTo(2 / 3, 6); // Wed+Thu of 3
    expect(plannedFraction(null, f, d("2026-01-08"))).toBe(0);   // no baseline dates
  });

  it("computes the metrics and sums the totals from components, not averages", () => {
    const status = d("2026-01-08");
    const tasks: EvTaskInput[] = [
      { name: "A", cost: 1000, complete: 100, plannedStart: d("2026-01-05"), plannedFinish: d("2026-01-06"), actualCost: null },
      { name: "B", cost: 2000, complete: 50, plannedStart: d("2026-01-07"), plannedFinish: d("2026-01-09"), actualCost: null },
    ];
    const { tasks: rows, totals } = earnedValue(tasks, status);

    // A is finished before the status date: fully planned + earned, on budget.
    expect(rows[0].bcws).toBe(1000);
    expect(rows[0].bcwp).toBe(1000);
    expect(rows[0].acwp).toBe(1000); // no actual → falls back to BCWP
    expect(rows[0].spi).toBe(1);
    expect(rows[0].tcpi).toBeNull(); // (BAC−BCWP)/(BAC−ACWP) = 0/0

    // B is 2/3 planned but only half earned → behind schedule, on budget.
    expect(rows[1].bcws).toBeCloseTo(2000 * (2 / 3), 6);
    expect(rows[1].bcwp).toBe(1000);
    expect(rows[1].spi).toBeCloseTo(0.75, 6);
    expect(rows[1].cpi).toBe(1);
    expect(rows[1].eac).toBe(2000);

    // Totals: ratios from summed components.
    expect(totals.bcwp).toBe(2000);
    expect(totals.acwp).toBe(2000);
    expect(totals.bcws).toBeCloseTo(1000 + 2000 * (2 / 3), 6);
    expect(totals.spi).toBeCloseTo(2000 / (1000 + 2000 * (2 / 3)), 6);
    expect(totals.cpi).toBe(1);
    expect(totals.eac).toBe(3000); // ΣBAC / CPI(=1)
    expect(totals.vac).toBe(0);
  });

  it("an actual cost above the earned value shows a cost overrun (CPI < 1)", () => {
    const status = d("2026-01-08");
    const { tasks } = earnedValue(
      [{ name: "A", cost: 1000, complete: 50, plannedStart: d("2026-01-05"), plannedFinish: d("2026-01-09"), actualCost: 800 }],
      status,
    );
    expect(tasks[0].bcwp).toBe(500);
    expect(tasks[0].acwp).toBe(800);
    expect(tasks[0].cv).toBe(-300);
    expect(tasks[0].cpi).toBeCloseTo(500 / 800, 6);
    expect(tasks[0].eac).toBeCloseTo(1000 / (500 / 800), 6); // BAC / CPI
  });
});
