// [[C24]] arraySemantics, [[C120]] linearWork
import { it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";

const ev = (src: string): unknown => compileEvaluator(src)!({});

it("a function that fails inside JavaScript answers #VALUE! as a value, so IFERROR reads it", () => {
  const r = ev("TRIMMEAN(5, 0.2)");
  expect(isSolError(r) && [r.code, r.message]).toEqual(["#VALUE!", "TRIMMEAN can't compute with these arguments"]);
  expect(ev('IFERROR(TRIMMEAN(5, 0.2), "fallback")')).toBe("fallback");
  expect(ev("ISERROR(ROMAN(1e12))")).toBe(true);
});

it("WRAPROWS, NTILE and GAUSSIANSMOOTH refuse a count that would loop or allocate past their limits", () => {
  const t = performance.now();
  for (const [src, code] of [["WRAPROWS(SEQUENCE(3), 1e12)", "#OVERFLOW!"], ["WRAPCOLS(SEQUENCE(3), 1e12)", "#OVERFLOW!"], ["NTILE(SEQUENCE(5), 1e12)", "#DOMAIN!"], ["GAUSSIANSMOOTH(SEQUENCE(5), 1e12)", "#DOMAIN!"]] as const) {
    const r = ev(src);
    expect(isSolError(r) && r.code, src).toBe(code);
  }
  expect(performance.now() - t).toBeLessThan(1000);
});
