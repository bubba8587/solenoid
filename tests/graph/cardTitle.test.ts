// [[B16]] oneFormulaSurface, [[add-menu#A placed node is titled with what you picked in the Add menu]], [[add-menu#Naming a placed node]]
import { describe, expect, it } from "vitest";
import { FLAT_CATALOG, nodeDisplayName } from "../../src/graph/catalogUtils";

describe("card title", () => {
  const DERIVED = new Set(["conduit", "composite-input", "composite-output"]);
  const leaves = [...FLAT_CATALOG.values()].filter((e) => !e.type.includes("__op-") && !e.type.includes("__excel-") && !DERIVED.has(e.type));
  it("every catalog leaf creates a card named like its row", () => {
    const bad: string[] = [];
    for (const leaf of leaves) {
      let inst: object;
      try { inst = leaf.create() as object; } catch { continue; }
      const title = nodeDisplayName(inst);
      if (title !== leaf.label) bad.push(`${leaf.type}: menu "${leaf.label}" → card "${title}"`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
