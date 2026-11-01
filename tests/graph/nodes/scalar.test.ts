// [[B16]] oneFormulaSurface, [[C24]]
import { describe, it, expect } from "vitest";
import {
  MathFXNode,
  MRoundNode,
  CombinatoricsNode,
  BesselNode,
  type MathFnOp,
} from "../../../src/graph/nodes/scalar";
import { nodeDisplayName } from "../../../src/graph/catalogUtils";


describe("MathFn — rounding family", () => {
  const fn = (op: MathFnOp, x: number) =>
    new MathFXNode({ op }).data({ in: [x] }).result;

  it("INT floors toward -inf, TRUNC toward zero", () => {
    expect(fn("int", -3.7)).toBe(-4);
    expect(fn("trunc", -3.7)).toBe(-3);
  });
  it("EVEN / ODD round away from zero", () => {
    expect(fn("even", 3)).toBe(4);
    expect(fn("even", -3)).toBe(-4);
    expect(fn("odd", 2)).toBe(3);
    expect(fn("odd", -2)).toBe(-3);
  });
});

describe("MathFn — selected functions", () => {
  const fn = (op: MathFnOp, x: number) =>
    new MathFXNode({ op }).data({ in: [x] }).result as number;

  it("GAMMA(5) = 4! = 24", () => {
    expect(fn("gamma", 5)).toBeCloseTo(24, 5);
  });
  it("GAMMA of a negative non-integer is the formula's; a pole is #DOMAIN!", () => {
    expect(fn("gamma", -0.5)).toBeCloseTo(-3.5449077, 6);
    expect(fn("gamma", 0)).toMatchObject({ code: "#DOMAIN!" });
    expect(fn("gamma", -2)).toMatchObject({ code: "#DOMAIN!" });
  });
  it("SQRTPI(1) = sqrt(pi)", () => {
    expect(fn("sqrtpi", 1)).toBeCloseTo(Math.sqrt(Math.PI), 9);
  });
  it("ERF(0) = 0, ERF(large) → 1", () => {
    expect(fn("erf", 0)).toBeCloseTo(0, 6);
    expect(fn("erf", 3)).toBeCloseTo(1, 4);
  });
});


describe("MROUND", () => {
  it("op up = CEILING toward +∞ (multiple defaults to 1 → next integer)", () => {
    expect(new MRoundNode({ op: "up" }).data({ value: [10], multiple: [3] }).result).toBe(12);
    expect(new MRoundNode({ op: "up" }).data({ value: [2.1], multiple: [1] }).result).toBe(3);
    expect(new MRoundNode({ op: "up" }).data({ value: [-2.1], multiple: [1] }).result).toBe(-2); // toward +∞
    expect(nodeDisplayName(new MRoundNode({ op: "up" }))).toBe("CEILING");
  });
  it("op down = FLOOR toward −∞", () => {
    expect(new MRoundNode({ op: "down" }).data({ value: [10], multiple: [3] }).result).toBe(9);
    expect(new MRoundNode({ op: "down" }).data({ value: [2.9], multiple: [1] }).result).toBe(2);
    expect(new MRoundNode({ op: "down" }).data({ value: [-2.1], multiple: [1] }).result).toBe(-3); // toward −∞
    expect(nodeDisplayName(new MRoundNode({ op: "down" }))).toBe("FLOOR");
  });
});

describe("Combinatorics — Excel truncates non-integer args", () => {
  const run = (op: "fact" | "combin" | "permut" | "combina" | "permutationa" | "factdouble", n: number, k?: number) =>
    new CombinatoricsNode({ op }).data({ n: [n], k: k === undefined ? undefined : [k] }).result;
  it("FACT/COMBIN/PERMUT truncate a fractional argument, matching =FACT(2.9)=2", () => {
    expect(run("fact", 2.9)).toBe(2);        // FACT(2), not FACT(3)=6
    expect(run("combin", 5.9, 2)).toBe(10);  // COMBIN(5,2), not COMBIN(6,2)=15
    expect(run("permut", 5.6, 2)).toBe(20);  // P(5,2), not P(6,2)=30
  });
  it("still computes the whole-number cases correctly", () => {
    expect(run("fact", 5)).toBe(120);
    expect(run("combin", 6, 2)).toBe(15);
  });
});

describe("Combinatorics and Bessel cards compute through the formula's kernels ([[C17]] shareImpl)", () => {
  const comb = (op: "fact" | "combin" | "permut" | "combina" | "factdouble", n: number, k?: number) =>
    new CombinatoricsNode({ op }).data({ n: [n], k: k === undefined ? undefined : [k] }).result;
  const bessel = (op: "besselj" | "bessely" | "besseli" | "besselk", x: number, n: number) =>
    new BesselNode({ op }).data({ x: [x], n: [n] }).result;
  it("COMBIN past 170, COMBINA with k above n, FACTDOUBLE(-1)", () => {
    expect(comb("combin", 171, 2)).toBe(14535);
    expect(comb("combin", 30, 15)).toBe(155117520);
    expect(comb("combina", 2, 5)).toBe(6);
    expect(comb("factdouble", -1)).toBe(1);
    expect((comb("factdouble", -2) as { code?: string }).code).toBe("#DOMAIN!");
    expect((comb("fact", 171) as { code?: string }).code).toBe("#OVERFLOW!");
  });
  it("Bessel K and Y, and I of a negative x, are Excel's", () => {
    expect(bessel("besselk", 2.5, 1)).toBeCloseTo(0.0738908, 6);
    expect(bessel("besseli", -1, 1)).toBeCloseTo(-0.5651591, 6);
    expect(bessel("bessely", 2.5, 1)).toBeCloseTo(0.1459181, 6);
    expect(bessel("besselj", 1.9, 2)).toBeCloseTo(0.3299257, 6);
  });
  it("a fractional order truncates and a negative one is blank, as the formula", () => {
    expect(bessel("besselj", 1.9, 2.7)).toBe(bessel("besselj", 1.9, 2));
    expect(bessel("besselj", 1.9, -1)).toBeNull();
  });
});



