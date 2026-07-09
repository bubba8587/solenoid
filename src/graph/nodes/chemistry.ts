// Custom-logic nodes for the Chemistry Basics pack: the periodic-table element
// lookup (an embedded public-domain dataset — IUPAC standard atomic weights,
// abridged/conventional values; a bracketed mass number for elements with no
// stable isotope) and the molar-mass calculator (a chemical-formula parser —
// parentheses, nested groups, and hydrate dots — which no pre-set Expression
// can be).

import { ClassicPreset } from "rete";
import { numOut, strIn } from "./shared";
import { solError, type SolError } from "../errorValue";

export interface ElementMeta {
  n: number;       // atomic number
  symbol: string;
  name: string;
  mass: number;    // g/mol
  period: number;  // dropdown grouping
}

const E = (n: number, symbol: string, name: string, mass: number, period: number): ElementMeta =>
  ({ n, symbol, name, mass, period });

export const ELEMENTS: ElementMeta[] = [
  E(1, "H", "Hydrogen", 1.008, 1), E(2, "He", "Helium", 4.002602, 1),
  E(3, "Li", "Lithium", 6.94, 2), E(4, "Be", "Beryllium", 9.0121831, 2),
  E(5, "B", "Boron", 10.81, 2), E(6, "C", "Carbon", 12.011, 2),
  E(7, "N", "Nitrogen", 14.007, 2), E(8, "O", "Oxygen", 15.999, 2),
  E(9, "F", "Fluorine", 18.998403163, 2), E(10, "Ne", "Neon", 20.1797, 2),
  E(11, "Na", "Sodium", 22.98976928, 3), E(12, "Mg", "Magnesium", 24.305, 3),
  E(13, "Al", "Aluminium", 26.9815385, 3), E(14, "Si", "Silicon", 28.085, 3),
  E(15, "P", "Phosphorus", 30.973761998, 3), E(16, "S", "Sulfur", 32.06, 3),
  E(17, "Cl", "Chlorine", 35.45, 3), E(18, "Ar", "Argon", 39.948, 3),
  E(19, "K", "Potassium", 39.0983, 4), E(20, "Ca", "Calcium", 40.078, 4),
  E(21, "Sc", "Scandium", 44.955908, 4), E(22, "Ti", "Titanium", 47.867, 4),
  E(23, "V", "Vanadium", 50.9415, 4), E(24, "Cr", "Chromium", 51.9961, 4),
  E(25, "Mn", "Manganese", 54.938044, 4), E(26, "Fe", "Iron", 55.845, 4),
  E(27, "Co", "Cobalt", 58.933194, 4), E(28, "Ni", "Nickel", 58.6934, 4),
  E(29, "Cu", "Copper", 63.546, 4), E(30, "Zn", "Zinc", 65.38, 4),
  E(31, "Ga", "Gallium", 69.723, 4), E(32, "Ge", "Germanium", 72.63, 4),
  E(33, "As", "Arsenic", 74.921595, 4), E(34, "Se", "Selenium", 78.971, 4),
  E(35, "Br", "Bromine", 79.904, 4), E(36, "Kr", "Krypton", 83.798, 4),
  E(37, "Rb", "Rubidium", 85.4678, 5), E(38, "Sr", "Strontium", 87.62, 5),
  E(39, "Y", "Yttrium", 88.90584, 5), E(40, "Zr", "Zirconium", 91.224, 5),
  E(41, "Nb", "Niobium", 92.90637, 5), E(42, "Mo", "Molybdenum", 95.95, 5),
  E(43, "Tc", "Technetium", 98, 5), E(44, "Ru", "Ruthenium", 101.07, 5),
  E(45, "Rh", "Rhodium", 102.9055, 5), E(46, "Pd", "Palladium", 106.42, 5),
  E(47, "Ag", "Silver", 107.8682, 5), E(48, "Cd", "Cadmium", 112.414, 5),
  E(49, "In", "Indium", 114.818, 5), E(50, "Sn", "Tin", 118.71, 5),
  E(51, "Sb", "Antimony", 121.76, 5), E(52, "Te", "Tellurium", 127.6, 5),
  E(53, "I", "Iodine", 126.90447, 5), E(54, "Xe", "Xenon", 131.293, 5),
  E(55, "Cs", "Caesium", 132.90545196, 6), E(56, "Ba", "Barium", 137.327, 6),
  E(57, "La", "Lanthanum", 138.90547, 6), E(58, "Ce", "Cerium", 140.116, 6),
  E(59, "Pr", "Praseodymium", 140.90766, 6), E(60, "Nd", "Neodymium", 144.242, 6),
  E(61, "Pm", "Promethium", 145, 6), E(62, "Sm", "Samarium", 150.36, 6),
  E(63, "Eu", "Europium", 151.964, 6), E(64, "Gd", "Gadolinium", 157.25, 6),
  E(65, "Tb", "Terbium", 158.92535, 6), E(66, "Dy", "Dysprosium", 162.5, 6),
  E(67, "Ho", "Holmium", 164.93033, 6), E(68, "Er", "Erbium", 167.259, 6),
  E(69, "Tm", "Thulium", 168.93422, 6), E(70, "Yb", "Ytterbium", 173.045, 6),
  E(71, "Lu", "Lutetium", 174.9668, 6), E(72, "Hf", "Hafnium", 178.49, 6),
  E(73, "Ta", "Tantalum", 180.94788, 6), E(74, "W", "Tungsten", 183.84, 6),
  E(75, "Re", "Rhenium", 186.207, 6), E(76, "Os", "Osmium", 190.23, 6),
  E(77, "Ir", "Iridium", 192.217, 6), E(78, "Pt", "Platinum", 195.084, 6),
  E(79, "Au", "Gold", 196.966569, 6), E(80, "Hg", "Mercury", 200.592, 6),
  E(81, "Tl", "Thallium", 204.38, 6), E(82, "Pb", "Lead", 207.2, 6),
  E(83, "Bi", "Bismuth", 208.9804, 6), E(84, "Po", "Polonium", 209, 6),
  E(85, "At", "Astatine", 210, 6), E(86, "Rn", "Radon", 222, 6),
  E(87, "Fr", "Francium", 223, 7), E(88, "Ra", "Radium", 226, 7),
  E(89, "Ac", "Actinium", 227, 7), E(90, "Th", "Thorium", 232.0377, 7),
  E(91, "Pa", "Protactinium", 231.03588, 7), E(92, "U", "Uranium", 238.02891, 7),
  E(93, "Np", "Neptunium", 237, 7), E(94, "Pu", "Plutonium", 244, 7),
  E(95, "Am", "Americium", 243, 7), E(96, "Cm", "Curium", 247, 7),
  E(97, "Bk", "Berkelium", 247, 7), E(98, "Cf", "Californium", 251, 7),
  E(99, "Es", "Einsteinium", 252, 7), E(100, "Fm", "Fermium", 257, 7),
  E(101, "Md", "Mendelevium", 258, 7), E(102, "No", "Nobelium", 259, 7),
  E(103, "Lr", "Lawrencium", 266, 7), E(104, "Rf", "Rutherfordium", 267, 7),
  E(105, "Db", "Dubnium", 268, 7), E(106, "Sg", "Seaborgium", 269, 7),
  E(107, "Bh", "Bohrium", 270, 7), E(108, "Hs", "Hassium", 269, 7),
  E(109, "Mt", "Meitnerium", 278, 7), E(110, "Ds", "Darmstadtium", 281, 7),
  E(111, "Rg", "Roentgenium", 282, 7), E(112, "Cn", "Copernicium", 285, 7),
  E(113, "Nh", "Nihonium", 286, 7), E(114, "Fl", "Flerovium", 289, 7),
  E(115, "Mc", "Moscovium", 290, 7), E(116, "Lv", "Livermorium", 293, 7),
  E(117, "Ts", "Tennessine", 294, 7), E(118, "Og", "Oganesson", 294, 7),
];

