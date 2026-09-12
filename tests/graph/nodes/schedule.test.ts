import { describe, it, expect } from "vitest";
import { ScheduleNode } from "../../../src/graph/rete-nodes";
import { extractInit } from "../../../src/graph/copyPaste";
import { parseDateToSerial, formatDateSerial } from "../../../src/graph/nodes/dateSerial";
import { isSolError } from "../../../src/graph/errorValue";
import { cubeFromColumns, isCubeValue, formatFrameCell, type CubeValue, type FrameValue } from "../../../src/graph/frame";

const MON = parseDateToSerial("2026-01-05");
const c: CubeValue = cubeFromColumns([
  { name: "Task", cells: ["A", "B"], type: "string" },
  { name: "Duration", cells: [2, 1], type: "number" },
  { name: "Predecessors", cells: [[], ["A"]] },
]);

describe("ScheduleNode", () => {
  it("takes a cube and a wired start; the three outputs agree; the schedule is a cube", () => {
    const n = new ScheduleNode();
    expect(Object.keys(n.inputs)).toEqual(["tasks", "links", "start", "holidays", "weekend_code", "status", "hours"]);
    expect(Object.keys(n.outputs)).toEqual(["cube", "finish", "diagnostics", "gantt", "mspdi"]);
    const out = n.data({ tasks: [c], start: [MON] });
    expect(isCubeValue(out.cube)).toBe(true);
    expect(formatDateSerial(out.finish as number, "YYYY-MM-DD")).toBe("2026-01-07");
    expect(String(out.gantt).startsWith("gantt")).toBe(true);
    expect(n.cachedResult).toBe(out.cube);
  });

  it("unwired start = today; a wired BLANK start schedules nothing (value-semantics: propagate)", () => {
    const n = new ScheduleNode();
    expect(isCubeValue(n.data({ tasks: [c] }).cube)).toBe(true);
    const blank = n.data({ tasks: [c], start: [null] });
    expect(blank.cube).toBeNull();
    expect(blank.finish).toBeNull();
    expect(n.cachedResult).toBeNull();
  });

  it("calendar mode counts weekends; the mode round-trips through extractInit and a stale value falls back", () => {
    const n = new ScheduleNode({ mode: "calendar" });
    const out = n.data({ tasks: [c], start: [parseDateToSerial("2026-01-09")] });
    expect(formatDateSerial(out.finish as number, "YYYY-MM-DD")).toBe("2026-01-11");
    expect(extractInit(n as never).mode).toBe("calendar");
    expect(new ScheduleNode({ mode: "bogus" as never }).mode).toBe("working");
  });

  it("Minutes precision: an FS successor starts the same afternoon; the field round-trips", () => {
    const n = new ScheduleNode({ precision: "minutes" });
    const half = cubeFromColumns([
      { name: "Task", cells: ["A", "B"], type: "string" }, { name: "Duration", cells: [0.5, 0.5], type: "number" }, { name: "Predecessors", cells: [[], ["A"]] },
    ]);
    const out = n.data({ tasks: [half], start: [MON] });
    expect(formatDateSerial(out.finish as number, "YYYY-MM-DD HH:mm")).toBe("2026-01-05 17:00");
    expect(extractInit(n as never).precision).toBe("minutes");
    expect(new ScheduleNode({ precision: "bogus" as never }).precision).toBe("days");
  });

  it("Minutes precision stamps the datetime format on the date columns so cells read with a time", () => {
    const half = cubeFromColumns([
      { name: "Task", cells: ["A", "B"], type: "string" }, { name: "Duration", cells: [0.5, 0.5], type: "number" }, { name: "Predecessors", cells: [[], ["A"]] },
    ]);
    const col = (cube: CubeValue, name: string) => cube.columns.find((cc) => cc.name === name);

    const mins = new ScheduleNode({ precision: "minutes" }).data({ tasks: [half], start: [MON] });
    if (!isCubeValue(mins.cube)) throw new Error("expected a cube");
    for (const name of ["Start", "Finish", "Early Start", "Early Finish", "Late Start", "Late Finish"]) {
      expect(col(mins.cube, name)?.format?.customPattern).toBe("DD-MMM-YYYY HH:mm");
    }
    expect(col(mins.cube, "Float")?.format).toBeUndefined(); // a non-date column stays unformatted
    // The stamped format drives the cube's date cells to render with the clock time.
    const startCell = col(mins.cube, "Start")!.cells[0] as number;
    expect(formatFrameCell("date", startCell, col(mins.cube, "Start")!.format)).toMatch(/^05-Jan-2026 \d\d:\d\d$/);

    const days = new ScheduleNode().data({ tasks: [half], start: [MON] });
    if (!isCubeValue(days.cube)) throw new Error("expected a cube");
    expect(col(days.cube, "Start")?.format).toBeUndefined();
    expect(col(days.cube, "Finish")?.format).toBeUndefined();
    // Days mode still reads date-only.
    expect(formatFrameCell("date", col(days.cube, "Start")!.cells[0] as number, col(days.cube, "Start")?.format)).toBe("05-Jan-2026");
  });

  it("Every path marks an independent short chain critical; the field round-trips", () => {
    // A long chain A→B drives the finish; C is an independent one-day task that ends
    // early, so it is critical only when every chain is measured on its own.
    const chains = cubeFromColumns([
      { name: "Task", cells: ["A", "B", "C"], type: "string" },
      { name: "Duration", cells: [3, 3, 1], type: "number" },
      { name: "Predecessors", cells: [[], ["A"], []] },
    ]);
    const criticalOf = (cube: CubeValue, task: string): unknown => {
      const taskCol = cube.columns.find((col) => col.name.toLowerCase() === "task");
      const critCol = cube.columns.find((col) => col.name.toLowerCase() === "critical");
      const i = taskCol?.cells.findIndex((v) => String(v) === task) ?? -1;
      return i >= 0 ? critCol?.cells[i] : undefined;
    };

    const one = new ScheduleNode(); // default: "one"
    const oneOut = one.data({ tasks: [chains], start: [MON] });
    if (!isCubeValue(oneOut.cube)) throw new Error("expected a cube");
    expect(criticalOf(oneOut.cube, "B")).toBe(true);
    expect(criticalOf(oneOut.cube, "C")).toBe(false);

    const many = new ScheduleNode({ criticalPaths: "many" });
    const manyOut = many.data({ tasks: [chains], start: [MON] });
    if (!isCubeValue(manyOut.cube)) throw new Error("expected a cube");
    expect(criticalOf(manyOut.cube, "B")).toBe(true);
    expect(criticalOf(manyOut.cube, "C")).toBe(true);

    expect(extractInit(many as never).criticalPaths).toBe("many");
    expect(new ScheduleNode({ criticalPaths: "bogus" as never }).criticalPaths).toBe("one");
  });

  it("a wired Links frame adds predecessors to a tasks table that carries none", () => {
    const tasksNoPred = cubeFromColumns([
      { name: "Task", cells: ["A", "B"], type: "string" },
      { name: "Duration", cells: [2, 1], type: "number" },
    ]);
    const links: FrameValue = { __frame: true, columns: [
      { name: "Successor", type: "string", values: ["B"] },
      { name: "Predecessor", type: "string", values: ["A"] },
      { name: "Type", type: "string", values: ["FS"] },
      { name: "Lag", type: "number", values: [0] },
    ] };
    const n = new ScheduleNode();
    const withLinks = n.data({ tasks: [tasksNoPred], links: [links], start: [MON] });
    expect(formatDateSerial(withLinks.finish as number, "YYYY-MM-DD")).toBe("2026-01-07"); // B follows A
    const without = n.data({ tasks: [tasksNoPred], start: [MON] });
    expect(formatDateSerial(without.finish as number, "YYYY-MM-DD")).toBe("2026-01-06"); // A and B in parallel
  });

  it("a Links row naming a task not in the plan is the schedule #VALUE! naming it", () => {
    const links: FrameValue = { __frame: true, columns: [
      { name: "Successor", type: "string", values: ["Nope"] },
      { name: "Predecessor", type: "string", values: ["A"] },
    ] };
    const out = new ScheduleNode().data({ tasks: [c], links: [links], start: [MON] });
    expect(isSolError(out.cube) && out.cube.code).toBe("#VALUE!");
    expect(isSolError(out.cube) && out.cube.message).toMatch(/Nope/);
  });

  it("the Longest path value round-trips and reaches the engine", () => {
    const n = new ScheduleNode({ criticalPaths: "longest" });
    expect(extractInit(n as never).criticalPaths).toBe("longest");
    const out = n.data({ tasks: [c], start: [MON] });
    expect(isCubeValue(out.cube)).toBe(true);
  });

  it("a verb error comes out every socket as the one #VALUE! and is cached", () => {
    const n = new ScheduleNode();
    const bad = cubeFromColumns([{ name: "Task", cells: ["A"], type: "string" }, { name: "Duration", cells: [1], type: "number" }, { name: "Predecessors", cells: [["A"]] }]);
    const out = n.data({ tasks: [bad], start: [MON] });
    expect(isSolError(out.cube) && out.cube.code).toBe("#VALUE!");
    expect(out.gantt).toBe(out.cube);
    expect(out.diagnostics).toBe(out.cube);
    expect(n.cachedGantt).toBe(out.cube);
  });

  it("the weekend code and status date reach the engine", () => {
    const n = new ScheduleNode();
    n.literals.weekend_code = 7; // Fri + Sat off
    const out = n.data({ tasks: [c], start: [parseDateToSerial("2026-01-08")] }); // a Thursday
    expect(formatDateSerial(out.finish as number, "YYYY-MM-DD")).toBe("2026-01-12"); // Thu, Sun, Mon
    const s = new ScheduleNode();
    const progressed = cubeFromColumns([
      { name: "Task", cells: ["A"], type: "string" }, { name: "Duration", cells: [4], type: "number" }, { name: "Complete", cells: [50], type: "number" },
    ]);
    const o = s.data({ tasks: [progressed], start: [MON], status: [parseDateToSerial("2026-01-08")] });
    expect(formatDateSerial(o.finish as number, "YYYY-MM-DD")).toBe("2026-01-12");
  });
});
