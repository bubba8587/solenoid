import { describe, it, expect } from "vitest";
import { ganttPayloadFromSchedule } from "../../src/graph/ganttPayload";
import { scheduleTasks } from "../../src/graph/scheduleCpm";
import { parseDateToSerial } from "../../src/graph/nodes/dateSerial";
import { isSolError } from "../../src/graph/errorValue";
import { cubeFromColumns, type CubeValue } from "../../src/graph/frame";

const d = (iso: string) => parseDateToSerial(iso);
const MON = d("2026-01-05");

const plan: CubeValue = cubeFromColumns([
  { name: "Task", cells: ["Phase 1", "Wrap"], type: "string" },
  { name: "Tasks", cells: [cubeFromColumns([
    { name: "Task", cells: ["A", "B", "Done"], type: "string" },
    { name: "Duration", cells: [2, 3, 0], type: "number" },
    { name: "Predecessors", cells: [[], ["A"], ["B"]] },
  ]), null] },
  { name: "Duration", cells: [null, 1], type: "number" },
  { name: "Predecessors", cells: [null, ["Phase 1"]] },
  { name: "Project", cells: ["Build", "Close"], type: "string" },
]);

describe("ganttPayloadFromSchedule", () => {
  it("flattens the WBS, carries flags and links, computes shading from the calendar, parses the view keys", () => {
    const r = scheduleTasks(plan, { start: MON, workingDays: true, holidays: [d("2026-01-07")] });
    const p = ganttPayloadFromSchedule(r.cube, { today: MON, options: "zoom=week;critical=off;title=Plan;window=2026-01-01,2026-02-01", calendar: { holidays: [d("2026-01-07")] } });
    if (isSolError(p)) throw new Error(p.message);
    expect(p.kind).toBe("gantt");
    expect(p.tasks.map((t) => [t.name, t.level, t.summary, t.milestone])).toEqual([
      ["Phase 1", 0, true, false], ["A", 1, false, false], ["B", 1, false, false], ["Done", 1, false, true], ["Wrap", 0, false, false],
    ]);
    expect(p.tasks[0].float).toBeNull();
    expect(p.tasks.every((t) => t.critical)).toBe(true);
    expect(p.tasks[0].group).toBe("Build");
    expect(p.links.map((l) => `${l.from}→${l.to}`)).toEqual(["A→B", "B→Done", "Phase 1→Wrap"]);
    expect(p.links[0].critical).toBe(true);
    expect(p.predecessorText).toEqual({ Wrap: "Phase 1", B: "A", Done: "B" });
    expect(p.holidays).toEqual([d("2026-01-07")]);
    expect(p.weekend).toEqual([0, 6]);
    expect(p.nonWorking.some(([a, b]) => a === d("2026-01-10") && b === d("2026-01-11"))).toBe(true);
    expect(p.view).toEqual({ zoom: "week", critical: false, window: [d("2026-01-01"), d("2026-02-01")] });
    expect(p.projectStart).toBe(MON);
    expect(p.projectFinish).toBe(d("2026-01-13"));
  });

  it("a baseline joins by name; a table without dates is a #VALUE! naming the row", () => {
    const r = scheduleTasks(plan, { start: MON, workingDays: true });
    const later = scheduleTasks(plan, { start: d("2026-01-12"), workingDays: true });
    const p = ganttPayloadFromSchedule(later.cube, { today: null, baseline: r.cube });
    if (isSolError(p)) throw new Error(p.message);
    expect(p.tasks[1].baselineStart).toBe(MON);
    expect(p.today).toBeNull();
    const bad = ganttPayloadFromSchedule(cubeFromColumns([{ name: "Task", cells: ["X"], type: "string" }]), { today: null });
    expect(isSolError(bad) && bad.message).toMatch(/"X"/);
  });
});
