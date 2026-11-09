// [[C25]] firstClassUnits
import { describe, it, expect } from "vitest";
import { CONVERT_UNIT_DEFS } from "../../src/graph/nodes/convertUnits";
import { cellUnitAnnotation } from "../../src/graph/unitColumn";
import { unitById } from "../../src/graph/formatAnnotationStore";

describe("every Convert unit has a label after a number", () => {
  it("an FC unit's own label, or the unit's symbol", () => {
    const labelOf = (id: string) => { const a = cellUnitAnnotation(id); return (a.unit === "custom" ? a.customUnit ?? "" : unitById(a.unit).label).trim(); };
    const bare = Object.keys(CONVERT_UNIT_DEFS).filter((id) => !labelOf(id));
    expect(bare).toEqual([]);
    expect(cellUnitAnnotation("tbs")).toEqual({ unit: "custom", customUnit: " tbsp" });
    expect(cellUnitAnnotation("cm2")).toEqual({ unit: "custom", customUnit: " cm²" });
  });
});
