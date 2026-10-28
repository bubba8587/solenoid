// [[B11]] maximalMerge
import { describe, it, expect } from "vitest";
import { DashboardNode } from "../../../src/graph/nodes/dashboard";
import { solError } from "../../../src/graph/errorValue";
import { extractInit } from "../../../src/graph/nodeInit";
import { readTextForm, writeTextForm } from "../../../src/graph/textForm";
import type { SavedGraph } from "../../../src/graph/persistence";
import { throughBoundary } from "../boundaryKit";

describe("DashboardNode: one input per layout box", () => {
  it("mints a trueany input per name, in reading order; a repeated name is one box and one input", () => {
    const n = new DashboardNode({ layout: "Revenue | Costs\nChart*2" });
    expect(n.refKeys()).toEqual(["Revenue", "Costs", "Chart"]);
    expect(Object.keys(n.inputs)).toEqual(["Revenue", "Costs", "Chart"]);
    expect(n.inputs.Revenue?.socket.name).toBe("trueany");
    const chart = n.placements().find((p) => p.name === "Chart")!;
    expect([chart.row, chart.col, chart.colSpan]).toEqual([2, 1, 2]);
    const merged = new DashboardNode({ layout: "Map | Total\nMap | Count" });
    expect(merged.refKeys()).toEqual(["Map", "Total", "Count"]);
    expect(merged.placements()[0].rowSpan).toBe(2);
  });

  it("an empty layout has no boxes and no inputs", () => {
    const n = new DashboardNode();
    expect(n.refKeys()).toEqual([]);
    expect(Object.keys(n.inputs)).toEqual([]);
  });

  it("setLayout adds the new names and removes the departed ones", async () => {
    const n = new DashboardNode({ layout: "A | B" });
    n.data({ A: [1], B: [2] });
    await n.setLayout("B | C");
    expect(Object.keys(n.inputs).sort()).toEqual(["B", "C"]);
    expect(n.refValue("A")).toBeUndefined();
  });

  it("data() records each wired value; an unwired box reads undefined, a wired blank null", () => {
    const n = new DashboardNode({ layout: "Total | Blank | Open" });
    n.data({ Total: [42], Blank: [null] });
    expect(n.refValue("Total")).toBe(42);
    expect(n.refValue("Blank")).toBeNull();
    expect(n.refValue("Open")).toBeUndefined();
  });

  it("an error reaches the box as a value, so the box can show it", () => {
    const n = throughBoundary(new DashboardNode({ layout: "Ratio" }));
    const e = solError("#DIV/0!", "x");
    n.data({ Ratio: [e] });
    expect(n.refValue("Ratio")).toEqual(e);
  });

  it("the layout saves, and a cable into a name with a space survives the text form", () => {
    const n = new DashboardNode({ layout: "Unit Price | Sales" });
    const g: SavedGraph = {
      v: 1,
      nodes: [
        { id: "a", type: "ValueInputNode", init: { label: "Price" } },
        { id: "d", type: "DashboardNode", init: extractInit(n) },
      ],
      connections: [{ source: "a", sourceOutput: "value", target: "d", targetInput: "Unit Price" }],
    } as unknown as SavedGraph;
    const back = readTextForm(writeTextForm(g));
    const d = back.nodes.find((x) => x.type === "DashboardNode")!;
    expect(d.init?.layout).toBe("Unit Price | Sales");
    expect(back.connections.map((c) => c.targetInput)).toEqual(["Unit Price"]);
    expect(Object.keys(new DashboardNode(d.init as never).inputs)).toEqual(["Unit Price", "Sales"]);
  });
});
