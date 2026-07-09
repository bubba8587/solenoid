import { describe, it, expect } from "vitest";
import { CHEMISTRY_FORMULAS } from "./chemistry";
import { auditFormulaPack, entryByType, evalFormula } from "./formulaTestKit";
import { ELEMENTS, ELEMENT_BY_SYMBOL, molarMass, ElementNode, MolarMassNode } from "../nodes/chemistry";
import { isSolError, type SolError } from "../errorValue";

const num = (type: string, inputs: Record<string, number>): number => {
  const r = evalFormula(entryByType(CHEMISTRY_FORMULAS, type), inputs);
  expect(typeof r, `${type} → ${JSON.stringify(r)}`).toBe("number");
  return r as number;
};

describe("Chemistry formulas", () => {
  it("every formula compiles and is well-formed", () => {
    expect(auditFormulaPack(CHEMISTRY_FORMULAS)).toEqual([]);
  });

  it("amounts: moles/mass/molarity/dilution/yield", () => {
    expect(num("ch-moles", { m: 36.03, mm: 18.015 })).toBeCloseTo(2, 6);
    expect(num("ch-mass", { n: 2, mm: 18.015 })).toBeCloseTo(36.03, 6);
    expect(num("ch-molarity", { n: 0.5, v: 0.25 })).toBe(2);
    // 10 mL of 12 M stock into 100 mL → 1.2 M.
    expect(num("ch-dilution", { c1: 12, v1: 10, v2: 100 })).toBeCloseTo(1.2, 9);
    expect(num("ch-percent-yield", { actual: 4.1, theoretical: 5 })).toBeCloseTo(82, 9);
  });

  it("pH pair round-trips; neutral water is 7", () => {
    expect(num("ch-ph", { h: 1e-7 })).toBeCloseTo(7, 9);
    expect(num("ch-h-from-ph", { ph: 3 })).toBeCloseTo(1e-3, 9);
    expect(num("ch-ph", { h: num("ch-h-from-ph", { ph: 4.5 }) })).toBeCloseTo(4.5, 9);
  });

  it("Nernst: the 59.2 mV/decade slope at 25 °C", () => {
    const e = num("ch-nernst", { e0: 1, tk: 298.15, z: 1, q: 10 });
    expect(1 - e).toBeCloseTo(0.05916, 4);
  });

  it("Arrhenius: 50 kJ/mol roughly doubles per 10 K near room temperature", () => {
    const k298 = num("ch-arrhenius", { a: 1e13, ea: 50000, tk: 298.15 });
    const k308 = num("ch-arrhenius", { a: 1e13, ea: 50000, tk: 308.15 });
    expect(k308 / k298).toBeGreaterThan(1.8);
    expect(k308 / k298).toBeLessThan(2.2);
  });

  it("Gibbs, Beer–Lambert, decay", () => {
    // Ice melting at 0 °C: ΔH 6010 J/mol, ΔS 22.0 → ΔG ≈ 0.
    expect(num("ch-gibbs", { dh: 6010, tk: 273.15, ds: 22 })).toBeCloseTo(0, -1);
    expect(num("ch-beer-lambert", { eps: 5000, b: 1, conc: 1e-4 })).toBeCloseTo(0.5, 9);
    expect(num("ch-half-life", { n0: 100, t: 3, thalf: 1 })).toBeCloseTo(12.5, 9);
    expect(num("ch-decay-constant", { thalf: 5730 })).toBeCloseTo(1.2097e-4, 7); // carbon-14
  });
});

describe("Element data", () => {
  it("has all 118, unique symbols, ascending numbers", () => {
    expect(ELEMENTS).toHaveLength(118);
    expect(new Set(ELEMENTS.map((e) => e.symbol)).size).toBe(118);
    ELEMENTS.forEach((e, i) => expect(e.n).toBe(i + 1));
  });

  it("anchor masses (IUPAC)", () => {
    expect(ELEMENT_BY_SYMBOL.get("H")!.mass).toBeCloseTo(1.008, 3);
    expect(ELEMENT_BY_SYMBOL.get("C")!.mass).toBeCloseTo(12.011, 3);
    expect(ELEMENT_BY_SYMBOL.get("Fe")!.mass).toBeCloseTo(55.845, 3);
    expect(ELEMENT_BY_SYMBOL.get("U")!.mass).toBeCloseTo(238.029, 2);
  });

  it("node outputs and stale-op fallback", () => {
    expect(new ElementNode({ op: "Fe" }).data()).toEqual({ mass: 55.845, number: 26 });
    expect(new ElementNode({ op: "Xx" }).op).toBe("H");
  });
});

describe("Molar mass parser", () => {
  const mm = (s: string) => molarMass(s) as number;

  it("textbook formulas", () => {
    expect(mm("H2O")).toBeCloseTo(18.015, 2);
    expect(mm("CO2")).toBeCloseTo(44.009, 2);
    expect(mm("NaCl")).toBeCloseTo(58.44, 1);
    expect(mm("C6H12O6")).toBeCloseTo(180.156, 1);
    expect(mm("CO")).toBeCloseTo(28.01, 1); // C+O, not cobalt
  });

  it("parentheses, nesting, brackets", () => {
    expect(mm("Ca(OH)2")).toBeCloseTo(74.09, 1);
    expect(mm("Fe2(SO4)3")).toBeCloseTo(399.88, 1);
    expect(mm("Al2(SO4)3")).toBeCloseTo(342.15, 1);
    expect(mm("[Cu(NH3)4]SO4")).toBeCloseTo(227.73, 1);
  });

  it("hydrates in dot and star notation", () => {
    expect(mm("CuSO4·5H2O")).toBeCloseTo(249.69, 1);
    expect(mm("CuSO4*5H2O")).toBeCloseTo(249.69, 1);
    expect(mm("CuSO4.5H2O")).toBeCloseTo(249.69, 1);
  });

  it("errors: unknown element, unbalanced brackets, junk", () => {
    expect((molarMass("Xx2O") as SolError).code).toBe("#NAME?");
    expect(isSolError(molarMass("Ca(OH"))).toBe(true);
    expect(isSolError(molarMass("H2O)"))).toBe(true);
    expect(isSolError(molarMass("2+2"))).toBe(true);
  });

  it("node reads wired or typed formula", () => {
    const n = new MolarMassNode();
    expect(n.data({ formula: ["NaHCO3"] }).result as number).toBeCloseTo(84.007, 1);
    n.stringLiterals.formula = "KMnO4";
    expect(n.data({}).result as number).toBeCloseTo(158.03, 1);
  });
});
