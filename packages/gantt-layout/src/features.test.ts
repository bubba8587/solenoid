import { describe, it, expect } from "vitest";
import { serialFromCivil } from "./serial";
import { layoutGantt } from "./layout";
import { buildRows } from "./rows";
import { buildColumns } from "./columns";
import { formatCell } from "./cell";
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

describe("baseline ghost", () => {
  const t = task({ id: "a", start: S(2026, 9, 10), finish: S(2026, 9, 14), baselineStart: S(2026, 9, 7), baselineFinish: S(2026, 9, 11) });
  it("draws a ghost rect from the baseline start to finish+1", () => {
    const frame = layoutGantt(payload([t], { zoom: "day", window: [S(2026, 9, 6), S(2026, 9, 16)] }), { width: 800 });
    const bar = frame.bars[0];
    expect(bar.baseline).toBeDefined();
    expect(bar.baseline!.x).toBeCloseTo((t.baselineStart! - frame.scale.from) * frame.scale.pxPerDay, 3);
    expect(bar.baseline!.w).toBeCloseTo(5 * frame.scale.pxPerDay, 3); // 7..11 inclusive = 5 days
  });
  it("baseline:false hides the ghost", () => {
    const frame = layoutGantt(payload([t], { baseline: false }), { width: 800 });
    expect(frame.bars[0].baseline).toBeUndefined();
  });
});

describe("deadline marker + late cue", () => {
  it("places a deadline flag at the end of the deadline day", () => {
    const t = task({ id: "a", start: S(2026, 9, 7), finish: S(2026, 9, 11), deadline: S(2026, 9, 10), late: false });
    const frame = layoutGantt(payload([t], { zoom: "day", window: [S(2026, 9, 6), S(2026, 9, 14)] }), { width: 800 });
    const bar = frame.bars[0];
    expect(bar.deadlineX).toBeCloseTo((t.deadline! + 1 - frame.scale.from) * frame.scale.pxPerDay, 3);
  });
  it("a late task carries the late flag (a non-color cue is drawn from it)", () => {
    const t = task({ id: "a", start: S(2026, 9, 7), finish: S(2026, 9, 20), deadline: S(2026, 9, 14), late: true });
    const frame = layoutGantt(payload([t]), { width: 800 });
    expect(frame.bars[0].late).toBe(true);
  });
});

describe("section bands by group", () => {
  it("inserts a band row before each new top-level group", () => {
    const rows = buildRows(
      payload(
        [
          task({ id: "a", start: S(2026, 9, 7), finish: S(2026, 9, 9), group: "Site" }),
          task({ id: "b", start: S(2026, 9, 10), finish: S(2026, 9, 12), group: "Site" }),
          task({ id: "c", start: S(2026, 9, 13), finish: S(2026, 9, 15), group: "Build" }),
        ],
        { group_by: true },
      ),
      24,
    );
    const sections = rows.filter((r) => r.section).map((r) => r.id);
    expect(sections).toEqual(["__section:Site", "__section:Build"]);
    // Bands sit before their tasks; total rows = 3 tasks + 2 bands.
    expect(rows.length).toBe(5);
  });
  it("group_by:false draws no bands", () => {
    const rows = buildRows(
      payload([task({ id: "a", start: S(2026, 9, 7), finish: S(2026, 9, 9), group: "Site" })], { group_by: false }),
      24,
    );
    expect(rows.some((r) => r.section)).toBe(false);
  });
});

describe("passthrough color", () => {
  it("uses the task's color column on the bar", () => {
    const frame = layoutGantt(payload([task({ id: "a", start: S(2026, 9, 7), finish: S(2026, 9, 9), color: "#ff8800" })]), { width: 800 });
    expect(frame.bars[0].color).toBe("#ff8800");
  });
});

describe("split bars (out-of-sequence progress)", () => {
  it("draws a part per segment with the right rects and no progress overlay", () => {
    const t = task({
      id: "a",
      start: S(2026, 9, 7),
      finish: S(2026, 9, 18),
      complete: 40,
      segments: [[S(2026, 9, 7), S(2026, 9, 9)], [S(2026, 9, 13), S(2026, 9, 18)]],
    });
    const frame = layoutGantt(payload([t], { zoom: "day", window: [S(2026, 9, 6), S(2026, 9, 20)] }), { width: 900 });
    const bar = frame.bars[0];
    expect(bar.segments).toBeDefined();
    expect(bar.segments!.length).toBe(2);
    const ppd = frame.scale.pxPerDay;
    expect(bar.segments![0].x).toBeCloseTo((S(2026, 9, 7) - frame.scale.from) * ppd, 3);
    expect(bar.segments![0].w).toBeCloseTo(3 * ppd, 3); // 7..9 inclusive = 3 days
    expect(bar.segments![1].w).toBeCloseTo(6 * ppd, 3); // 13..18 inclusive = 6 days
    expect(bar.progressW).toBe(0); // the split conveys actual/remaining, no separate fill
    // The headless SVG carries a dotted connector across the gap.
    const svg = ganttSvg(payload([t], { zoom: "day", window: [S(2026, 9, 6), S(2026, 9, 20)] }), { width: 900 });
    expect(svg).toMatch(/stroke-dasharray="2 2"/);
  });
  it("a single segment is not treated as a split", () => {
    const t = task({ id: "a", start: S(2026, 9, 7), finish: S(2026, 9, 11), complete: 50, segments: [[S(2026, 9, 7), S(2026, 9, 11)]] });
    const frame = layoutGantt(payload([t]), { width: 700 });
    expect(frame.bars[0].segments).toBeUndefined();
    expect(frame.bars[0].progressW).toBeGreaterThan(0);
  });
});

