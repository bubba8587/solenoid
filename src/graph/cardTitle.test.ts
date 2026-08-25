import { describe, expect, it } from "vitest";
import { FLAT_CATALOG, nodeDisplayName } from "./catalogUtils";

// NAME-3: the Add-menu row and the card it creates share one name, and an op family's
// card is named by its op — a placed ABS never reads "Math", a placed XIRR never "IRR".
// A user-typed label still wins (nodeDisplayName prefers it).
describe("card title", () => {
  // A Conduit is serial-numbered; the composite boundary cards read "Input"/"Output"
  // inside the composite they belong to.
  const DERIVED = new Set(["conduit", "composite-input", "composite-output"]);
  const leaves = [...FLAT_CATALOG.values()].filter((e) => !e.type.includes("__op-") && !DERIVED.has(e.type));
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
