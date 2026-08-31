import { describe, it, expect } from "vitest";
import { parseEquation, compileSolver, solveNumeric, sniffQuadratic, solveQuadratic, astToFormula, isolate, equalsWithin, type ParsedEquation } from "../../src/graph/equationSolve";
import { parseFormula } from "../../src/graph/excelFormula";
import { EquationNode } from "../../src/graph/nodes/equation";
import { isSolError, type SolError } from "../../src/graph/errorValue";

const eq = (s: string): ParsedEquation => {
  const p = parseEquation(s);
  if (p === null || typeof p === "string") throw new Error(`parse failed: ${s} → ${p}`);
  return p;
};

const solve = (equation: string, unknown: string, env: Record<string, unknown>): number => {
  const solver = compileSolver(eq(equation), unknown);
  expect(solver, `${equation} solve ${unknown}`).not.toBe(null);
  const r = solver!(env);
  expect(typeof r).toBe("number");
  return r as number;
};

describe("parseEquation", () => {
  it("splits on the top-level =", () => {
    const p = eq("V = I * R");
    expect(p.lhsText).toBe("V");
    expect(p.rhsText).toBe("(I*R)");
  });

  it("rejects no-equals and double-equals", () => {
    expect(typeof parseEquation("V + I")).toBe("string");
    expect(typeof parseEquation("a = b = c")).toBe("string");
    expect(parseEquation("V = = R")).toBe(null); // syntax
  });
});

describe("symbolic isolation", () => {
  it("Ohm's law solves for every variable", () => {
    expect(solve("V = I * R", "V", { I: 2, R: 50 })).toBe(100);
    expect(solve("V = I * R", "I", { V: 100, R: 50 })).toBe(2);
    expect(solve("V = I * R", "R", { V: 100, I: 2 })).toBe(50);
  });

  it("ideal gas — the four-way rearrangement in one node", () => {
    // p·v = n·8.314·t
    const gas = "p * v = n * 8.314462618 * t";
    expect(solve(gas, "p", { v: 0.0227, n: 1, t: 273.15 })).toBeCloseTo(100048.26, 1);
    expect(solve(gas, "v", { p: 100000, n: 1, t: 273.15 })).toBeCloseTo(0.022711, 5);
    expect(solve(gas, "n", { p: 100000, v: 0.022711, t: 273.15 })).toBeCloseTo(1, 4);
    expect(solve(gas, "t", { p: 100000, v: 0.022711, n: 1 })).toBeCloseTo(273.15, 1);
  });

  it("subtraction and division direction-sensitivity", () => {
    expect(solve("a - b = c", "b", { a: 10, c: 3 })).toBe(7);
    expect(solve("a / b = c", "b", { a: 10, c: 2 })).toBe(5);
    expect(solve("a - b = c", "a", { b: 4, c: 3 })).toBe(7);
  });

  it("powers: root, exponent, POWER and LOG calls", () => {
    expect(solve("a = b ^ 2", "b", { a: 25 })).toBe(5); // principal root
    expect(solve("a = 2 ^ b", "b", { a: 32 })).toBeCloseTo(5, 12);
    expect(solve("a = POWER(b, 3)", "b", { a: 27 })).toBeCloseTo(3, 12);
    expect(solve("a = LOG(b, 10)", "b", { a: 3 })).toBeCloseTo(1000, 9);
  });

  it("function inverses: EXP/LN, SQRT, trig, DEGREES", () => {
    expect(solve("a = EXP(b)", "b", { a: Math.E ** 2 })).toBeCloseTo(2, 12);
    expect(solve("a = LN(b)", "b", { a: 1 })).toBeCloseTo(Math.E, 12);
    expect(solve("c = SQRT(a^2 + b^2)", "b", { c: 5, a: 3 })).toBeCloseTo(4, 12);
    expect(solve("y = SIN(x)", "x", { y: 0.5 })).toBeCloseTo(Math.asin(0.5), 12);
    expect(solve("d = DEGREES(r)", "r", { d: 180 })).toBeCloseTo(Math.PI, 12);
  });

  it("unary minus and percent", () => {
    expect(solve("a = -b", "b", { a: 5 })).toBe(-5);
    expect(solve("a = b%", "b", { a: 0.25 })).toBe(25);
  });

  it("a real pack equation: solve Coulomb for distance", () => {
    // F = k q1 q2 / r²  →  r = √(k q1 q2 / F)
    const f = solve("f = 8.9875517923*10^9 * q1 * q2 / r ^ 2", "r",
      { f: 8.98755e-3, q1: 1e-6, q2: 1e-6 });
    expect(f).toBeCloseTo(1, 4);
  });

  it("broadcasts over lists (the isolated form is an ordinary formula)", () => {
    const solver = compileSolver(eq("V = I * R"), "R")!;
    const r = solver({ V: [10, 20, 30], I: 2 });
    expect(r).toEqual([5, 10, 15]);
  });

  it("declines when the unknown appears twice or behind ABS", () => {
    expect(compileSolver(eq("x^2 + x = 6"), "x")).toBe(null);
    expect(compileSolver(eq("a = ABS(b)"), "b")).toBe(null);
  });
});

