import { describe, it, expect } from "vitest";
import { serialFromCivil, dayOfWeek } from "./serial";
import { layoutCalendar } from "./calendar";
import { ganttSvg } from "./svg";
import type { GanttPayload, GanttTask, GanttViewOptions } from "./payload";

const S = (y: number, m: number, d: number) => serialFromCivil(y, m, d);

function task(p: Partial<GanttTask> & { id: string; start: number; finish: number }): GanttTask {
  return { name: p.id, level: 0, summary: false, milestone: false, complete: 0, critical: false, late: false, violated: false, float: 0, ...p };
}
function payload(tasks: GanttTask[], view: GanttViewOptions = {}, extra: Partial<GanttPayload> = {}): GanttPayload {
  return {
    kind: "gantt", tasks, links: [], nonWorking: [], weekend: [0, 6], holidays: [], today: null, statusDate: null,
    projectStart: Math.min(...tasks.map((t) => t.start)), projectFinish: Math.max(...tasks.map((t) => t.finish)),
    view, ...extra,
  };
}

const build = task({ id: "Build", start: S(2026, 9, 7), finish: S(2026, 9, 18) }); // Mon..Fri, spans 2 weeks
const launch = task({ id: "Launch", start: S(2026, 9, 14), finish: S(2026, 9, 14), milestone: true });
const win: GanttViewOptions = { window: [S(2026, 9, 1), S(2026, 9, 30)] };

describe("calendar layout", () => {
  it("groups weeks into month blocks by each week's mid day", () => {
    const frame = layoutCalendar(payload([build, launch], win), { width: 700 });
    const sep = frame.months.find((m) => m.month === 9 && m.year === 2026);
    expect(sep).toBeDefined();
    // Sept holds the four weeks whose mid day is in September; the Sep28 week (mid = Oct 1) is October.
    expect(sep!.weeks).toBe(4);
    expect(frame.months.some((m) => m.month === 10)).toBe(true);
  });

  it("lays 7 day cells per week and flags weekends", () => {
    const frame = layoutCalendar(payload([build, launch], win), { width: 700 });
    const sep = frame.months.find((m) => m.month === 9)!;
    expect(sep.cells.length).toBe(sep.weeks * 7);
    const sat = sep.cells.find((c) => c.serial === S(2026, 9, 12))!; // a Saturday
    expect(dayOfWeek(sat.serial)).toBe(6);
    expect(sat.weekend).toBe(true);
    expect(sep.cells.find((c) => c.serial === S(2026, 9, 9))!.weekend).toBe(false); // a Wednesday
  });

  it("draws a multi-week task as a chip per week, clipped at the week edges", () => {
    const frame = layoutCalendar(payload([build, launch], win), { width: 700 });
    const sep = frame.months.find((m) => m.month === 9)!;
    const buildChips = sep.chips.filter((c) => c.taskIndex === 0);
    expect(buildChips.length).toBe(2); // week of Sep 7 and week of Sep 14
    // First week continues to the right, second continues from the left.
    expect(buildChips[0].clipRight).toBe(true);
    expect(buildChips[1].clipLeft).toBe(true);
  });

  it("draws a milestone as a single dot on its day", () => {
    const frame = layoutCalendar(payload([build, launch], win), { width: 700 });
    const sep = frame.months.find((m) => m.month === 9)!;
    const dots = sep.milestones.filter((m) => m.taskIndex === 1);
    expect(dots.length).toBe(1);
  });

  it("outlines today's cell", () => {
    const frame = layoutCalendar(payload([build, launch], win, { today: S(2026, 9, 9) }), { width: 700 });
    const sep = frame.months.find((m) => m.month === 9)!;
    expect(sep.cells.filter((c) => c.today).length).toBe(1);
    expect(sep.cells.find((c) => c.today)!.serial).toBe(S(2026, 9, 9));
  });
});

describe("calendar headless SVG", () => {
  it("ganttSvg dispatches to the month grid when layout=calendar", () => {
    const svg = ganttSvg(payload([build, launch], { ...win, layout: "calendar" }), { width: 700 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("September 2026");
    expect(svg).toContain("<circle"); // the milestone dot
  });
});
