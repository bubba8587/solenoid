// [[C25]] firstClassUnits, [[C24]]
import { describe, it, expect } from "vitest";
import { parseFormula } from "../../src/graph/excelFormula";
import { dimEval, formulaResultDim, type DimEnv, type DimResult } from "../../src/graph/unitDimExpr";
import { type Dim } from "../../src/graph/dimension";
import { isSolError } from "../../src/graph/errorValue";

const evalExpr = (expr: string, env: DimEnv = {}): DimResult => {
  const ast = parseFormula(expr);
  if (!ast) throw new Error(`unparseable: ${expr}`);
  return dimEval(ast, env);
};
const LENGTH: Dim = { length: 1 };
const TIME: Dim = { time: 1 };
const MASS: Dim = { mass: 1 };

describe("dimensional AST interpretation — operators", () => {
  it("multiply adds dims, divide subtracts", () => {
    expect(evalExpr("a * b", { a: LENGTH, b: TIME })).toEqual({ length: 1, time: 1 });
    expect(evalExpr("a / b", { a: LENGTH, b: TIME })).toEqual({ length: 1, time: -1 });
  });
  it("distance / time reads m/s dimension", () => {
    expect(evalExpr("d / t", { d: LENGTH, t: TIME })).toEqual({ length: 1, time: -1 });
  });
  it("mass * accel yields force dimension", () => {
    expect(evalExpr("m * a", { m: MASS, a: { length: 1, time: -2 } }))
      .toEqual({ mass: 1, length: 1, time: -2 });
  });
  it("plus/minus require matching dims", () => {
    expect(evalExpr("a + b", { a: LENGTH, b: LENGTH })).toEqual(LENGTH);
    const err = evalExpr("a + b", { a: LENGTH, b: TIME });
    expect(isSolError(err) && err.code).toBe("#UNIT!");
  });
  it("power with a constant exponent scales the dim", () => {
    expect(evalExpr("a ^ 2", { a: LENGTH })).toEqual({ length: 2 });
    expect(evalExpr("a ^ 3", { a: LENGTH })).toEqual({ length: 3 });
  });
  it("power with a NON-constant exponent on a dimensioned base is indeterminate", () => {
    expect(evalExpr("a ^ n", { a: LENGTH, n: {} })).toBeNull();
    // but a dimensionless base powered by anything stays dimensionless
    expect(evalExpr("a ^ n", { a: {}, n: {} })).toEqual({});
  });
  it("unary minus and percent keep the dimension", () => {
    expect(evalExpr("-a", { a: LENGTH })).toEqual(LENGTH);
    expect(evalExpr("a%", { a: LENGTH })).toEqual(LENGTH);
  });
  it("comparison yields a dimensionless boolean but errors on mismatch", () => {
    expect(evalExpr("a > b", { a: LENGTH, b: LENGTH })).toEqual({});
    expect(isSolError(evalExpr("a > b", { a: LENGTH, b: TIME }))).toBe(true);
  });
  it("concatenation is unitless", () => {
    expect(evalExpr('a & "x"', { a: LENGTH })).toEqual({});
  });
  it("a bare literal is dimensionless", () => {
    expect(evalExpr("5")).toEqual({});
  });
});

