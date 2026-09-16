import { describe, it, expect } from "vitest";
import { sanitizeChartLabel } from "../../src/graph/components/chartRender";

describe("sanitizeChartLabel", () => {
  it("passes a short, clean name through unchanged", () => {
    expect(sanitizeChartLabel("Housing")).toBe("Housing");
  });

  it("strips control characters and collapses whitespace", () => {
    expect(sanitizeChartLabel("Car\n\tLoan")).toBe("Car Loan");
    expect(sanitizeChartLabel("  spaced   out  ")).toBe("spaced out");
  });

  it("caps length with an ellipsis", () => {
    const out = sanitizeChartLabel("Supercalifragilistic category name", 16);
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toBe("Supercalifragil…");
  });

  it("keeps a name at exactly the cap; caps only when longer", () => {
    expect(sanitizeChartLabel("sixteencharacter", 16)).toBe("sixteencharacter");    // 16 == cap, kept
    expect(sanitizeChartLabel("seventeencharacte", 16)).toBe("seventeencharac…");  // 17 -> capped
  });
});