export const ELEMENT_BY_SYMBOL: Map<string, ElementMeta> =
  new Map(ELEMENTS.map((e) => [e.symbol, e]));

// ─── Molar-mass parser ────────────────────────────────────────────────────────
// Grammar: formula = segment (('·'|'.'|'*') segment)*   (hydrate notation)
//          segment = count? unit+
//          unit    = (element | '(' unit+ ')' | '[' unit+ ']') count?
// Counts may be decimal (nonstoichiometric occasionally written 0.5).

export function molarMass(input: string): number | SolError {
  const s = input.replace(/\s+/g, "");
  if (!s) return solError("#VALUE!", "Type a chemical formula, e.g. H2O");
  let total = 0;
  for (const segRaw of s.split(/[·•*]|(?<=[)\]\d])\.(?=\d*[A-Z])/)) {
    // A hydrate segment may open with a multiplier: CuSO4·5H2O.
    const m = /^(\d+(?:\.\d+)?)?(.*)$/.exec(segRaw)!;
    const mult = m[1] ? Number(m[1]) : 1;
    const seg = m[2];
    if (!seg) return solError("#VALUE!", "A formula segment is empty");
    const r = parseGroup(seg, 0, "");
    if (typeof r === "object" && "code" in r) return r as SolError;
    const [mass, end] = r as [number, number];
    if (end !== seg.length) return solError("#VALUE!", `Unexpected "${seg[end]}" in formula`);
    total += mult * mass;
  }
  return total;
}

