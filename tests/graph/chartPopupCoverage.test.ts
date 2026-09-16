import { describe, it, expect } from "vitest";
import { chartValueOps, isChartValue, type ChartValue } from "../../src/graph/chartValue";
import { valueChipFor } from "../../src/graph/components/ValueChip";

// A chart type lacking a pop-out has been a recurring regression: a new figure op
// ships rendering in the card but no way to expand it. This pins the invariant at the
// shared choke point — EVERY chart op is a recognized chart value AND yields the chip
// (valueChipFor → ChartChip → chartPopup.open with the value). The popup then renders
// through the SAME ChartFigure path as the card, so covering the affordance covers the
// figure. `chartValueOps()` derives from the op union (declareOnce), so a newly added
// op automatically joins this sweep and must satisfy it.

const sampleValue = (op: string): ChartValue =>
  ({ __chart: true, op, values: [1, 2, 3], options: {} } as unknown as ChartValue);

describe("chart popup coverage — no op may lack a pop-out", () => {
  it("enumerates every chart op with no gaps or duplicates", () => {
    expect(chartValueOps().length).toBeGreaterThan(0);
    expect(new Set(chartValueOps()).size).toBe(chartValueOps().length);
    for (const op of chartValueOps()) expect(typeof op).toBe("string");
  });

  it("every op is a recognized chart value with a popup chip", () => {
    for (const op of chartValueOps()) {
      const value = sampleValue(op);
      expect(isChartValue(value), `${op}: not recognized as a chart value`).toBe(true);
      const chip = valueChipFor(value, { size: "sm" });
      expect(chip, `${op}: no popup affordance (valueChipFor returned null)`).not.toBeNull();
    }
  });
});
