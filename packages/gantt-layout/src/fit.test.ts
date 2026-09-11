import { describe, it, expect } from "vitest";
import { serialFromCivil } from "./serial";
import { buildScale, resolveZoom } from "./scale";
import type { GanttPayload, GanttViewOptions } from "./payload";

const S = (y: number, m: number, d: number) => serialFromCivil(y, m, d);

function payload(view: GanttViewOptions): GanttPayload {
  return {
    kind: "gantt", tasks: [], links: [], nonWorking: [], weekend: [0, 6], holidays: [], today: null, statusDate: null,
    projectStart: view.window![0], projectFinish: view.window![1], view,
  };
}

/** Minimum primary-tier cell width for its label to read without colliding. */
const MIN_LABEL_PX = 22;

describe("fit zoom fills the width without tier-label collisions", () => {
  it("a 5-day plan fits at day granularity and fills the width", () => {
    const p = payload({ zoom: "fit", window: [S(2026, 9, 7), S(2026, 9, 11)] }); // 5 inclusive days
    const width = 800;
    expect(resolveZoom(p, width)).toBe("day");
    const scale = buildScale(p, width);
    const days = scale.to - scale.from;
    expect(scale.pxPerDay * days).toBeCloseTo(width, 3); // fills
    const primary = scale.tiers[scale.tiers.length - 1].cells;
    for (const c of primary) expect(c.w).toBeGreaterThanOrEqual(MIN_LABEL_PX);
  });

  it("a 12-month plan drops to a coarse tier so labels never collide", () => {
    const p = payload({ zoom: "fit", window: [S(2026, 1, 1), S(2026, 12, 31)] }); // 365 days
    const width = 800;
    const zoom = resolveZoom(p, width);
    expect(["month", "quarter", "year"]).toContain(zoom); // never day/week at this density
    const scale = buildScale(p, width);
    const days = scale.to - scale.from;
    expect(scale.pxPerDay * days).toBeCloseTo(width, 3); // still fills
    const primary = scale.tiers[scale.tiers.length - 1].cells;
    for (const c of primary) expect(c.w).toBeGreaterThanOrEqual(MIN_LABEL_PX);
    // A two-tier header: a coarser band sits above the primary.
    expect(scale.tiers.length).toBe(2);
  });

  it("a decade-long plan fits at year granularity", () => {
    const p = payload({ zoom: "fit", window: [S(2020, 1, 1), S(2029, 12, 31)] });
    const width = 900;
    expect(resolveZoom(p, width)).toBe("year");
    const scale = buildScale(p, width);
    const primary = scale.tiers[scale.tiers.length - 1].cells;
    for (const c of primary) expect(c.w).toBeGreaterThanOrEqual(MIN_LABEL_PX);
  });
});
