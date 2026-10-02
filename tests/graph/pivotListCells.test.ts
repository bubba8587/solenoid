// [[D96]] pivotPoolsItems
import { describe, it, expect } from "vitest";
import { PivotNode } from "../../src/graph/rete-nodes";
import { cubeFromColumns, isFrameValue, type FrameValue } from "../../src/graph/frame";
import { isSolError } from "../../src/graph/errorValue";

const book = cubeFromColumns([
  { name: "student", cells: ["Ana", "Ben", "Cy"], type: "string" },
  { name: "letter", cells: ["A", "C", "A"], type: "string" },
  { name: "homework", cells: [[90, 100], [60, 0, 90], [80]], type: "number" },
  { name: "lots", cells: [[[10, 2], [5, 4]], [[1, 1]], null] },
  { name: "notes", cells: [{ __frame: true, columns: [] }, null, null] as never },
]);

function pivot(rows: string, values: string, funcs: Record<string, "sum" | "avg" | "count"> = {}) {
  const p = new PivotNode({ funcs });
  const out = p.data({ frame: [book], rowFields: [[rows]], colFields: [[]], values: [values.split(",")] }) as { frame: FrameValue };
  return { p, out: out.frame };
}

describe("PIVOTBY over a Cube's list and grid cells", () => {
  it("pools a group's list items, so a one-row group reads like AVERAGE(@homework)", () => {
    const { out } = pivot("letter", "homework", { homework: "avg" });
    expect(isFrameValue(out) && out.columns.map((c) => c.values)).toEqual([["A", "C"], [90, 50]]);
  });
  it("counts items, not rows", () => {
    const { out } = pivot("student", "homework", { homework: "count" });
    expect(isFrameValue(out) && out.columns[1].values).toEqual([2, 3, 1]);
  });
  it("pools a grid's cells row-major, and a blank cell adds nothing", () => {
    const { out } = pivot("letter", "lots");
    expect(isFrameValue(out) && out.columns[1].values).toEqual([21, 2]);
  });
  it("marks list columns and leaves a nested-table column out", () => {
    const { p } = pivot("letter", "homework");
    expect(p.sourceColumns.map((c) => [c.name, !!c.items])).toEqual([
      ["student", false], ["letter", false], ["homework", true], ["lots", true],
    ]);
  });
  it("refuses a list column as a row field", () => {
    const { out } = pivot("homework", "lots");
    expect(isSolError(out) && out.code).toBe("#SHAPE!");
  });
});
