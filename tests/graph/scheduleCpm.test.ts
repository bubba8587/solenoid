import { describe, it, expect } from "vitest";
import { scheduleTasks } from "../../src/graph/scheduleCpm";
import { parseDateToSerial, formatDateSerial } from "../../src/graph/nodes/dateSerial";
import { isSolError } from "../../src/graph/errorValue";
import { cubeFromColumns, type CubeValue, type CubeCell } from "../../src/graph/frame";

// The tasks arrive as a CUBE: Predecessors is a list cell (zero or more names), never an
// in-cell string list — the cube exists to eliminate those (author, 2026-09-07).

const d = (iso: string) => parseDateToSerial(iso);
const iso = (serial: unknown) => formatDateSerial(serial as number, "YYYY-MM-DD");
const MON = d("2026-01-05");

function tasks(rows: [string, number | null, string[] | string | null][], extra?: { project?: string[] }): CubeValue {
  const cols: { name: string; cells: CubeCell[]; type?: "string" | "number" }[] = [
    { name: "Task", cells: rows.map((r) => r[0]), type: "string" },
    { name: "Duration", cells: rows.map((r) => r[1]), type: "number" },
    { name: "Predecessors", cells: rows.map((r) => r[2]) },
  ];
  if (extra?.project) cols.push({ name: "Project", cells: extra.project, type: "string" });
  return cubeFromColumns(cols);
}

const col = (c: CubeValue, name: string) => c.columns.find((x) => x.name === name)!.cells;

