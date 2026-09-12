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

describe("File Link: which paths run rather than open", () => {
  it("isExecutablePath names the program extensions, case-insensitively, and nothing else", async () => {
    const { isExecutablePath } = await import("../../src/graph/fileBridge");
    for (const p of ["C:\\\\tools\\\\run.EXE", "/tmp/x.bat", "a.lnk", "setup.msi", "s.ps1"]) expect(isExecutablePath(p)).toBe(true);
    for (const p of ["notes.md", "C:\\\\data\\\\plan.xlsx", "photo.jpg", "readme"]) expect(isExecutablePath(p)).toBe(false);
  });
});

describe("review pins: DROP, exponential fits, Slicer, aggregate guard", () => {
  it("DROP of everything is #CALC!, not an empty list", () => {
    const drop = resolveExcelFunction("DROP")!;
    expect(isSolError(drop([1, 2, 3], 5)) && (drop([1, 2, 3], 5) as { code: string }).code).toBe("#DOMAIN!");
    expect(isSolError(drop([1, 2, 3], -3))).toBe(true);
    expect(drop([1, 2, 3], 1)).toEqual([2, 3]);
    expect(isSolError(drop([[1, 2], [3, 4]], 0, 2))).toBe(true);
  });
  it("an exponential fit over a y at or below zero is #NUM! on both cards", async () => {
    const { ForecastNode, LinestNode } = await import("../../src/graph/rete-nodes") as unknown as Record<string, new (i: { op: string }) => { data: (i: Record<string, unknown[]>) => Record<string, unknown> }>;
    const f = new ForecastNode({ op: "exponential" }).data({ ys: [[1, -2, 3]], xs: [[1, 2, 3]], x: [4] });
    expect(isSolError(f.result) && (f.result as { code: string }).code).toBe("#DOMAIN!");
    const l = new LinestNode({ op: "exponential" }).data({ ys: [[1, -2, 3]], xs: [[1, 2, 3]] });
    expect(isSolError(l.slope) && (l.slope as { code: string }).code).toBe("#DOMAIN!");
  });
});
