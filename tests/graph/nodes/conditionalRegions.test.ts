// [[C100]] chartIsAValue
import { describe, it, expect } from "vitest";
import { ChartNode, ConditionalRegionsNode } from "../../../src/graph/nodes/visual";
import type { ChartValue } from "../../../src/graph/chartValue";
import { isSolError, type SolError } from "../../../src/graph/errorValue";
import type { FrameValue } from "../../../src/graph/frame";
import { extractInit } from "../../../src/graph/nodeInit";
import { coreRegionKeys } from "../../../src/graph/engineWasm";

const frame = (x: (number | null)[], y: (number | null)[]): FrameValue => ({ __frame: true, columns: [
  { name: "x", type: "number", values: x },
  { name: "y", type: "number", values: y },
] });
// y = x², a vertical line at x = 2 and a horizontal one at y = 5.
const curve = frame([0, 1, 2, 3], [0, 1, 4, 9]);
const refs = frame([2, null], [null, 5]);
const chartOf = (op: "xyline" | "scatter" | "column", values: FrameValue = curve) =>
  new ChartNode({ op }).data({ values: [values], references: [refs] }).chart as ChartValue;

const run = (n: ConditionalRegionsNode, chart: unknown, points: unknown) =>
  n.data({ chart: [chart], points: [points] }).result;
/** The `in` column of the answer, or the answer itself when it isn't a frame. */
const inCol = (out: unknown) => ((out as FrameValue | null)?.columns ? (out as FrameValue).columns[2].values : out);

