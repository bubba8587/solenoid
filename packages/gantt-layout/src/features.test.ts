import { describe, it, expect } from "vitest";
import { serialFromCivil } from "./serial";
import { layoutGantt } from "./layout";
import { buildRows } from "./rows";
import { buildColumns } from "./columns";
import { formatCell } from "./cell";
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

describe("predecessor text column", () => {
  it("shows the payload's predecessorText when the column is requested", () => {
    const t = task({ id: "b", start: S(2026, 9, 10), finish: S(2026, 9, 12) });
    const p = payload([t], { columns: ["name", "predecessors"] }, { predecessorText: { b: "Design, Framing SS+2" } });
    const cols = buildColumns(p);
    expect(cols.map((c) => c.key)).toEqual(["name", "predecessors"]);
    expect(formatCell("predecessors", t, p)).toBe("Design, Framing SS+2");
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
