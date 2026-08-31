import { describe, it, expect } from "vitest";
import { errorTip } from "../../../src/graph/components/ErrorChip";
import { solError } from "../../../src/graph/errorValue";

describe("errorTip (provenance Tier 1)", () => {
  it("has no '…caused by' line when there's no origin", () => {
    const e = solError("#DIV/0!", "Division by zero");
    expect(errorTip(e)).not.toMatch(/caused by/);
  });

  it("appends a '…caused by [nodeName]' line when an origin is set", () => {
    const e = { ...solError("#DIV/0!", "Division by zero"), origin: { nodeId: "n1", nodeName: "Arithmetic" } };
    const tip = errorTip(e);
    expect(tip).toMatch(/caused by Arithmetic/);
    // The structural message + explanation still lead the tooltip.
    expect(tip.indexOf("Division by zero")).toBeLessThan(tip.indexOf("caused by"));
  });
});
