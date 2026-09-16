import { describe, it, expect } from "vitest";
import { BuildCubeNode, CubeColumnsNode } from "../../src/graph/nodes/cube";
import { cubeColumnFromValue } from "../../src/graph/frame";

// An unwired wildcard row on the cube builders takes a typed cell that is a number OR
// text (autoLiterals); before, the row fell back to the number-only field. A numeric
// literal is still a number cell, byte-identical to the old path.

describe("Build Cube literal cells", () => {
  it("opts into auto literals; a number literal is a number cell, a text literal a text cell", () => {
    const n = new BuildCubeNode();
    expect(n.autoLiterals).toBe(true);
    const [v0, v1, v2] = n.valueInputKeys();
    n.literals[v0] = 12;
    n.stringLiterals[v1] = "north";
    const out = n.data({}) as { cube: { columns: { cells: unknown[] }[] } | null };
    expect(out.cube?.columns[0].cells).toEqual([12, "north", null]);
    void v2;
  });
  it("removing a row drops both literal maps", () => {
    const n = new BuildCubeNode();
    const [v0] = n.valueInputKeys();
    n.stringLiterals[v0] = "x";
    n.removeValueInput(v0);
    expect(v0 in n.stringLiterals).toBe(false);
    expect(n.valueInputKeys()).not.toContain(v0);
  });
});

describe("Cube Columns literal cells", () => {
  it("a text literal on an unwired column row becomes that column's one cell", () => {
    const n = new CubeColumnsNode();
    expect(n.autoLiterals).toBe(true);
    const key = n.valueInputKeys()[0];
    n.stringLiterals[key] = "label";
    const expected = cubeColumnFromValue("label");
    const out = n.data({ names: ["Tag"] } as never) as { cube: { columns: { cells: unknown[] }[] } | null };
    expect(out.cube?.columns[0].cells).toEqual(expected);
  });
});