describe("Conditional Regions node", () => {
  it("answers each point its region's mark, blank where the region is unmarked", () => {
    // Left of x = 2, below y = 5, above the curve is TRUE; right of x = 2 and below the curve is FALSE.
    const n = new ConditionalRegionsNode({ regionMarks: { "0.0.0": true, "1.0.1": false } });
    const out = run(n, chartOf("xyline"), frame([0.5, 2.5, 1, 1, null], [2, 1, 6, 0.5, 3])) as FrameValue;
    expect(out.columns.map((c) => [c.name, c.type])).toEqual([["x", "number"], ["y", "number"], ["in", "logical"]]);
    expect(out.columns.map((c) => c.values)).toEqual([[0.5, 2.5, 1, 1, null], [2, 1, 6, 0.5, 3], [true, false, null, null, null]]);
    expect(n.cachedPoints).toHaveLength(4);
  });

  it("answers whether a point is in the areas marked TRUE, however many there are", () => {
    // Every area above the curve is TRUE: left and right of x = 2, below and above y = 5.
    const n = new ConditionalRegionsNode({ regionMarks: { "0.0.0": true, "0.1.0": true, "1.0.0": true, "1.1.0": true } });
    const out = run(n, chartOf("xyline"), frame([0.5, 1, 2.1, 2.9, 1, 2.5], [3, 8, 4.9, 9.5, 0.5, 2]));
    expect(inCol(out)).toEqual([true, true, true, true, null, null]);
  });

  it("names the in column apart from a points column already called in", () => {
    const pts: FrameValue = { __frame: true, columns: [{ name: "in", type: "number", values: [1] }, { name: "y", type: "number", values: [5] }] };
    const out = run(new ConditionalRegionsNode(), chartOf("xyline"), pts) as FrameValue;
    expect(new Set(out.columns.map((c) => c.name)).size).toBe(3);
  });

  it("joins a scatter's points in order of x, so they cut the plane as a line does", () => {
    const shuffled = frame([3, 0, 2, 1], [9, 0, 4, 1]);
    const n = new ConditionalRegionsNode({ regionMarks: { "0.0.1": true } });
    expect(inCol(run(n, chartOf("scatter", shuffled), frame([1.5, 1.5], [1, 3])))).toEqual([true, null]);
    expect(n.cachedCuts!.curves[0]).toEqual([0, 0, 1, 1, 1, 1, 2, 4, 2, 4, 3, 9]);
  });

  it("counts a point on a line under ≤ and leaves it blank under <", () => {
    const marks = { "0.0.0": true, "1.0.0": false };
    const onLine = frame([2], [4.5]);
    expect(inCol(run(new ConditionalRegionsNode({ regionMarks: marks }), chartOf("xyline"), onLine))).toEqual([true]);
    expect(inCol(run(new ConditionalRegionsNode({ regionMarks: marks, mode: "strict" }), chartOf("xyline"), onLine))).toEqual([null]);
  });

  it("in Text mode answers each point its region's label", () => {
    const n = new ConditionalRegionsNode({ op: "text", regionLabels: { "0.0.0": 1, "1.0.1": 0, "0.1.0": 7 } });
    expect(n.inputs.labels).toBeTruthy();
    const out = n.data({ chart: [chartOf("xyline")], points: [frame([0.5, 2.5, 1, 1], [2, 1, 6, 0.5])], labels: [["low", "high"]] }).result as FrameValue;
    expect(out.columns.map((c) => [c.name, c.type])).toEqual([["x", "number"], ["y", "number"], ["label", "string"]]);
    // A mark past the end of the list is no label.
    expect(out.columns[2].values).toEqual(["high", "low", null, null]);
    expect(n.cachedLabels).toEqual(["low", "high"]);
  });

  it("gives a point on a line between two labels the one listed first", () => {
    const n = new ConditionalRegionsNode({ op: "text", regionLabels: { "0.0.0": 1, "1.0.0": 0 } });
    expect(inCol(n.data({ chart: [chartOf("xyline")], points: [frame([2], [4.5])], labels: [["a", "b"]] }).result)).toEqual(["a"]);
  });

  it("keeps each mode's marks apart, and drops the Labels input in Bool mode", () => {
    const n = new ConditionalRegionsNode({ regionMarks: { "0.0.0": true } });
    expect(n.inputs.labels).toBeUndefined();
    n.setOp("text");
    expect(n.inputs.labels).toBeTruthy();
    expect(inCol(n.data({ chart: [chartOf("xyline")], points: [frame([0.5], [2])], labels: [["a"]] }).result)).toEqual([null]);
    n.setOp("bool");
    expect(n.inputs.labels).toBeUndefined();
    expect(inCol(run(n, chartOf("xyline"), frame([0.5], [2])))).toEqual([true]);
  });

  it("refuses a chart without an x/y plane", () => {
    const out = run(new ConditionalRegionsNode(), chartOf("column"), frame([1], [1])) as SolError;
    expect(isSolError(out) && out.code).toBe("#TYPE!");
  });

  it("is blank until both a chart and points arrive", () => {
    const n = new ConditionalRegionsNode();
    expect(n.data({}).result).toBeNull();
    expect(run(n, chartOf("xyline"), null)).toBeNull();
    expect(n.cachedCuts).not.toBeNull();
  });

  it("finds the card's click in the same region as the body", () => {
    const n = new ConditionalRegionsNode();
    run(n, chartOf("xyline"), frame([1], [1]));
    expect(coreRegionKeys(JSON.stringify(n.cachedCuts), [0.5, 2.5], [2, 1])).toEqual(["0.0.0", "1.0.1"]);
  });

  it("saves its marks and modes", () => {
    const init = extractInit(new ConditionalRegionsNode({ mode: "strict", op: "text", regionMarks: { "0.0.1": false }, regionLabels: { "0.0.0": 2 } }));
    expect(init).toMatchObject({ mode: "strict", op: "text", regionMarks: { "0.0.1": false }, regionLabels: { "0.0.0": 2 } });
    const back = new ConditionalRegionsNode(init as ConstructorParameters<typeof ConditionalRegionsNode>[0]);
    expect([back.mode, back.op, back.regionMarks, back.regionLabels]).toEqual(["strict", "text", { "0.0.1": false }, { "0.0.0": 2 }]);
  });
});