describe("quadratic sniffing (both roots, not a principal branch)", () => {
  it("recognises a quadratic residual in any arrangement, exactly", () => {
    expect(sniffQuadratic((x) => x * x - 36)).toEqual({ a: 1, b: 0, c: -36 });
    // (x−1)(x+3) − 5, pre-expanded by the probe fit: a=1, b=2, c=−8.
    const q = sniffQuadratic((x) => (x - 1) * (x + 3) - 5)!;
    expect(q.a).toBeCloseTo(1, 12);
    expect(q.b).toBeCloseTo(2, 12);
    expect(q.c).toBeCloseTo(-8, 12);
  });

  it("declines non-polynomials and cubics", () => {
    expect(sniffQuadratic((x) => Math.sqrt(Math.abs(x)) - 2)).toBe(null);
    expect(sniffQuadratic((x) => x * x * x - 10)).toBe(null);
    expect(sniffQuadratic((x) => (x <= 0 ? null : Math.log10(x)))).toBe(null); // domain hole at a probe
  });

  it("solveQuadratic: ascending pair, double root scalar, negative discriminant, linear declines", () => {
    expect(solveQuadratic({ a: 1, b: 0, c: -36 })).toEqual([-6, 6]);
    expect(solveQuadratic({ a: 1, b: 2, c: -8 })).toEqual([-4, 2]);
    expect(solveQuadratic({ a: 1, b: -6, c: 9 })).toBe(3); // (x−3)²
    const none = solveQuadratic({ a: 1, b: 0, c: 1 });
    expect(isSolError(none)).toBe(true);
    expect((none as SolError).code).toBe("#SOLVE!");
    expect(solveQuadratic({ a: 0, b: 2, c: -10 })).toBe(null); // linear → caller falls through
  });
});

describe("numeric fallback", () => {
  it("finds a real root of what it's given (quadratics are intercepted upstream)", () => {
    const root = solveNumeric((x) => x * x + x - 6);
    expect(typeof root).toBe("number");
    const r = root as number;
    expect(Math.abs(r * r + r - 6)).toBeLessThan(1e-6);
  });

  it("transcendental: x·e^x = 5", () => {
    const root = solveNumeric((x) => x * Math.exp(x) - 5) as number;
    expect(Math.abs(root * Math.exp(root) - 5)).toBeLessThan(1e-6);
  });

  it("no real root → #SOLVE!", () => {
    const r = solveNumeric((x) => x * x + 1);
    expect(isSolError(r)).toBe(true);
    expect((r as SolError).code).toBe("#SOLVE!");
  });
});