describe("scheduleTasks — the CPM pass over a cube", () => {
  it("a chain: each task starts the working day after its predecessor finishes", () => {
    const r = scheduleTasks(tasks([["A", 2, []], ["B", 3, ["A"]]]), { start: MON, workingDays: true });
    expect(col(r.cube, "Start").map(iso)).toEqual(["2026-01-05", "2026-01-07"]);
    expect(col(r.cube, "Finish").map(iso)).toEqual(["2026-01-06", "2026-01-09"]);
    expect(col(r.cube, "Float")).toEqual([0, 0]);
    expect(col(r.cube, "Critical")).toEqual([true, true]);
    expect(iso(r.projectFinish)).toBe("2026-01-09");
  });

  it("the kitchen: a diamond, a holiday inside a task, float on the parallel branches, a closing milestone", () => {
    const c = tasks([
      ["Demolition", 2, []],
      ["Plumbing rough-in", 3, ["Demolition"]],
      ["Electrical rough-in", 2, ["Demolition"]],
      ["Drywall", 2, ["Plumbing rough-in", "Electrical rough-in"]],
      ["Paint", 2, ["Drywall"]],
      ["Cabinets", 4, ["Drywall"]],
      ["Countertops", 5, ["Cabinets", "Paint"]],
      ["Final inspection", 0, ["Countertops"]],
    ]);
    const r = scheduleTasks(c, { start: MON, workingDays: true, holidays: [d("2026-01-19")] });
    expect(col(r.cube, "Start").map(iso)).toEqual([
      "2026-01-05", "2026-01-07", "2026-01-07", "2026-01-12", "2026-01-14", "2026-01-14", "2026-01-21", "2026-01-27",
    ]);
    // Cabinets spans the 19 Jan holiday: Wed 14, Thu 15, Fri 16, Tue 20.
    expect(col(r.cube, "Finish").map(iso)).toEqual([
      "2026-01-06", "2026-01-09", "2026-01-08", "2026-01-13", "2026-01-15", "2026-01-20", "2026-01-27", "2026-01-27",
    ]);
    expect(col(r.cube, "Float")).toEqual([0, 0, 1, 0, 2, 0, 0, 0]);
    expect(col(r.cube, "Critical")).toEqual([true, true, false, true, false, true, true, true]);
    expect(iso(r.projectFinish)).toBe("2026-01-27");
    // Original columns first (the Predecessors list cells untouched, by reference), then the four appended.
    expect(r.cube.columns.map((x) => x.name).slice(0, 7)).toEqual(["Task", "Duration", "Predecessors", "Start", "Finish", "Float", "Critical"]);
    expect(r.cube.columns.map((x) => x.name).slice(7)).toEqual(["Free Float", "Early Start", "Early Finish", "Late Start", "Late Finish", "Driving", "Late"]);
    expect(col(r.cube, "Driving")).toEqual([null, "Demolition", "Demolition", "Plumbing rough-in", "Drywall", "Drywall", "Cabinets", "Countertops"]);
    expect(col(r.cube, "Predecessors")[3]).toBe(col(c, "Predecessors")[3]);
  });

  it("a text Predecessors cell is ONE name (never split); names match trimmed, case-insensitively; blank is none", () => {
    const r = scheduleTasks(tasks([["Demolition", 2, null], ["Plumbing", 1, " demolition "]]), { start: MON, workingDays: true });
    expect(col(r.cube, "Start").map(iso)).toEqual(["2026-01-05", "2026-01-07"]);
    const err = (() => { try { scheduleTasks(tasks([["A", 1, []], ["B", 1, "A, C"]]), { start: MON, workingDays: true }); } catch (e) { return e; } return null; })();
    expect(isSolError(err) && err.message).toMatch(/"A, C"/); // the comma string is one (unknown) name
  });

  it("two roots start together; calendar mode counts weekends", () => {
    const r = scheduleTasks(tasks([["A", 3, []], ["B", 1, []], ["C", 1, ["A", "B"]]]), { start: d("2026-01-09"), workingDays: false });
    expect(col(r.cube, "Start").map(iso)).toEqual(["2026-01-09", "2026-01-09", "2026-01-12"]);
    expect(col(r.cube, "Float")).toEqual([0, 2, 0]);
  });

  it("a start on a weekend rolls to Monday in working mode; a blank duration is a milestone", () => {
    const r = scheduleTasks(tasks([["Kickoff", null, []], ["A", 1, ["Kickoff"]]]), { start: d("2026-01-10"), workingDays: true });
    expect(col(r.cube, "Start").map(iso)).toEqual(["2026-01-12", "2026-01-12"]);
    expect(col(r.cube, "Finish").map(iso)).toEqual(["2026-01-12", "2026-01-12"]);
  });

  it("errors name the task: a cycle, an unknown predecessor, a bad duration, a duplicate", () => {
    const err = (c: CubeValue) => {
      try { scheduleTasks(c, { start: MON, workingDays: true }); } catch (e) { return isSolError(e) ? e : null; }
      return null;
    };
    expect(err(tasks([["A", 1, ["B"]], ["B", 1, ["A"]]]))?.message).toMatch(/loop/);
    expect(err(tasks([["A", 1, ["Z"]]]))?.message).toMatch(/"Z"/);
    expect(err(tasks([["A", -1, []]]))?.message).toMatch(/"A"/);
    expect(err(tasks([["A", 1, []], ["A", 1, []]]))?.message).toMatch(/twice/);
    expect(err(tasks([["A", 1, ["B"]], ["B", 1, ["A"]]]))?.code).toBe("#VALUE!");
  });

  it("gantt: excludes weekends + holidays, sections per Project, crit + milestone tags, exclusive end dates", () => {
    const c = tasks([["A", 2, []], ["B", 1, ["A"]], ["Done", 0, ["B"]]], { project: ["Prep", "Prep", "Wrap"] });
    const r = scheduleTasks(c, { start: MON, workingDays: true, holidays: [d("2026-01-06")] });
    expect(r.gantt.split("\n")).toEqual([
      "gantt",
      "    dateFormat YYYY-MM-DD",
      "    axisFormat %d %b",
      "    excludes weekends, 2026-01-06",
      "    section Prep",
      "    A :crit, t0, 2026-01-05, 2026-01-08",
      "    B :crit, t1, 2026-01-08, 2026-01-09",
      "    section Wrap",
      "    Done :milestone, crit, t2, 2026-01-08, 0d",
    ]);
  });

  it("typed links: a nested Task · Type · Lag table; the one rule's columns; nesting as the WBS", () => {
    const deps = (rows: [string, string, number][]) => cubeFromColumns([
      { name: "Task", cells: rows.map((r) => r[0]), type: "string" },
      { name: "Type", cells: rows.map((r) => r[1]), type: "string" },
      { name: "Lag", cells: rows.map((r) => r[2]), type: "number" },
    ]);
    const c = cubeFromColumns([
      { name: "Task", cells: ["A", "B", "C"], type: "string" },
      { name: "Duration", cells: [4, 2, 1], type: "number" },
      { name: "Predecessors", cells: [null, deps([["A", "SS", 1]]), deps([["B", "FS", -1]])] },
      { name: "Deadline", cells: [d("2026-01-07"), null, null], type: "date" },
      { name: "Manual", cells: [false, false, true], type: "logical" },
      { name: "Start", cells: [null, null, d("2026-01-06")], type: "date" },
    ]);
    const r = scheduleTasks(c, { start: MON, workingDays: true });
    expect(col(r.cube, "Start").map(iso)).toEqual(["2026-01-05", "2026-01-06", "2026-01-06"]);
    expect(col(r.cube, "Late")).toEqual([true, false, false]);
    expect(col(r.cube, "Float")[0]).toBe(-1);
    // The typed Start column is replaced in place by the scheduled one; no duplicate.
    expect(r.cube.columns.filter((x) => x.name === "Start").length).toBe(1);
    expect(r.diagnostics.columns.map((x) => x.name)).toEqual(["Check", "Task", "Detail"]);
    expect(r.diagnostics.columns[0].values).toContain("Manual");
    expect(r.diagnostics.columns[0].values).toContain("Past deadline");

    const nested = cubeFromColumns([
      { name: "Task", cells: ["Phase 1", "Wrap"], type: "string" },
      { name: "Tasks", cells: [tasks([["A", 2, []], ["B", 3, ["A"]]]), null] },
      { name: "Duration", cells: [null, 1], type: "number" },
      { name: "Predecessors", cells: [null, ["Phase 1"]] },
    ]);
    const n = scheduleTasks(nested, { start: MON, workingDays: true });
    expect(col(n.cube, "Summary")).toEqual([true, false]);
    expect(col(n.cube, "Duration")).toEqual([5, 1]); // the phase's working days, filled in
    expect(col(n.cube, "Finish").map(iso)).toEqual(["2026-01-09", "2026-01-12"]);
    const inner = col(n.cube, "Tasks")[0] as CubeValue;
    expect(col(inner, "Start").map(iso)).toEqual(["2026-01-05", "2026-01-07"]);
    expect(col(inner, "WBS")).toEqual(["1.1", "1.2"]);
    expect(n.output.tasks.map((t) => t.name)).toEqual(["Phase 1", "A", "B", "Wrap"]);
    expect(n.gantt).toContain("      A :");
    // A level with no Duration column at all (only names + children) gets one appended.
    const phasesOnly = cubeFromColumns([
      { name: "Task", cells: ["Phase 1", "Phase 2"], type: "string" },
      { name: "Tasks", cells: [tasks([["A", 2, []]]), tasks([["B", 3, []]])] },
      { name: "Predecessors", cells: [null, ["Phase 1"]] },
    ]);
    const po = scheduleTasks(phasesOnly, { start: MON, workingDays: true });
    expect(col(po.cube, "Duration")).toEqual([2, 3]);
    expect(col(po.cube, "Start").map(iso)).toEqual(["2026-01-05", "2026-01-07"]);
  });

  it("an empty tasks cube schedules nothing and finishes on the start", () => {
    const r = scheduleTasks(tasks([]), { start: MON, workingDays: true });
    expect(col(r.cube, "Start")).toEqual([]);
    expect(iso(r.projectFinish)).toBe("2026-01-05");
  });
});
