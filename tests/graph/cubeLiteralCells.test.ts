// [[C10]] socketLattice, [[C24]] arraySemantics, [[C44]] dateSerials
import { describe, it, expect } from "vitest";
import { BuildCubeNode } from "../../src/graph/nodes/cube";

// An unwired wildcard row on the cube builders takes a typed cell that is a number OR
// text (autoLiterals); before, the row fell back to the number-only field. A numeric
// literal is still a number cell, byte-identical to the old path.

describe("Build Cube literal cells", () => {
  it("removing a row drops both literal maps", () => {
    const n = new BuildCubeNode();
    const [v0] = n.valueInputKeys();
    n.stringLiterals[v0] = "x";
    n.removeValueInput(v0);
    expect(v0 in n.stringLiterals).toBe(false);
    expect(n.valueInputKeys()).not.toContain(v0);
  });
});

