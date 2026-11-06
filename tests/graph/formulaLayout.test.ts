// [[B16]] oneFormulaSurface, [[formula-language#Editor support]]
import { describe, it, expect } from "vitest";
import { indentFormula, flattenFormula, indentAt, FORMULA_WIDTH } from "../../src/graph/formulaLayout";
import { BUILTIN_PACKS } from "../../src/graph/packs";

const squash = (s: string) => s.replace(/\s/g, "");

describe("indentFormula", () => {
  it("leaves a formula that fits its line as typed", () => {
    expect(indentFormula("SUM(a, b)*2")).toBe("SUM(a, b)*2");
    expect(indentFormula("p * vol = n * R * tk")).toBe("p * vol = n * R * tk");
  });

  it("joins lines back before laying out, keeping text inside a string", () => {
    expect(flattenFormula("IF(\n  a > 1,\n  \"x\ny\",\n  0\n)")).toBe("IF(a > 1,\"x\ny\",0)");
    expect(flattenFormula("p * vol =\n  n")).toBe("p * vol = n");
  });

  it("breaks a long sum before its top-level operators, never at a unary sign or an exponent", () => {
    const out = indentFormula("2.5e-3*alpha_value+beta_value*-3-gamma_value/delta_value+1", 30);
    expect(out.split("\n").length).toBeGreaterThan(1);
    expect(out).toContain("2.5e-3");
    expect(out).toContain("*-3");
    expect(squash(out)).toBe(squash("2.5e-3*alpha_value+beta_value*-3-gamma_value/delta_value+1"));
  });

  it("opens a call too long for its own line, one argument a line, the closer at the opener's indent", () => {
    const out = indentFormula('IF(LEN(TRIM(some_text))=0,"empty",LEN(SUBSTITUTE(TRIM(some_text)," ","")))', 40);
    expect(out).toBe('IF(\n  LEN(TRIM(some_text))=0,\n  "empty",\n  LEN(SUBSTITUTE(TRIM(some_text)," ",""))\n)');
  });

  it("is idempotent", () => {
    const once = indentFormula("MOD(DEGREES(ATAN2(COS(a*PI()/180)*SIN(b*PI()/180)-SIN(a*PI()/180)*COS(b*PI()/180),SIN(c)*COS(b)))+360,360)");
    expect(indentFormula(once)).toBe(once);
  });

  it("lays out every pack preset without changing what it computes", () => {
    for (const p of BUILTIN_PACKS) {
      for (const { entry } of p.nodes ?? []) {
        const n = entry.create() as { locked?: boolean; expr?: unknown };
        if (!n.locked || typeof n.expr !== "string") continue;
        expect(squash(flattenFormula(n.expr)), entry.type).toBe(squash(n.expr));
        // A line only runs past the width where a single piece can't be split further.
        if (n.expr.includes("\n")) expect(n.expr.split("\n").some((l) => l.length <= FORMULA_WIDTH), entry.type).toBe(true);
      }
    }
  });
});

describe("indentAt", () => {
  it("counts the brackets open before the caret, outside strings", () => {
    expect(indentAt("SUM(a, IF(", 10)).toBe(2);
    expect(indentAt('IF("(", ', 8)).toBe(1);
    expect(indentAt("SUM(a)", 6)).toBe(0);
  });
});
