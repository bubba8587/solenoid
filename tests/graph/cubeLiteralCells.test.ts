// [[C10]] socketLattice, [[C24]] arraySemantics, [[C44]] dateSerials, [[inline-literal-maps#Wildcard slots]]
import { describe, it, expect } from "vitest";
import { BuildCubeNode } from "../../src/graph/nodes/cube";



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

