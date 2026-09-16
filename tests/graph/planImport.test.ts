import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planToCube, mspdiToPlan, isMspdiText, csvPlanToCube, planToFrame } from "../../src/graph/planImport";
import { csvToFrame } from "../../src/graph/nodes/connection";
import { scheduleTasks } from "../../src/graph/scheduleCpm";
import { formatDateSerial, parseDateToSerial } from "../../src/graph/nodes/dateSerial";
import { isCubeValue, type CubeValue } from "../../src/graph/frame";

const iso = (s: unknown) => formatDateSerial(s as number, "YYYY-MM-DD");
const col = (c: CubeValue, name: string) => c.columns.find((x) => x.name === name)!.cells;
const XML = readFileSync(join(__dirname, "../../fixtures/schedule/authored-remodel.mspdi.xml"), "utf8");

describe("plan import", () => {
  it("MSPDI → a nested cube the Schedule node reads back to the file's own dates", () => {
    expect(isMspdiText(XML)).toBe(true);
    expect(isMspdiText("<html>")).toBe(false);
    const plan = mspdiToPlan(XML);
    expect(plan.title).toBe("Kitchen remodel");
    expect(plan.cube.columns.map((c) => c.name)).toEqual(["Task", "Duration", "Predecessors", "Start", "Deadline", "Tasks"]);
    expect(col(plan.cube, "Task")).toEqual(["Demolition", "Rough-in", "Drywall", "Paint", "Cabinets", "Countertops", "Appliances", "Final inspection"]);
    const roughIn = col(plan.cube, "Tasks")[1] as CubeValue;
    expect(isCubeValue(roughIn)).toBe(true);
    expect(col(roughIn, "Task")).toEqual(["Plumbing rough-in", "Electrical rough-in"]);
    expect(col(plan.cube, "Predecessors")[2]).toEqual(["Rough-in"]);            // FS/0 → a list of names
    const typed = col(plan.cube, "Predecessors")[6] as CubeValue;               // SS+1 → a Task · Type · Lag table
    expect(col(typed, "Type")).toEqual(["SS"]);
    expect(col(typed, "Lag")).toEqual([1]);
    expect(plan.frame.columns.map((c) => c.name)).toEqual(["Task", "Level", "Duration", "Predecessors", "Start", "Finish", "Deadline", "Complete"]);
    const row = plan.frame.columns[0].values.indexOf("Appliances");
    expect(plan.frame.columns[3].values[row]).toBe("Cabinets SS+1");
    expect(plan.frame.columns[1].values[row + 0]).toBe(0);
    const r = scheduleTasks(plan.cube, { start: plan.start!, workingDays: true, holidays: plan.calendar!.holidays, weekendCode: plan.calendar!.weekendCode });
    expect(col(r.cube, "Finish").map(iso)).toEqual(["2026-01-06", "2026-01-09", "2026-01-13", "2026-01-15", "2026-01-20", "2026-01-27", "2026-01-26", "2026-01-27"]);
    expect(col(r.cube, "Critical")).toEqual([true, true, true, false, true, true, false, true]);
  });

  it("a Smartsheet-style CSV with row-number predecessors becomes a plan; a plain CSV does not", () => {
    const f = csvToFrame("Task Name,Duration,Predecessors\nDemolition,2,\nFraming,3,1\nRoof,2,\"2FS+1d, 1SS\"\nInspect,0,3");
    const cube = csvPlanToCube(f)!;
    expect(cube).not.toBeNull();
    expect(col(cube, "Predecessors")[1]).toEqual(["Demolition"]);
    const roof = col(cube, "Predecessors")[2] as CubeValue;
    expect(col(roof, "Task")).toEqual(["Framing", "Demolition"]);
    expect(col(roof, "Type")).toEqual(["FS", "SS"]);
    expect(col(roof, "Lag")).toEqual([1, 0]);
    expect(col(cube, "Predecessors")[0]).toEqual([]);
    const r = scheduleTasks(cube, { start: parseDateToSerial("2026-01-05"), workingDays: true });
    expect(col(r.cube, "Start").map(iso)).toEqual(["2026-01-05", "2026-01-07", "2026-01-13", "2026-01-14"]);
    expect(csvPlanToCube(csvToFrame("Task,Duration,Predecessors\nA,1,\nB,1,A"))).toBeNull(); // names, not the grammar → a plain table
    expect(csvPlanToCube(csvToFrame("x,y\n1,2"))).toBeNull();
  });

  it("planToCube keeps optional columns only when used; planToFrame flattens with levels", () => {
    const c = planToCube([{ name: "A", duration: 1, predecessors: [] }, { name: "B", duration: 2, predecessors: [{ task: "A", type: "FS", lag: 0 }], complete: 50 }]);
    expect(c.columns.map((x) => x.name)).toEqual(["Task", "Duration", "Predecessors", "Complete"]);
    const f = planToFrame([{ name: "P", duration: 0, predecessors: [], children: [{ name: "A", duration: 1, predecessors: [] }] }]);
    expect(f.columns[1].values).toEqual([0, 1]);
  });
});
