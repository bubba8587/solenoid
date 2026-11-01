// [[C86]] membershipByGesture
import { describe, it, expect } from "vitest";
import { ScheduleNode } from "../../../src/graph/nodeClasses";
import { extractInit } from "../../../src/graph/nodeInit";
import { parseDateToSerial, formatDateSerial } from "../../../src/graph/nodes/dateSerial";

import { cubeFromColumns, isCubeValue, formatFrameCell, type CubeValue } from "../../../src/graph/frame";

const MON = parseDateToSerial("2026-01-05");
const c: CubeValue = cubeFromColumns([
  { name: "Task", cells: ["A", "B"], type: "string" },
  { name: "Duration", cells: [2, 1], type: "number" },
  { name: "Predecessors", cells: [[], ["A"]] },
]);

describe("ScheduleNode", () => {


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


  it("the Longest path value round-trips and reaches the engine", () => {
    const n = new ScheduleNode({ criticalPaths: "longest" });
    expect(extractInit(n as never).criticalPaths).toBe("longest");
    const out = n.data({ tasks: [c], start: [MON] });
    expect(isCubeValue(out.cube)).toBe(true);
  });


});
