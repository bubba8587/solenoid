// [[C47]]
import { describe, it, expect } from "vitest";
import { parseEquation, astToFormula, type ParsedEquation } from "../../src/graph/equationSolve";
import { parseFormula } from "../../src/graph/excelFormula";
import { EquationNode } from "../../src/graph/nodes/equation";
import { isSolError } from "../../src/graph/errorValue";

const eq = (s: string): ParsedEquation => {
  const p = parseEquation(s);
  if (p === null || typeof p === "string") throw new Error(`parse failed: ${s} → ${p}`);
  return p;
};

// The solver itself (isolation, the quadratic fit, the numeric fallback) is pinned beside its body in
// crates/solenoid-core/src/nodes/formula.rs; these drive the card.

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

describe("the Equation card's solves", () => {
  it("a line whose unknown appears twice solves exactly, not by root-finding", () => {
    const eq = new EquationNode({ expr: "profit = price * units - fixed - cost * units" });
    const out = eq.data({ profit: [0], price: [25], fixed: [6000], cost: [10] });
    expect(out.units).toBe(400);
  });

  it("broadcasts an isolated solve over lists", () => {
    expect(new EquationNode({ expr: "V = I * R" }).data({ V: [[10, 20, 30]], I: [2] }).R).toEqual([5, 10, 15]);
  });
});

describe("astToFormula round-trips", () => {
  it("re-parses to an equivalent tree", () => {
    for (const s of ["a*b+c", "SQRT(x^2+y^2)", "-a/(b-c)", "LOG(x,2)&\"m\""]) {
      const ast = parseFormula(s)!;
      const round = parseFormula(astToFormula(ast));
      expect(astToFormula(round!), s).toBe(astToFormula(ast));
    }
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

  it("a form that only looks linear or quadratic at the probes falls back to root-finding", () => {
    const near = (v: unknown, want: number) => expect(Math.abs((v as number) - want)).toBeLessThan(1e-6);
    near(node("MIN(x,50) + x = 200").data({}).x, 150);
    near(node("IF(x>100, x-200, x-150) = 0").data({}).x, 200);
    near(node("MIN(x,30)*x = 1600").data({}).x, -40);
    near(node("IF(x>100, 20101-200*x, x*x+1) = 0").data({}).x, 100.505);
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
