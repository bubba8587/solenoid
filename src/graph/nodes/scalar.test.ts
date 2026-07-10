import { describe, it, expect } from "vitest";
import {
  ArithmeticNode,
  MathFnNode,
  RoundNNode,
  MRoundNode,
  GcdNode,
  CombinatoricsNode,
  TwoInputMathNode,
  type MathFnOp,
} from "./scalar";
import { isSolError } from "../errorValue";

describe("Arithmetic", () => {
  it("does the four ops", () => {
    expect(new ArithmeticNode({ op: "add" }).data({ a: [2], b: [3] }).result).toBe(5);
    expect(new ArithmeticNode({ op: "sub" }).data({ a: [5], b: [3] }).result).toBe(2);
    expect(new ArithmeticNode({ op: "mul" }).data({ a: [4], b: [3] }).result).toBe(12);
    expect(new ArithmeticNode({ op: "div" }).data({ a: [10], b: [4] }).result).toBe(2.5);
  });
  it("division and modulo by zero produce #DIV/0!", () => {
    const div = new ArithmeticNode({ op: "div" }).data({ a: [10], b: [0] }).result;
    const mod = new ArithmeticNode({ op: "mod" }).data({ a: [10], b: [0] }).result;
    expect(isSolError(div) && div.code === "#DIV/0!").toBe(true);
    expect(isSolError(mod) && mod.code === "#DIV/0!").toBe(true);
  });
  it("QUOTIENT truncates toward zero", () => {
    expect(new ArithmeticNode({ op: "quotient" }).data({ a: [7], b: [2] }).result).toBe(3);
    expect(new ArithmeticNode({ op: "quotient" }).data({ a: [-7], b: [2] }).result).toBe(-3);
  });
  it("MOD takes its sign from the divisor (Excel), not the dividend (JS %)", () => {
    expect(new ArithmeticNode({ op: "mod" }).data({ a: [10], b: [3] }).result).toBe(1);
    expect(new ArithmeticNode({ op: "mod" }).data({ a: [-3], b: [2] }).result).toBe(1);
    expect(new ArithmeticNode({ op: "mod" }).data({ a: [3], b: [-2] }).result).toBe(-1);
    expect(new ArithmeticNode({ op: "mod" }).data({ a: [-10], b: [3] }).result).toBe(2);
  });
  it("broadcasts a scalar over a list", () => {
    expect(new ArithmeticNode({ op: "add" }).data({ a: [[1, 2, 3]], b: [10] }).result).toEqual([11, 12, 13]);
  });
  it("a per-element ÷0 in a list carries a per-cell #DIV/0! (matches the scalar/Map case)", () => {
    const r = new ArithmeticNode({ op: "div" }).data({ a: [[10, 20, 30]], b: [[2, 0, 5]] }).result as Array<number | { code: string }>;
    expect(Array.isArray(r)).toBe(true);
    expect(r[0]).toBe(5);
    expect(isSolError(r[1]) && r[1].code === "#DIV/0!").toBe(true);
    expect(r[2]).toBe(6);
    // MOD / QUOTIENT divide too — same per-cell tagging.
    const m = new ArithmeticNode({ op: "mod" }).data({ a: [[10, 20]], b: [[3, 0]] }).result as Array<number | { code: string }>;
    expect(m[0]).toBe(1);
    expect(isSolError(m[1]) && m[1].code === "#DIV/0!").toBe(true);
  });
});

describe("MathFn — rounding family", () => {
  const fn = (op: MathFnOp, x: number) =>
    new MathFnNode({ op }).data({ in: [x] }).result;

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
  it("ROUND rounds halves away from zero (Excel, not JS)", () => {
    expect(fn("round", 2.5)).toBe(3);
    expect(fn("round", -2.5)).toBe(-3);
    expect(fn("round", -0.5)).toBe(-1);
  });
});