describe("astToFormula round-trips", () => {
  it("re-parses to an equivalent tree", () => {
    for (const s of ["a*b+c", "SQRT(x^2+y^2)", "-a/(b-c)", "LOG(x,2)&\"m\""]) {
      const ast = parseFormula(s)!;
      const round = parseFormula(astToFormula(ast));
      expect(round, s).not.toBe(null);
      expect(astToFormula(round!), s).toBe(astToFormula(ast));
    }
  });

  it("isolate returns null when the unknown is absent", () => {
    expect(isolate(parseFormula("a+b")!, parseFormula("c")!, "z")).toBe(null);
  });
});

describe("EquationNode", () => {
  const node = (expr: string) => new EquationNode({ expr });

  it("derives paired input+output sockets plus Check", () => {
    const n = node("V = I * R");
    expect(n.varNames).toEqual(["V", "I", "R"]);
    expect(Object.keys(n.inputs)).toEqual(["V", "I", "R"]);
    expect(Object.keys(n.outputs)).toEqual(["holds", "V", "I", "R"]);
  });

  it("solves for the one unwired variable, passes the others through", () => {
    const n = node("V = I * R");
    const out = n.data({ V: [100], I: [2] });
    expect(out.R).toBe(50);
    expect(out.V).toBe(100);
    expect(out.I).toBe(2);
    expect(out.holds).toBe(null); // a solve isn't a check
    expect(n.solvedFor).toBe("R");
  });

  it("all wired → truth check with tolerance", () => {
    const n = node("V = I * R");
    expect(n.data({ V: [100], I: [2], R: [50] }).holds).toBe(true);
    expect(n.data({ V: [100], I: [2], R: [51] }).holds).toBe(false);
    // float dust within relative tolerance still holds
    expect(n.data({ V: [0.1 + 0.2], I: [1], R: [0.3] }).holds).toBe(true);
  });

  it("check broadcasts over lists", () => {
    const n = node("V = I * R");
    expect(n.data({ V: [[10, 20, 31]], I: [2], R: [[5, 10, 15]] }).holds)
      .toEqual([true, true, false]);
  });

  it("two unknowns → in-node message, blanks out", () => {
    const n = node("V = I * R");
    const out = n.data({ V: [100] });
    expect(n.cachedError).toMatch(/all but one/);
    expect(out.R).toBe(null);
    expect(out.holds).toBe(null);
  });

  it("a quadratic yields BOTH roots as an ascending list", () => {
    expect(node("x^2 - 36 = 0").data({}).x).toEqual([-6, 6]);
    expect(node("x^2 + x = c").data({ c: [6] }).x).toEqual([-3, 2]);
    expect(node("x^2 = c").data({ c: [36] }).x).toEqual([-6, 6]); // beats the principal branch
    expect(node("(x-3)^2 = 0").data({}).x).toBe(3); // double root stays scalar
    const none = node("x^2 + 1 = 0").data({});
    expect(isSolError(none.x)).toBe(true);
  });

  it("numeric fallback still drives non-polynomial multi-occurrence equations", () => {
    const n = node("x^3 + x = c");
    const out = n.data({ c: [10] });
    const x = out.x as number;
    expect(Math.abs(x * x * x + x - 10)).toBeLessThan(1e-6);
  });

  it("missing/error knowns propagate; no equals → message", () => {
    const n = node("V = I * R");
    expect(n.data({ V: [null as unknown as number], I: [2] }).R).toBe(null);
    const bad = node("V + I");
    bad.data({});
    expect(bad.cachedError).toMatch(/=/);
  });

  it("rebuild drops removed variables' sockets on the caller's signal", () => {
    const n = node("a = b * c");
    n.expr = "a = b + d";
    const { added, removed } = n._rebuild();
    expect(added).toEqual(["d"]);
    expect(removed).toEqual(["c"]);
  });
});

describe("equalsWithin", () => {
  it("relative near, absolute for small numbers", () => {
    expect(equalsWithin(1e12, 1e12 + 1)).toBe(true);
    expect(equalsWithin(1, 1.001)).toBe(false);
    expect(equalsWithin(0, 1e-12)).toBe(true);
  });
});
