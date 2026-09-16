import { describe, it, expect } from "vitest";
import { GanttNode } from "../../../src/graph/nodes/gantt";
import { scheduleTasks } from "../../../src/graph/scheduleCpm";
import { parseDateToSerial } from "../../../src/graph/nodes/dateSerial";
import { isChartValue } from "../../../src/graph/chartValue";
import { isSolError, solError } from "../../../src/graph/errorValue";
import { cubeFromColumns } from "../../../src/graph/frame";

const d = (iso: string) => parseDateToSerial(iso);
const MON = d("2026-01-05");

const plan = cubeFromColumns([
  { name: "Task", cells: ["A", "B"], type: "string" },
  { name: "Duration", cells: [2, 3], type: "number" },
  { name: "Predecessors", cells: [[], ["A"]] },
]);

function scheduled() {
  return scheduleTasks(plan, { start: MON, workingDays: true }).cube;
}

describe("GanttNode.data", () => {
  it("turns a scheduled cube into a chart value of kind gantt", () => {
    const node = new GanttNode();
    const { chart } = node.data({ schedule: [scheduled()] });
    if (isSolError(chart) || chart === null) throw new Error("expected a chart value");
    expect(isChartValue(chart)).toBe(true);
    expect(chart.op).toBe("gantt");
    expect(chart.payload?.kind).toBe("gantt");
    expect(node.cachedChart).toBe(chart);
  });

  it("an unwired or non-table schedule caches null, never an error", () => {
    const node = new GanttNode();
    expect(node.data({}).chart).toBeNull();
    expect(node.data({ schedule: [null] }).chart).toBeNull();
    expect(node.cachedChart).toBeNull();
  });

  it("propagates a whole-graph scheduling error straight through the chart output", () => {
    const node = new GanttNode();
    const err = solError("#VALUE!", "cycle: A → B → A");
    const { chart } = node.data({ schedule: [err] });
    expect(isSolError(chart)).toBe(true);
    expect(node.cachedChart).toBe(err);
  });

  it("reads the Options string: title into the value, view keys into the payload", () => {
    const node = new GanttNode();
    node.stringLiterals.options = "title=Build plan;zoom=month";
    const { chart } = node.data({ schedule: [scheduled()] });
    if (isSolError(chart) || chart === null) throw new Error("expected a chart value");
    expect(chart.title).toBe("Build plan");
    expect(chart.payload?.kind === "gantt" && chart.payload.view.zoom).toBe("month");
  });

  it("the Weekend literal feeds the calendar shading (code 2 = Sun+Mon)", () => {
    const node = new GanttNode();
    node.literals.weekend_code = 2;
    const { chart } = node.data({ schedule: [scheduled()] });
    if (isSolError(chart) || chart === null || chart.payload?.kind !== "gantt") throw new Error("expected a gantt payload");
    expect(chart.payload.weekend).toEqual([0, 1]);
  });

  it("a wired Status date draws the status line; unwired leaves it null", () => {
    const node = new GanttNode();
    const status = d("2026-01-06");
    const wired = node.data({ schedule: [scheduled()], status: [status] }).chart;
    if (isSolError(wired) || wired === null || wired.payload?.kind !== "gantt") throw new Error("expected a gantt payload");
    expect(wired.payload.statusDate).toBe(status);
    const unwired = node.data({ schedule: [scheduled()] }).chart;
    if (isSolError(unwired) || unwired === null || unwired.payload?.kind !== "gantt") throw new Error("expected a gantt payload");
    expect(unwired.payload.statusDate).toBeNull();
  });
});
