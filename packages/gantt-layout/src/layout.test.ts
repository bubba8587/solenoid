import { describe, it, expect } from "vitest";
import { serialFromCivil } from "./serial";
import { buildScale } from "./scale";
import { layoutGantt } from "./layout";
import type { GanttPayload, GanttTask, GanttViewOptions } from "./payload";

const S = (y: number, m: number, d: number) => serialFromCivil(y, m, d);

function task(p: Partial<GanttTask> & { id: string; start: number; finish: number }): GanttTask {
  return {
    name: p.id,
    level: 0,
    summary: false,
    milestone: false,
    complete: 0,
    critical: false,
    late: false,
    violated: false,
    float: 0,
    ...p,
  };
}

function payload(tasks: GanttTask[], view: GanttViewOptions = {}, extra: Partial<GanttPayload> = {}): GanttPayload {
  const starts = tasks.map((t) => t.start);
  const finishes = tasks.map((t) => t.finish);
  return {
    kind: "gantt",
    tasks,
    links: [],
    nonWorking: [],
    weekend: [0, 6],
    holidays: [],
    today: null,
    statusDate: null,
    projectStart: Math.min(...starts),
    projectFinish: Math.max(...finishes),
    view,
    ...extra,
  };
}

describe("scale: month columns proportional to day count", () => {
  it("a 31-day month cell is wider than a 28-day month cell by exactly 31:28", () => {
    const p = payload([task({ id: "a", start: S(2026, 1, 5), finish: S(2026, 3, 20) })], {
      zoom: "month",
      tiers: 1,
      window: [S(2026, 1, 1), S(2026, 3, 31)],
    });
    const scale = buildScale(p, 800);
    const cells = scale.tiers[scale.tiers.length - 1].cells;
    expect(cells.map((c) => c.label)).toEqual(["Jan", "Feb", "Mar"]);
    const [jan, feb, mar] = cells;
    expect(jan.w / feb.w).toBeCloseTo(31 / 28, 5);
    expect(mar.w).toBeCloseTo(jan.w, 5);
    // Cells tile with no gap or overlap.
    expect(feb.x).toBeCloseTo(jan.x + jan.w, 5);
    expect(mar.x).toBeCloseTo(feb.x + feb.w, 5);
  });
});

describe("scale: DST is not a thing (every day column is equal width)", () => {
  it("day cells across a US spring-forward date are all pxPerDay wide", () => {
    const p = payload([task({ id: "a", start: S(2026, 3, 6), finish: S(2026, 3, 10) })], {
      zoom: "day",
      tiers: 1,
      window: [S(2026, 3, 6), S(2026, 3, 12)], // spans 2026-03-08, the US DST switch
    });
    const scale = buildScale(p, 600);
    const cells = scale.tiers[0].cells;
    for (const c of cells) expect(c.w).toBeCloseTo(scale.pxPerDay, 6);
  });
});

describe("layout: hidden weekend ranges shade the body", () => {
  it("emits one shading rect per non-working span at the right width", () => {
    const sat = S(2026, 9, 12); // a Saturday
    const p = payload(
      [task({ id: "a", start: S(2026, 9, 7), finish: S(2026, 9, 18) })],
      { window: [S(2026, 9, 7), S(2026, 9, 18)] },
      { nonWorking: [[sat, sat + 1]] }, // Sat–Sun inclusive
    );
    const frame = layoutGantt(p, { width: 600 });
    expect(frame.shading.length).toBe(1);
    // Two inclusive days → two day-widths of shading.
    expect(frame.shading[0].w).toBeCloseTo(2 * frame.scale.pxPerDay, 5);
    expect(frame.shading[0].kind).toBe("weekend");
  });

  it("weekends:false hides all shading", () => {
    const sat = S(2026, 9, 12);
    const p = payload(
      [task({ id: "a", start: S(2026, 9, 7), finish: S(2026, 9, 18) })],
      { weekends: false },
      { nonWorking: [[sat, sat + 1]] },
    );
    const frame = layoutGantt(p, { width: 600 });
    expect(frame.shading.length).toBe(0);
  });

  it("a holiday span shades as a holiday, not a weekend", () => {
    const hol = S(2026, 12, 25);
    const p = payload(
      [task({ id: "a", start: S(2026, 12, 20), finish: S(2026, 12, 31) })],
      { window: [S(2026, 12, 20), S(2026, 12, 31)] },
      { nonWorking: [[hol, hol]], holidays: [hol] },
    );
    const frame = layoutGantt(p, { width: 600 });
    expect(frame.shading[0].kind).toBe("holiday");
  });
});

