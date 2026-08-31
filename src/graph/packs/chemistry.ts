// Lab units throughout: grams, moles, litres, kelvin where absolute.

import { ElementNode, MolarMassNode, molarMass, ELEMENTS, ELEMENT_BY_SYMBOL } from "../rete-nodes";
import { placeFormulas, solError, type Pack, type FormulaPackEntry, type PackFormula } from "./packShared";

const R_GAS = "8.314462618";
const FARADAY = "96485.33212";

export const CHEM_AMOUNTS: FormulaPackEntry[] = [
  { type: "ch-moles-mass", label: "Moles ↔ Mass", expr: "n = m / mm", equation: true,
    description: "n = m/mm with any one unknown: moles from mass, mass from moles, or even the molar mass from both; wire a Molar Mass node into mm",
    keywords: "amount substance stoichiometry grams moles molar" },
  { type: "ch-molarity", label: "Molarity", expr: "n/v",
    description: "Concentration: moles n ÷ volume v (L) → mol/L",
    keywords: "concentration molar" },
  { type: "ch-dilution", label: "Dilution (C₂)", expr: "c1*v1/v2",
    description: "Concentration after dilution, C₁V₁ = C₂V₂ solved for C₂. Any consistent units.",
    keywords: "c1v1 stock solution" },
  { type: "ch-percent-yield", label: "Percent Yield", expr: "actual/theoretical*100",
    description: "Reaction yield: actual ÷ theoretical amount × 100" },
];

export const CHEM_EQUILIBRIA: FormulaPackEntry[] = [
  { type: "ch-ph", label: "pH ↔ [H⁺]", expr: "ph = -LOG10(h)", equation: true,
    description: "pH = −log₁₀[H⁺], either way around: wire h (mol/L) to get the pH, or ph to get the concentration",
    keywords: "acid base hydrogen concentration" },
  { type: "ch-nernst", label: "Nernst Equation", expr: `e0-${R_GAS}*tk/(z*${FARADAY})*LN(q)`,
    description: "Cell potential E = E° − RT/zF·lnQ off standard conditions: standard potential e0 (V), temperature tk (K), electrons z, reaction quotient q.",
    keywords: "electrochemistry cell potential redox",
    varDescriptions: { e0: "Standard potential E° (V)", tk: "Temperature (K)", z: "Electrons transferred", q: "Reaction quotient Q" } },
  { type: "ch-arrhenius", label: "Arrhenius Rate", expr: `a*EXP(-ea/(${R_GAS}*tk))`,
    description: "Rate constant: pre-exponential a, activation energy ea (J/mol), temperature tk (K)   (k = A·e^(−Ea/RT))",
    keywords: "kinetics activation energy" },
  { type: "ch-gibbs", label: "Gibbs Free Energy", expr: "dh-tk*ds",
    description: "ΔG = ΔH − TΔS from enthalpy dh (J/mol), temperature tk (K), entropy ds (J/mol·K). Negative means spontaneous.",
    keywords: "thermodynamics spontaneous" },
  { type: "ch-beer-lambert", label: "Beer–Lambert Absorbance", expr: "eps*b*conc",
    description: "Absorbance A = εbc: molar absorptivity eps in L/mol·cm, path b in cm, concentration conc in mol/L.",
    keywords: "spectroscopy absorbance cuvette" },
  { type: "ch-half-life", label: "Decay Remaining", expr: "n0*0.5^(t/thalf)",
    description: "Amount left after time t given half-life thalf (same time units)   (N = N₀·(½)^(t/t½))",
    keywords: "radioactive exponential decay" },
  { type: "ch-decay-constant", label: "Decay Constant", expr: "LN(2)/thalf",
    description: "Decay constant λ = ln2 / t½ from a half-life, in the same time unit.",
    keywords: "radioactive lambda" },
];

export const CHEMISTRY_FORMULAS: FormulaPackEntry[] = [...CHEM_AMOUNTS, ...CHEM_EQUILIBRIA];

// The pack's custom-logic nodes exposed as formula functions (formulaNaming decision 4).
const CHEMISTRY_PACK_FORMULAS: PackFormula[] = [
  {
    name: "ELEMENT",
    impl: (el, property) => {
      if (el == null) return null;
      const meta = typeof el === "number"
        ? ELEMENTS.find((m) => m.n === el)
        : ELEMENT_BY_SYMBOL.get(String(el));
      if (!meta) return solError("#NAME?", `Unknown element "${el}"`);
      const p = property == null ? "mass" : String(property).toLowerCase();
      if (p === "mass") return meta.mass;
      if (p === "number") return meta.n;
      if (p === "name") return meta.name;
      if (p === "symbol") return meta.symbol;
      if (p === "period") return meta.period;
      return solError("#VALUE!", `Unknown property "${p}" — mass, number, name, symbol, period`);
    },
    returns: "any", arity: [1, 2],
    signature: "symbol or atomic number, [property (mass)]",
  },
  {
    name: "MOLARMASS",
    impl: (formula) => {
      if (formula == null) return null;
      const s = String(formula);
      return s.trim() ? molarMass(s) : null;
    },
    returns: "number", arity: [1, 1],
    signature: "chemical formula — H2O, CuSO4·5H2O",
  },
];

export const CHEMISTRY_PACK: Pack = {
  formulas: CHEMISTRY_PACK_FORMULAS,
  id: "chemistry",
  group: "Science & Engineering",
  name: "Chemistry Basics",
  description: "The periodic table as a node, molar mass from a typed formula (parentheses and hydrates included), and the lab-bench set: moles/molarity/dilution, pH, Nernst, Arrhenius, Gibbs, Beer–Lambert, radioactive decay.",
  builtin: true,
  defaultActive: false,
  nodes: [
    {
      path: ["Packs", "Chemistry"],
      entry: {
        type: "ch-element",
        label: "Element",
        description: "Periodic-table lookup: search by symbol, name, or number, or click the table itself → standard atomic weight in g/mol and atomic number. IUPAC values",
        keywords: "periodic table atomic weight number symbol",
        create: () => new ElementNode(),
      },
    },
    {
      path: ["Packs", "Chemistry"],
      entry: {
        type: "ch-molar-mass",
        label: "Molar Mass",
        description: "Molecular weight of a typed formula. Handles parentheses and hydrates: Ca(OH)2, CuSO4·5H2O → g/mol",
        keywords: "molecular weight formula weight mw",
        create: () => new MolarMassNode(),
      },
    },
    ...placeFormulas(["Packs", "Chemistry"], CHEM_AMOUNTS),
    ...placeFormulas(["Packs", "Chemistry", "Equilibria & Kinetics"], CHEM_EQUILIBRIA),
  ],
  units: [
    { id: "mol", label: " mol", group: "chemistry", groupLabel: "Chemistry" },
    { id: "mmol", label: " mmol", group: "chemistry" },
    { id: "gmol", label: " g/mol", group: "chemistry" },
    { id: "molL", label: " mol/L", group: "chemistry" },
  ],
};
