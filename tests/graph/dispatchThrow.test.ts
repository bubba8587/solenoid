// [[C24]] arraySemantics, [[C120]] linearWork
import { it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";

const ev = (src: string): unknown => compileEvaluator(src)!({});

it("a body that fails answers #VALUE! as a value, with its reason, so IFERROR reads it", () => {
  const r = ev("DEC2BIN(1, 5e9)");
  expect(isSolError(r) && [r.code, r.message]).toEqual(["#VALUE!", "That many characters is more than a text can hold"]);
  expect(ev('IFERROR(DEC2BIN(1, 5e9), "fallback")')).toBe("fallback");
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
