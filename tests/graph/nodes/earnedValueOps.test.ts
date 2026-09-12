import { describe, it, expect } from "vitest";
import { plannedFraction, earnedValue, type EvTaskInput } from "../../../src/graph/nodes/earnedValueOps";
import { parseDateToSerial } from "../../../src/graph/nodes/dateSerial";

const d = (iso: string) => parseDateToSerial(iso);

// A plain Mon–Fri counter stands in for the node's injected Calendar.countBetween, so these
// pure-math tests stay engine-free; a holiday-aware count is covered by the node test.
const monFri = (from: number, to: number): number => {
  const a = Math.floor(from), b = Math.floor(to);
  if (b < a) return 0;
  let n = 0;
  for (let s = a; s <= b; s++) { const jsDay = ((((s - 25569) % 7 + 7) % 7) + 4) % 7; if (jsDay !== 0 && jsDay !== 6) n++; }
  return n;
};

describe("earnedValueOps", () => {
  it("plannedFraction clamps to [0,1] over the baseline working span", () => {
    const s = d("2026-01-07"), f = d("2026-01-09"); // Wed–Fri, 3 working days
    expect(plannedFraction(s, f, d("2026-01-05"), monFri)).toBe(0);      // before start
    expect(plannedFraction(s, f, d("2026-01-12"), monFri)).toBe(1);      // after finish
    expect(plannedFraction(s, f, d("2026-01-08"), monFri)).toBeCloseTo(2 / 3, 6); // Wed+Thu of 3
    expect(plannedFraction(null, f, d("2026-01-08"), monFri)).toBe(0);   // no baseline dates
  });

  it("computes the metrics and sums the totals from components, not averages", () => {
    const status = d("2026-01-08");
    const tasks: EvTaskInput[] = [
      { name: "A", cost: 1000, complete: 100, plannedStart: d("2026-01-05"), plannedFinish: d("2026-01-06"), actualCost: null },
      { name: "B", cost: 2000, complete: 50, plannedStart: d("2026-01-07"), plannedFinish: d("2026-01-09"), actualCost: null },
    ];
    const { tasks: rows, totals } = earnedValue(tasks, status, monFri);

    expect(rows[0].bcws).toBe(1000);
    expect(rows[0].bcwp).toBe(1000);
    expect(rows[0].acwp).toBe(1000); // no actual → falls back to BCWP
    expect(rows[0].spi).toBe(1);
    expect(rows[0].tcpi).toBeNull(); // (BAC−BCWP)/(BAC−ACWP) = 0/0

    expect(rows[1].bcws).toBeCloseTo(2000 * (2 / 3), 6);
    expect(rows[1].bcwp).toBe(1000);
    expect(rows[1].spi).toBeCloseTo(0.75, 6);
    expect(rows[1].cpi).toBe(1);
    expect(rows[1].eac).toBe(2000);

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
      status, monFri,
    );
    expect(tasks[0].bcwp).toBe(500);
    expect(tasks[0].acwp).toBe(800);
    expect(tasks[0].cv).toBe(-300);
    expect(tasks[0].cpi).toBeCloseTo(500 / 800, 6);
    expect(tasks[0].eac).toBeCloseTo(1000 / (500 / 800), 6); // BAC / CPI
  });
});