describe("duration column", () => {
  it("shows working days from the payload, not the calendar span", () => {
    // 12-Feb .. 23-Feb inclusive is 12 calendar days but 8 working days.
    const t = task({ id: "frontend", start: S(2026, 2, 12), finish: S(2026, 2, 23), duration: 8 });
    expect(formatCell("duration", t, payload([t]))).toBe("8");
  });
  it("falls back to the inclusive calendar span when duration is absent", () => {
    const t = task({ id: "a", start: S(2026, 2, 12), finish: S(2026, 2, 23) });
    expect(formatCell("duration", t, payload([t]))).toBe("12");
  });
  it("a milestone reads 0", () => {
    const t = task({ id: "m", start: S(2026, 2, 12), finish: S(2026, 2, 12), milestone: true });
    expect(formatCell("duration", t, payload([t]))).toBe("0");
  });
});

describe("predecessor text column", () => {
  it("shows the payload's predecessorText when the column is requested", () => {
    const t = task({ id: "b", start: S(2026, 9, 10), finish: S(2026, 9, 12) });
    const p = payload([t], { columns: ["name", "predecessors"] }, { predecessorText: { b: "Design, Framing SS+2" } });
    const cols = buildColumns(p);
    expect(cols.map((c) => c.key)).toEqual(["name", "predecessors"]);
    expect(formatCell("predecessors", t, p)).toBe("Design, Framing SS+2");
  });
});

describe("interactive collapse (collapsedIds) + hasChildren", () => {
  const tasks = [
    task({ id: "Discovery", start: S(2026, 1, 5), finish: S(2026, 1, 20), level: 0, summary: true }),
    task({ id: "Interviews", start: S(2026, 1, 5), finish: S(2026, 1, 9), level: 1 }),
    task({ id: "Synthesis", start: S(2026, 1, 12), finish: S(2026, 1, 16), level: 1 }),
    task({ id: "Build", start: S(2026, 1, 21), finish: S(2026, 2, 6), level: 0, summary: true }),
    task({ id: "Design", start: S(2026, 1, 21), finish: S(2026, 1, 27), level: 1 }),
  ];
  it("marks phases with hasChildren and leaves without", () => {
    const rows = buildRows(payload(tasks, { group_by: false }), 24);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("Discovery")!.hasChildren).toBe(true);
    expect(byId.get("Build")!.hasChildren).toBe(true);
    expect(byId.get("Interviews")!.hasChildren).toBeFalsy();
  });
  it("collapsing a phase hides its subtree but keeps siblings", () => {
    const rows = buildRows(payload(tasks, { group_by: false }), 24, new Set(["Discovery"]));
    expect(rows.map((r) => r.id)).toEqual(["Discovery", "Build", "Design"]);
  });
  it("an empty collapsed set shows the whole tree", () => {
    const rows = buildRows(payload(tasks, { group_by: false }), 24, new Set());
    expect(rows.map((r) => r.id)).toEqual(["Discovery", "Interviews", "Synthesis", "Build", "Design"]);
  });
  it("collapsedIds overrides the view.collapse floor (can expand past it)", () => {
    // view.collapse=0 would hide all level>0; collapsedIds mode ignores it, so an empty set
    // reveals children even though the option asked to collapse.
    const rows = buildRows(payload(tasks, { group_by: false, collapse: 0 }), 24, new Set());
    expect(rows.some((r) => r.id === "Interviews")).toBe(true);
  });
});

describe("collapse level", () => {
  it("hides rows deeper than the collapse level", () => {
    const rows = buildRows(
      payload(
        [
          task({ id: "parent", start: S(2026, 9, 7), finish: S(2026, 9, 20), level: 0, summary: true }),
          task({ id: "child", start: S(2026, 9, 7), finish: S(2026, 9, 10), level: 1 }),
        ],
        { collapse: 0, group_by: false },
      ),
      24,
    );
    expect(rows.map((r) => r.id)).toEqual(["parent"]);
  });
});
