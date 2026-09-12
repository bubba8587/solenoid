import { describe, it, expect } from "vitest";
import { serialFromCivil } from "./serial";
import { layoutGantt } from "./layout";
import { ganttSvg } from "./svg";
import type { GanttPayload, GanttTask, GanttViewOptions } from "./payload";

const S = (y: number, m: number, d: number) => serialFromCivil(y, m, d);
function task(p: Partial<GanttTask> & { id: string; start: number; finish: number }): GanttTask {
  return { name: p.id, level: 0, summary: false, milestone: false, complete: 0, critical: false, late: false, violated: false, float: 0, ...p };
}
function payload(tasks: GanttTask[], view: GanttViewOptions = {}): GanttPayload {
  return {
    kind: "gantt", tasks, links: [], nonWorking: [], weekend: [0, 6], holidays: [], today: null, statusDate: null,
    projectStart: Math.min(...tasks.map((t) => t.start)), projectFinish: Math.max(...tasks.map((t) => t.finish)), view,
  };
}

// Ana is double-booked Sep 8–9 (two tasks at once); Bob works Sep 7–8.
const tasks = [
  task({ id: "A", start: S(2026, 9, 7), finish: S(2026, 9, 9), resource: "Ana" }),
  task({ id: "B", start: S(2026, 9, 8), finish: S(2026, 9, 10), resource: "Ana" }),
  task({ id: "C", start: S(2026, 9, 7), finish: S(2026, 9, 8), resource: "Bob", units: 1 }),
];
const view: GanttViewOptions = { histogram: true, window: [S(2026, 9, 7), S(2026, 9, 10)] };

describe("resource histogram", () => {
  it("sums units per day per resource with a first-seen resource order", () => {
    const frame = layoutGantt(payload(tasks, view), { width: 700 });
    expect(frame.histogram).toBeDefined();
    expect(frame.histogram!.resources).toEqual(["Ana", "Bob"]);
    // Peak is Sep 8: Ana 2 + Bob 1 = 3.
    expect(frame.histogram!.maxUnits).toBe(3);
  });

  it("flags an over-allocated resource (> 1 unit on a day)", () => {
    const frame = layoutGantt(payload(tasks, view), { width: 700 });
    const over = frame.histogram!.segments.filter((s) => s.over);
    expect(over.length).toBeGreaterThan(0);
    // Ana (index 0) carries 2 units on the double-booked days.
    expect(over.every((s) => s.resourceIndex === 0 && s.units === 2)).toBe(true);
  });

  it("is absent when no task carries a resource", () => {
    const plain = [task({ id: "x", start: S(2026, 9, 7), finish: S(2026, 9, 9) })];
    const frame = layoutGantt(payload(plain, view), { width: 700 });
    expect(frame.histogram).toBeUndefined();
  });

  it("is absent unless histogram=on", () => {
    const frame = layoutGantt(payload(tasks, { window: view.window }), { width: 700 });
    expect(frame.histogram).toBeUndefined();
  });

  it("the headless SVG draws the legend and an over-allocation hatch", () => {
    const svg = ganttSvg(payload(tasks, view), { width: 700 });
    expect(svg).toContain(">Ana<");
    expect(svg).toContain(">Bob<");
    expect(svg).toContain("url(#gantt-crit-hatch)"); // the over-allocation cue reuses the hatch
    expect(svg).toMatch(/stroke-dasharray="3 2"/); // the 1-unit capacity line
  });
});
