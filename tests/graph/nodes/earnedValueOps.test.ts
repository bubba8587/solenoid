// [[D54]]
import { describe, it, expect } from "vitest";
import { EarnedValueNode } from "../../../src/graph/nodeClasses";
import { parseDateToSerial } from "../../../src/graph/nodes/dateSerial";
import { cubeFromColumns, isFrameValue, type CubeCell, type FrameValue } from "../../../src/graph/frame";

const d = (iso: string) => parseDateToSerial(iso);

interface Task { name: string; cost: number; complete: number; start: number | null; finish: number | null; actual?: number | null }

/** The card's Summary rows and totals over tasks, on its Mon–Fri calendar. */
function earnedValue(tasks: Task[], status: number) {
  const cube = cubeFromColumns([
    { name: "Task", cells: tasks.map((t) => t.name), type: "string" },
    { name: "Cost", cells: tasks.map((t) => t.cost), type: "number" },
    { name: "Complete", cells: tasks.map((t) => t.complete), type: "number" },
    { name: "Start", cells: tasks.map((t) => t.start), type: "date" },
    { name: "Finish", cells: tasks.map((t) => t.finish), type: "date" },
    ...(tasks.some((t) => t.actual != null) ? [{ name: "Actual cost", cells: tasks.map((t) => t.actual ?? null) as CubeCell[], type: "number" as const }] : []),
  ]);
  const out = new EarnedValueNode().data({ schedule: [cube], status: [status] });
  if (!isFrameValue(out.frame)) throw new Error("expected a frame");
  const f = out.frame as FrameValue;
  const row = (i: number) => Object.fromEntries(f.columns.map((c) => [c.name.toLowerCase(), c.values[i]]));
  return { rows: tasks.map((_, i) => row(i)), totals: { spi: out.spi, cpi: out.cpi, eac: out.eac } };
}

describe("earned value", () => {
  it("the planned value counts working days of the planned span, both ends in", () => {
    const s = d("2026-01-07"), f = d("2026-01-09"); // Wed–Fri, 3 working days
    const bcws = (status: number, start: number | null = s) => earnedValue([{ name: "A", cost: 1, complete: 0, start, finish: f }], status).rows[0].bcws;
    expect(bcws(d("2026-01-05"))).toBe(0);      // before start
    expect(bcws(d("2026-01-12"))).toBe(1);      // after finish
    expect(bcws(d("2026-01-07"))).toBeCloseTo(1 / 3, 6); // the start day counts
    expect(bcws(d("2026-01-08"))).toBeCloseTo(2 / 3, 6); // Wed+Thu of 3
    expect(bcws(d("2026-01-08"), null)).toBe(0);   // no baseline dates
  });

  it("computes the metrics and sums the totals from components, not averages", () => {
    const { rows, totals } = earnedValue([
      { name: "A", cost: 1000, complete: 100, start: d("2026-01-05"), finish: d("2026-01-06") },
      { name: "B", cost: 2000, complete: 50, start: d("2026-01-07"), finish: d("2026-01-09") },
    ], d("2026-01-08"));
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
    expect(totals.spi).toBeCloseTo(2000 / (1000 + 2000 * (2 / 3)), 6);
    expect(totals.cpi).toBe(1);
    expect(totals.eac).toBe(3000); // ΣBAC / CPI(=1)
  });

  it("an actual cost above the earned value shows a cost overrun (CPI < 1)", () => {
    const { rows } = earnedValue([{ name: "A", cost: 1000, complete: 50, start: d("2026-01-05"), finish: d("2026-01-09"), actual: 800 }], d("2026-01-08"));
    expect(rows[0].bcwp).toBe(500);
    expect(rows[0].acwp).toBe(800);
    expect(rows[0].cv).toBe(-300);
    expect(rows[0].cpi).toBeCloseTo(500 / 800, 6);
    expect(rows[0].eac).toBeCloseTo(1000 / (500 / 800), 6); // BAC / CPI
  });
});