/** Parse units from `i` until end or the matching `close`; returns [mass, next index]. */
function parseGroup(s: string, i: number, close: string): [number, number] | SolError {
  let mass = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === close) return [mass, i];
    if (ch === "(" || ch === "[") {
      const r = parseGroup(s, i + 1, ch === "(" ? ")" : "]");
      if (!Array.isArray(r)) return r;
      const [inner, at] = r;
      if (s[at] !== (ch === "(" ? ")" : "]")) return solError("#VALUE!", "Unbalanced brackets in formula");
      const cm = /^(\d+(?:\.\d+)?)?/.exec(s.slice(at + 1))!;
      mass += inner * (cm[1] ? Number(cm[1]) : 1);
      i = at + 1 + (cm[1]?.length ?? 0);
      continue;
    }
    const em = /^([A-Z][a-z]?)(\d+(?:\.\d+)?)?/.exec(s.slice(i));
    if (!em) return solError("#VALUE!", `Unexpected "${ch}" in formula`);
    let sym = em[1];
    let el = ELEMENT_BY_SYMBOL.get(sym);
    if (!el && sym.length === 2) {
      // "CO" is carbon+oxygen, not a "Co" typo — but the tokenizer grabbed a
      // valid-looking two-letter symbol only if it EXISTS, so this branch is a
      // genuinely unknown pair: retry as one letter (handles e.g. "NO", "HF").
      sym = sym[0];
      el = ELEMENT_BY_SYMBOL.get(sym);
      if (el) {
        const cm2 = /^(\d+(?:\.\d+)?)?/.exec(s.slice(i + 1))!;
        mass += el.mass * (cm2[1] ? Number(cm2[1]) : 1);
        i += 1 + (cm2[1]?.length ?? 0);
        continue;
      }
    }
    if (!el) return solError("#NAME?", `Unknown element "${em[1]}"`);
    mass += el.mass * (em[2] ? Number(em[2]) : 1);
    i += em[0].length;
  }
  if (close) return solError("#VALUE!", "Unbalanced brackets in formula");
  return [mass, i];
}

// ─── Nodes ────────────────────────────────────────────────────────────────────

export class ElementNode extends ClassicPreset.Node {
  label: string;
  op: string; // element symbol
  width = 220;
  height = 170;

  constructor(init?: { label?: string; op?: string }) {
    super("Element");
    this.op = init?.op && ELEMENT_BY_SYMBOL.has(init.op) ? init.op : "H";
    this.label = init?.label ?? "Element";
    this.addOutput("mass", numOut("g/mol"));
    this.addOutput("number", numOut("Z"));
  }

  data() {
    const el = ELEMENT_BY_SYMBOL.get(this.op)!;
    return { mass: el.mass, number: el.n };
  }
}

export class MolarMassNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = { formula: "H2O" };
  cachedResult: number | SolError | null = null;
  width = 210;
  height = 140;

  constructor(init?: { label?: string }) {
    super("MolarMass");
    this.label = init?.label ?? "Molar Mass";
    this.addInput("formula", strIn("Formula"));
    this.addOutput("result", numOut("g/mol"));
  }

  data(inputs: { formula?: string[] }) {
    const f = inputs.formula?.[0] ?? this.stringLiterals.formula ?? "";
    const result = f.trim() ? molarMass(f) : null;
    this.cachedResult = result;
    return { result };
  }
}