describe("dimensional AST interpretation — functions", () => {
  it("SIN/EXP/LOG demand dimensionless args", () => {
    expect(evalExpr("SIN(x)", { x: {} })).toEqual({});
    expect(evalExpr("SIN(x)", { x: { angle: 1 } })).toEqual({}); // angle ok for trig
    expect(isSolError(evalExpr("SIN(x)", { x: LENGTH }))).toBe(true);
    expect(isSolError(evalExpr("EXP(x)", { x: LENGTH }))).toBe(true);
  });
  it("a lookup carries its return column's unit; the key is compared, not carried", () => {
    expect(evalExpr("XLOOKUP(k, ks, vs)", { k: TIME, ks: TIME, vs: LENGTH })).toEqual(LENGTH);
    expect(evalExpr("VLOOKUP(k, t, 2)", { k: {}, t: MASS })).toEqual(MASS);
    expect(evalExpr("LOOKUP(k, ks, vs)", { k: {}, ks: {}, vs: LENGTH })).toEqual(LENGTH);
    expect(evalExpr("CHOOSEROWS(t, 1)", { t: LENGTH })).toEqual(LENGTH);
  });
  it("SQRT halves the exponents", () => {
    expect(evalExpr("SQRT(a)", { a: { length: 2 } })).toEqual({ length: 1 });
  });
  it("ABS/MIN/MAX preserve the shared dim; mixed → #UNIT!", () => {
    expect(evalExpr("ABS(a)", { a: LENGTH })).toEqual(LENGTH);
    expect(evalExpr("MAX(a, b)", { a: LENGTH, b: LENGTH })).toEqual(LENGTH);
    expect(isSolError(evalExpr("MAX(a, b)", { a: LENGTH, b: TIME }))).toBe(true);
  });
  it("SUM/AVERAGE preserve a shared dim", () => {
    expect(evalExpr("SUM(a, b, c)", { a: LENGTH, b: LENGTH, c: LENGTH })).toEqual(LENGTH);
    expect(evalExpr("AVERAGE(a, b)", { a: MASS, b: MASS })).toEqual(MASS);
  });
  it("PRODUCT multiplies dims", () => {
    expect(evalExpr("PRODUCT(a, b)", { a: LENGTH, b: TIME })).toEqual({ length: 1, time: 1 });
  });
  it("COUNT is always dimensionless", () => {
    expect(evalExpr("COUNT(a, b)", { a: LENGTH, b: TIME })).toEqual({});
  });
  it("IF agreeing branches pass the dim; disagreeing → indeterminate", () => {
    expect(evalExpr("IF(c, a, b)", { c: {}, a: LENGTH, b: LENGTH })).toEqual(LENGTH);
    expect(evalExpr("IF(c, a, b)", { c: {}, a: LENGTH, b: TIME })).toBeNull();
  });
  it("a bound LAMBDA's call is indeterminate: its body is not visible", () => {
    expect(evalExpr("MYSTERYFN(a)", { a: LENGTH })).toBeNull();
  });
  it("any other function reads plain numbers: a unit going in is #UNIT!", () => {
    expect(isSolError(evalExpr("FACT(a)", { a: LENGTH }))).toBe(true);
    expect(evalExpr("FACT(3)")).toEqual({});
    expect(evalExpr("a + RAND()", { a: LENGTH })).toEqual(LENGTH);
    expect(evalExpr("FACT(a ^ n)", { a: LENGTH, n: {} })).toBeNull();
  });
  it("the declared tables: spreads, squares, picks, criteria and branches", () => {
    expect(evalExpr("STDEV(a)", { a: LENGTH })).toEqual(LENGTH);
    expect(evalExpr("VAR(a)", { a: LENGTH })).toEqual({ length: 2 });
    expect(evalExpr("LARGE(a, 2)", { a: LENGTH })).toEqual(LENGTH);
    expect(isSolError(evalExpr("LARGE(a, b)", { a: LENGTH, b: LENGTH }))).toBe(true);
    expect(evalExpr('SUMIFS(a, b, ">1")', { a: MASS, b: LENGTH })).toEqual(MASS);
    expect(evalExpr("IFERROR(a, b)", { a: LENGTH, b: LENGTH })).toEqual(LENGTH);
    expect(evalExpr("CHOOSE(i, a, b)", { i: {}, a: LENGTH, b: TIME })).toBeNull();
    expect(evalExpr('TEXT(a, "0.0")', { a: LENGTH })).toEqual({});
  });
});

describe("formulaResultDim folds conflicts to null", () => {
  it("returns a dim when determinable", () => {
    const ast = parseFormula("d / t")!;
    expect(formulaResultDim(ast, { d: { length: 1 }, t: { time: 1 } }))
      .toEqual({ length: 1, time: -1 });
  });
  it("returns null on a #UNIT! conflict", () => {
    const ast = parseFormula("a + b")!;
    expect(formulaResultDim(ast, { a: { length: 1 }, b: { time: 1 } })).toBeNull();
  });
});