describe("MathFn — selected functions", () => {
  const fn = (op: MathFnOp, x: number) =>
    new MathFnNode({ op }).data({ in: [x] }).result as number;

  it("GAMMA(5) = 4! = 24", () => {
    expect(fn("gamma", 5)).toBeCloseTo(24, 5);
  });
  it("SQRTPI(1) = sqrt(pi)", () => {
    expect(fn("sqrtpi", 1)).toBeCloseTo(Math.sqrt(Math.PI), 9);
  });
  it("PHI(0) is the normal-pdf peak", () => {
    expect(fn("phi", 0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 9);
  });
  it("ERF(0) = 0, ERF(large) → 1", () => {
    expect(fn("erf", 0)).toBeCloseTo(0, 6);
    expect(fn("erf", 3)).toBeCloseTo(1, 4);
  });
  it("domain guards produce #DOMAIN!", () => {
    const sqrt = new MathFnNode({ op: "sqrt" }).data({ in: [-1] }).result;
    const log = new MathFnNode({ op: "log" }).data({ in: [0] }).result;
    expect(isSolError(sqrt) && sqrt.code === "#DOMAIN!").toBe(true);
    expect(isSolError(log) && log.code === "#DOMAIN!").toBe(true);
  });
  it("a domain miss in a LIST carries a per-cell #DOMAIN! (matches the scalar case)", () => {
    const r = new MathFnNode({ op: "sqrt" }).data({ in: [[4, -1, 9]] }).result as Array<number | { code: string }>;
    expect(r[0]).toBe(2);
    expect(isSolError(r[1]) && r[1].code === "#DOMAIN!").toBe(true);
    expect(r[2]).toBe(3);
  });
});

describe("ROUND / ROUNDUP / ROUNDDOWN (RoundN)", () => {
  it("ROUND with digits, halves away from zero", () => {
    expect(new RoundNNode({ op: "round" }).data({ value: [3.14159], digits: [2] }).result).toBeCloseTo(3.14, 9);
    expect(new RoundNNode({ op: "round" }).data({ value: [2.5], digits: [0] }).result).toBe(3);
    expect(new RoundNNode({ op: "round" }).data({ value: [-2.5], digits: [0] }).result).toBe(-3);
    expect(new RoundNNode({ op: "round" }).data({ value: [-1.5], digits: [0] }).result).toBe(-2);
  });
  it("ROUNDUP rounds away from zero", () => {
    expect(new RoundNNode({ op: "roundup" }).data({ value: [3.14159], digits: [2] }).result).toBeCloseTo(3.15, 9);
    expect(new RoundNNode({ op: "roundup" }).data({ value: [-3.14159], digits: [2] }).result).toBeCloseTo(-3.15, 9);
  });
  it("ROUNDDOWN truncates toward zero", () => {
    expect(new RoundNNode({ op: "rounddown" }).data({ value: [3.789], digits: [1] }).result).toBeCloseTo(3.7, 9);
    expect(new RoundNNode({ op: "rounddown" }).data({ value: [-3.789], digits: [1] }).result).toBeCloseTo(-3.7, 9);
  });
});

describe("MROUND", () => {
  it("rounds to the nearest multiple", () => {
    expect(new MRoundNode().data({ value: [10], multiple: [3] }).result).toBe(9);
    expect(new MRoundNode().data({ value: [11], multiple: [3] }).result).toBe(12);
    expect(new MRoundNode().data({ value: [1.3], multiple: [0.2] }).result).toBeCloseTo(1.4, 9);
  });
  it("op up = CEILING toward +∞ (multiple defaults to 1 → next integer)", () => {
    expect(new MRoundNode({ op: "up" }).data({ value: [10], multiple: [3] }).result).toBe(12);
    expect(new MRoundNode({ op: "up" }).data({ value: [2.1], multiple: [1] }).result).toBe(3);
    expect(new MRoundNode({ op: "up" }).data({ value: [-2.1], multiple: [1] }).result).toBe(-2); // toward +∞
    expect(new MRoundNode({ op: "up" }).label).toBe("CEILING");
  });
  it("op down = FLOOR toward −∞", () => {
    expect(new MRoundNode({ op: "down" }).data({ value: [10], multiple: [3] }).result).toBe(9);
    expect(new MRoundNode({ op: "down" }).data({ value: [2.9], multiple: [1] }).result).toBe(2);
    expect(new MRoundNode({ op: "down" }).data({ value: [-2.1], multiple: [1] }).result).toBe(-3); // toward −∞
    expect(new MRoundNode({ op: "down" }).label).toBe("FLOOR");
  });
  it("MROUND with opposite signs is #DOMAIN! (Excel #NUM!), same-sign computes", () => {
    const r = new MRoundNode().data({ value: [-10], multiple: [3] }).result;
    expect(isSolError(r) && r.code).toBe("#DOMAIN!");
    const r2 = new MRoundNode().data({ value: [10], multiple: [-3] }).result;
    expect(isSolError(r2) && r2.code).toBe("#DOMAIN!");
    expect(new MRoundNode().data({ value: [-10], multiple: [-3] }).result).toBe(-9); // same sign
    expect(new MRoundNode().data({ value: [0], multiple: [3] }).result).toBe(0);     // zero is fine
    // CEILING/FLOOR keep the opposite-sign case (no MROUND restriction).
    expect(new MRoundNode({ op: "up" }).data({ value: [-2.1], multiple: [1] }).result).toBe(-2);
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
    expect(run("permut", 5, 2)).toBe(20);
  });
});

describe("ATAN2 (Excel argument order)", () => {
  // Excel ATAN2(x_num, y_num) reverses JS Math.atan2(y, x); A is x, B is y.
  it("matches Excel's (x, y) order", () => {
    expect(new TwoInputMathNode({ op: "atan2" }).data({ a: [1], b: [1] }).result).toBeCloseTo(Math.PI / 4, 9);
    expect(new TwoInputMathNode({ op: "atan2" }).data({ a: [1], b: [0] }).result).toBeCloseTo(0, 9);
    expect(new TwoInputMathNode({ op: "atan2" }).data({ a: [0], b: [1] }).result).toBeCloseTo(Math.PI / 2, 9);
  });
  it("LOG tags a domain miss as #DOMAIN! — scalar and per-cell in a list", () => {
    const scalar = new TwoInputMathNode({ op: "log" }).data({ a: [-1], b: [10] }).result;
    expect(isSolError(scalar) && scalar.code === "#DOMAIN!").toBe(true);
    const list = new TwoInputMathNode({ op: "log" }).data({ a: [[100, -1, 1000]], b: [10] }).result as Array<number | { code: string }>;
    expect(list[0]).toBeCloseTo(2, 9);
    expect(isSolError(list[1]) && list[1].code === "#DOMAIN!").toBe(true);
    expect(list[2]).toBeCloseTo(3, 9);
  });
});

describe("GCD / LCM", () => {
  it("GCD", () => {
    expect(new GcdNode({ op: "gcd" }).data({ a: [12], b: [18] }).result).toBe(6);
  });
  it("LCM", () => {
    expect(new GcdNode({ op: "lcm" }).data({ a: [4], b: [6] }).result).toBe(12);
  });
});

describe("MathFn — deg/rad/auto angle modes", () => {
  it("default (auto, no unit resolved) computes radians — Excel parity", () => {
    // A fresh SIN node is angleMode:"auto" with _resolvedAngleMode:"rad".
    expect(new MathFnNode({ op: "sin" }).data({ in: [Math.PI / 2] }).result as number).toBeCloseTo(1, 9);
  });

  it("forward trig in deg mode converts the input: SIN(90°) = 1, COS(60°) = 0.5", () => {
    expect(new MathFnNode({ op: "sin", angleMode: "deg" }).data({ in: [90] }).result as number).toBeCloseTo(1, 9);
    expect(new MathFnNode({ op: "cos", angleMode: "deg" }).data({ in: [60] }).result as number).toBeCloseTo(0.5, 9);
    // Rad pin ignores the degree reading: SIN(90 rad) is not 1.
    expect(new MathFnNode({ op: "sin", angleMode: "rad" }).data({ in: [90] }).result as number).toBeCloseTo(Math.sin(90), 9);
  });

  it("inverse trig in deg mode converts the RESULT to degrees + tags the deg unit", () => {
    const n = new MathFnNode({ op: "asin", angleMode: "deg" });
    expect(n.data({ in: [1] }).result as number).toBeCloseTo(90, 9);
    expect(n.data({ in: [0.5] }).result as number).toBeCloseTo(30, 9);
    expect(n.annotationFor("result")?.unit).toBe("deg");
    // Rad mode: radians out, no unit.
    const r = new MathFnNode({ op: "asin", angleMode: "rad" });
    expect(r.data({ in: [1] }).result as number).toBeCloseTo(Math.PI / 2, 9);
    expect(r.annotationFor("result")).toBeUndefined();
  });

  it("the mode only touches trig ops (SQRT/EXP ignore it) and broadcasts over lists", () => {
    expect(new MathFnNode({ op: "sqrt", angleMode: "deg" }).data({ in: [9] }).result as number).toBe(3);
    const list = new MathFnNode({ op: "sin", angleMode: "deg" }).data({ in: [[0, 90, 180]] }).result as number[];
    expect(list[0]).toBeCloseTo(0, 9);
    expect(list[1]).toBeCloseTo(1, 9);
    expect(list[2]).toBeCloseTo(0, 9);
  });
});
