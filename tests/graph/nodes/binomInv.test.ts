// [[C120]] linearWork
import { it, expect } from "vitest";
import { resolveExcelFunction } from "../../../src/graph/excelFunctions";

it("BINOM.INV past a million trials answers at once, near the normal approximation", () => {
  const inv = resolveExcelFunction("BINOM.INV")!;
  for (const n of [2e6, 1e8, 1e12]) {
    const t = performance.now();
    const k = inv(n, 0.5, 0.999) as number;
    expect(performance.now() - t).toBeLessThan(500);
    const z = (k - n / 2) / Math.sqrt(n / 4);
    expect(z).toBeGreaterThan(3.08);
    expect(z).toBeLessThan(3.1);
  }
});