describe("bars: one-day tasks and milestones on non-working days", () => {
  it("a one-day (start == finish) task draws a full-day-wide bar", () => {
    const d = S(2026, 9, 9);
    const p = payload([task({ id: "a", start: d, finish: d })], {
      zoom: "day",
      window: [S(2026, 9, 7), S(2026, 9, 14)],
    });
    const frame = layoutGantt(p, { width: 700 });
    const bar = frame.bars.find((b) => b.rowId === "a")!;
    expect(bar.kind).toBe("task");
    expect(bar.w).toBeCloseTo(frame.scale.pxPerDay, 3);
  });

  it("a milestone on a weekend still draws a diamond over the shaded day", () => {
    const sat = S(2026, 9, 12); // Saturday
    const p = payload(
      [task({ id: "m", start: sat, finish: sat, milestone: true })],
      { zoom: "day", window: [S(2026, 9, 7), S(2026, 9, 14)] },
      { nonWorking: [[sat, sat]], holidays: [] },
    );
    const frame = layoutGantt(p, { width: 700 });
    const bar = frame.bars.find((b) => b.rowId === "m")!;
    expect(bar.kind).toBe("milestone");
    expect(bar.w).toBeGreaterThan(0);
    expect(bar.h).toBeGreaterThan(0);
    // The diamond is centered on the milestone's day.
    const dayCenterX = (sat + 0.5 - frame.scale.from) * frame.scale.pxPerDay;
    expect(bar.x + bar.w / 2).toBeCloseTo(dayCenterX, 3);
    // And that day is shaded.
    expect(frame.shading.length).toBe(1);
  });

  it("inclusive finish: a 5-day task spans five day-widths", () => {
    const p = payload([task({ id: "a", start: S(2026, 9, 7), finish: S(2026, 9, 11) })], {
      zoom: "day",
      window: [S(2026, 9, 6), S(2026, 9, 14)],
    });
    const frame = layoutGantt(p, { width: 800 });
    const bar = frame.bars.find((b) => b.rowId === "a")!;
    expect(bar.w).toBeCloseTo(5 * frame.scale.pxPerDay, 3);
  });
});

describe("layout: links route with the endpoint conventions", () => {
  it("an FS link leaves the predecessor's right and enters the successor's left", () => {
    const a = task({ id: "a", start: S(2026, 9, 7), finish: S(2026, 9, 9) });
    const b = task({ id: "b", start: S(2026, 9, 10), finish: S(2026, 9, 12) });
    const p = payload([a, b], { zoom: "day", window: [S(2026, 9, 6), S(2026, 9, 14)] });
    p.links = [{ from: "a", to: "b", type: "FS", lag: 0, critical: false, violated: false }];
    const frame = layoutGantt(p, { width: 800 });
    expect(frame.links.length).toBe(1);
    const link = frame.links[0];
    const aEnd = (a.finish + 1 - frame.scale.from) * frame.scale.pxPerDay; // predecessor right
    const bStart = (b.start - frame.scale.from) * frame.scale.pxPerDay; // successor left
    expect(link.points[0].x).toBeCloseTo(aEnd, 3);
    expect(link.arrow.x).toBeCloseTo(bStart, 3);
    expect(link.arrow.dir).toBe("right"); // points into the left edge
  });
});
