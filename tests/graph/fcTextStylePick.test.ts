import { describe, it, expect } from "vitest";
import { FormatControllerNode } from "../../src/graph/rete-nodes";

describe("FormatControllerNode.pickTextStyle", () => {
  it("picking Chip clears a letter case, so no hidden UPPER rides the annotation", () => {
    const fc = new FormatControllerNode();
    fc.pickTextStyle("upper");
    expect(fc.annotation().textCase).toBe("upper");
    fc.pickTextStyle("chip");
    expect(fc.annotation()).toMatchObject({ chip: true, textCase: "none" });
  });

  it("picking a letter case clears Chip and inherit", () => {
    const fc = new FormatControllerNode();
    fc.pickTextStyle("");
    fc.pickTextStyle("chip");
    fc.pickTextStyle("lower");
    expect(fc).toMatchObject({ chip: false, inheritFormat: false, textCase: "lower" });
  });
});
