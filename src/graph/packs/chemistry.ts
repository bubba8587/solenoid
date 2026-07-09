// Chemistry Basics — the periodic table as a node, a molar-mass calculator
// that parses real formulas (parentheses, hydrates), and the lab-bench formula
// set: moles/mass/molarity, dilution, pH, Nernst, Arrhenius, Gibbs, decay.
// SI-ish lab units: grams, moles, litres, kelvin where absolute.

import { ElementNode, MolarMassNode } from "../rete-nodes";
import { placeFormulas, type Pack, type FormulaPackEntry } from "./packShared";

const R_GAS = "8.314462618";
const FARADAY = "96485.33212";

export const CHEM_AMOUNTS: FormulaPackEntry[] = [
  { type: "ch-moles", label: "Moles from Mass", expr: "m/mm",
    description: "Amount of substance: mass m (g) ÷ molar mass mm (g/mol) → mol",
    keywords: "amount substance stoichiometry" },
  { type: "ch-mass", label: "Mass from Moles", expr: "n*mm",
    description: "Mass in grams: moles n × molar mass mm (g/mol)",
    keywords: "stoichiometry" },
  { type: "ch-molarity", label: "Molarity", expr: "n/v",
    description: "Concentration: moles n ÷ volume v (L) → mol/L",
    keywords: "concentration molar" },
  { type: "ch-dilution", label: "Dilution (C₂)", expr: "c1*v1/v2",
    description: "Concentration after dilution: C₁V₁ = C₂V₂ solved for C₂ (any consistent units)",
    keywords: "c1v1 stock solution" },
  { type: "ch-percent-yield", label: "Percent Yield", expr: "actual/theoretical*100",
    description: "Reaction yield: actual ÷ theoretical amount × 100" },
];

export const CHEM_EQUILIBRIA: FormulaPackEntry[] = [
  { type: "ch-ph", label: "pH from [H⁺]", expr: "-LOG10(h)",
    description: "pH from hydrogen-ion concentration h (mol/L)   (pH = −log₁₀[H⁺])",
    keywords: "acid base" },
  { type: "ch-h-from-ph", label: "[H⁺] from pH", expr: "10^-ph",
    description: "Hydrogen-ion concentration (mol/L) from pH   ([H⁺] = 10^−pH)",
    keywords: "acid base" },
  { type: "ch-nernst", label: "Nernst Equation", expr: `e0-${R_GAS}*tk/(z*${FARADAY})*LN(q)`,
    description: "Cell potential off standard conditions: standard potential e0 (V), temperature tk (K), electrons z, reaction quotient q   (E = E° − RT/zF·lnQ)",
    keywords: "electrochemistry cell potential redox" },
  { type: "ch-arrhenius", label: "Arrhenius Rate", expr: `a*EXP(-ea/(${R_GAS}*tk))`,
    description: "Rate constant: pre-exponential a, activation energy ea (J/mol), temperature tk (K)   (k = A·e^(−Ea/RT))",
    keywords: "kinetics activation energy" },
  { type: "ch-gibbs", label: "Gibbs Free Energy", expr: "dh-tk*ds",
    description: "ΔG from enthalpy dh (J/mol), temperature tk (K), entropy ds (J/mol·K)   (ΔG = ΔH − TΔS; negative = spontaneous)",
    keywords: "thermodynamics spontaneous" },
  { type: "ch-beer-lambert", label: "Beer–Lambert Absorbance", expr: "eps*b*conc",
    description: "Absorbance: molar absorptivity eps (L/mol·cm), path b (cm), concentration conc (mol/L)   (A = εbc)",
    keywords: "spectroscopy absorbance cuvette" },
  { type: "ch-half-life", label: "Decay Remaining", expr: "n0*0.5^(t/thalf)",
    description: "Amount left after time t given half-life thalf (same time units)   (N = N₀·(½)^(t/t½))",
    keywords: "radioactive exponential decay" },
  { type: "ch-decay-constant", label: "Decay Constant", expr: "LN(2)/thalf",
    description: "λ from a half-life   (λ = ln2 / t½, per the same time unit)",
    keywords: "radioactive lambda" },
];

export const CHEMISTRY_FORMULAS: FormulaPackEntry[] = [...CHEM_AMOUNTS, ...CHEM_EQUILIBRIA];

export const CHEMISTRY_PACK: Pack = {
  id: "chemistry",
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
        description: "Periodic-table lookup: pick an element → standard atomic weight (g/mol) and atomic number (IUPAC values)",
        keywords: "periodic table atomic weight number symbol",
        create: () => new ElementNode(),
      },
    },
    {
      path: ["Packs", "Chemistry"],
      entry: {
        type: "ch-molar-mass",
        label: "Molar Mass",
        description: "Molecular weight of a typed formula — handles parentheses and hydrates: Ca(OH)2, CuSO4·5H2O → g/mol",
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
