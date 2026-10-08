// [[C24]] arraySemantics, [[C44]] dateSerials
import { describe, it, expect } from "vitest";
import { frameFromCells, relateFramesToCube, type FrameValue } from "../../../src/graph/frame";
import { isSolError } from "../../../src/graph/errorValue";
import { CubeRollupNode } from "../../../src/graph/nodes/cube";

// Products (assembly) × BOM lines (already enriched with each part's UnitCost and
// its per-line ExtendedCost = Quantity × UnitCost — the shape Join + Get Column +
// Arithmetic + Add Column build in the seed graph) nested under each product via
// Nest Join. Cube Rollup sums ExtendedCost per product — the BOM/nested-costing
// roll-up this node exists for.
function linesFrame(unitCosts: { hinge: number; panel: number }): FrameValue {
  const rows = [
    ["P1", "Hinge", 4, unitCosts.hinge, 4 * unitCosts.hinge],
    ["P1", "Panel", 1, unitCosts.panel, 1 * unitCosts.panel],
    ["P2", "Hinge", 2, unitCosts.hinge, 2 * unitCosts.hinge],
  ];
  return frameFromCells(["ProductID", "Part", "Quantity", "UnitCost", "ExtendedCost"], rows);
}

function productsCube(unitCosts: { hinge: number; panel: number }) {
  const products = frameFromCells(["ProductID", "Name"], [["P1", "Cabinet"], ["P2", "Bracket"]]);
  const cube = relateFramesToCube(products, linesFrame(unitCosts), "ProductID", "Lines");
  if (!cube) throw new Error("relateFramesToCube returned null");
  return cube;
}

function rollup(cube: ReturnType<typeof productsCube>, op: "sum" | "avg" | "count" = "sum") {
  const node = new CubeRollupNode({ agg: op });
  node.stringLiterals = { nested: "Lines", column: "ExtendedCost", as: "TotalCost" };
  return node.data({ cube: [cube] }).frame as FrameValue;
}

describe("CubeRollupNode", () => {
  it("sums the nested ExtendedCost per product", () => {
    const cube = productsCube({ hinge: 2, panel: 10 });
    const out = rollup(cube);
    const totalCol = out.columns.find((c) => c.name === "TotalCost")!;
    const idCol = out.columns.find((c) => c.name === "ProductID")!;
    expect(idCol.values).toEqual(["P1", "P2"]);
    // P1 = 4×2 (Hinge) + 1×10 (Panel) = 18; P2 = 2×2 (Hinge) = 4.
    expect(totalCol.values).toEqual([18, 4]);
    // The flat parent columns (Name) survive untouched alongside the roll-up.
    expect(out.columns.find((c) => c.name === "Name")?.values).toEqual(["Cabinet", "Bracket"]);
  });

  it("rolls a text column's min up to its alphabetical first, typed as text ([[D76]] textMinMax)", () => {
    const node = new CubeRollupNode({ agg: "min" });
    node.stringLiterals = { nested: "Lines", column: "Part", as: "FirstPart" };
    const out = node.data({ cube: [productsCube({ hinge: 2, panel: 10 })] }).frame as FrameValue;
    const col = out.columns.find((c) => c.name === "FirstPart")!;
    expect(col.type).toBe("string");
    expect(col.values).toEqual(["Hinge", "Hinge"]);
  });

  it("respects the chosen aggregate op (count)", () => {
    const cube = productsCube({ hinge: 2, panel: 10 });
    const out = rollup(cube, "count");
    expect(out.columns.find((c) => c.name === "TotalCost")?.values).toEqual([2, 1]);
  });

  it("#REF!s when the nested column name doesn't match", () => {
    const node = new CubeRollupNode();
    node.stringLiterals = { nested: "NotAColumn", column: "ExtendedCost", as: "Total" };
    const out = node.data({ cube: [productsCube({ hinge: 2, panel: 10 })] }).frame;
    expect(isSolError(out)).toBe(true);
  });

  it("#REF!s when the value column is missing from the nested sub-frame", () => {
    const node = new CubeRollupNode();
    node.stringLiterals = { nested: "Lines", column: "NotAColumn", as: "Total" };
    const out = node.data({ cube: [productsCube({ hinge: 2, panel: 10 })] }).frame as FrameValue;
    const totalCol = out.columns.find((c) => c.name === "Total")!;
    expect(totalCol.values.every((v) => isSolError(v))).toBe(true);
  });

  it("passes through null when the cube input is unwired", () => {
    const node = new CubeRollupNode();
    expect(node.data({}).frame).toBeNull();
  });
});
