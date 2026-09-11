import { describe, it, expect } from "vitest";
import { ScheduleNode } from "../../../src/graph/rete-nodes";
import { extractInit } from "../../../src/graph/copyPaste";
import { parseDateToSerial, formatDateSerial } from "../../../src/graph/nodes/dateSerial";
import { isSolError } from "../../../src/graph/errorValue";
import { cubeFromColumns, isCubeValue, type CubeValue } from "../../../src/graph/frame";

const MON = parseDateToSerial("2026-01-05");
const c: CubeValue = cubeFromColumns([
  { name: "Task", cells: ["A", "B"], type: "string" },
  { name: "Duration", cells: [2, 1], type: "number" },
  { name: "Predecessors", cells: [[], ["A"]] },
]);

describe("ScheduleNode", () => {
  it("takes a cube and a wired start; the three outputs agree; the schedule is a cube", () => {
    const n = new ScheduleNode();
    expect(Object.keys(n.inputs)).toEqual(["tasks", "start", "holidays", "weekend_code", "status", "hours"]);
    expect(Object.keys(n.outputs)).toEqual(["cube", "finish", "diagnostics", "gantt"]);
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
