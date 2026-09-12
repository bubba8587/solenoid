import { describe, it, expect } from "vitest";
import { bondPrice, bondYield } from "../../src/graph/nodes/financeOps";
import { sanitizeChartLabel } from "../../src/graph/components/chartRender";
import { resolveExcelFunction } from "../../src/graph/excelFunctions";
import { isSolError } from "../../src/graph/errorValue";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

describe("review pins", () => {
  it("PRICE with one coupon period left uses Excel's simple-interest form; YIELD inverts it", () => {
    // =PRICE(DATE(2024,1,15),DATE(2024,6,15),0.06,0.07,100,2,0) = 99.58097
    const p = bondPrice(d(2024, 1, 15), d(2024, 6, 15), 0.06, 0.07, 100, 2);
    expect(p).toBeCloseTo(99.58097, 4);
    expect(bondYield(d(2024, 1, 15), d(2024, 6, 15), 0.06, p, 100, 2)).toBeCloseTo(0.07, 6);
  });

  it("a chart label cap counts code points, never splitting a surrogate pair", () => {
    const s = sanitizeChartLabel("😀".repeat(10), 8);
    expect(s).toBe("😀😀😀😀😀😀😀…");
    expect(s.includes("\ud83d…")).toBe(false);
  });

  it("XLOOKUP refuses a return list shorter than the lookup list, like a grid", () => {
    const r = resolveExcelFunction("XLOOKUP")!(2, [1, 2], ["a"]);
    expect(isSolError(r) && r.code).toBe("#VALUE!");
  });
});
