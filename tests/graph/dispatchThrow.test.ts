// [[C24]] arraySemantics, [[C120]] linearWork, [[formula-language#The dispatch ladder]], [[formula-language#Matrices and dynamic arrays]]
import { it, expect } from "vitest";
import { AT_ONCE_MS } from "./timing";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";

const ev = (src: string): unknown => compileEvaluator(src)!({});

it("a body that fails answers #VALUE! as a value, with its reason, so IFERROR reads it", () => {
  const r = ev("RANK(1, 5)");
  expect(isSolError(r) && [r.code, r.message]).toEqual(["#VALUE!", "RANK's ref takes a list"]);
  expect(ev('IFERROR(RANK(1, 5), "fallback")')).toBe("fallback");
  expect(ev("ISERROR(ROMAN(1e12))")).toBe(true);
});

it("WRAPROWS, NTILE and GAUSSIANSMOOTH refuse a count that would loop or allocate past their limits", () => {
  const t = performance.now();
  for (const [src, code] of [["WRAPROWS(SEQUENCE(3), 1e12)", "#OVERFLOW!"], ["WRAPCOLS(SEQUENCE(3), 1e12)", "#OVERFLOW!"], ["NTILE(SEQUENCE(5), 1e12)", "#DOMAIN!"], ["GAUSSIANSMOOTH(SEQUENCE(5), 1e12)", "#DOMAIN!"]] as const) {
    const r = ev(src);
    expect(isSolError(r) && r.code, src).toBe(code);
  }
  expect(performance.now() - t).toBeLessThan(AT_ONCE_MS);
});
