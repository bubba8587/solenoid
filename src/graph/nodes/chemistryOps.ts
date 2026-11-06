// [[C17]] shareImpl
// The periodic table the core reads (`crates/solenoid-core/data/elements.json`, `nodes/elements.rs`): PubChem's
// properties with IUPAC conventional weights. The picker and the card's tile read it here; every answer is the core's.
import TABLE from "../../../crates/solenoid-core/data/elements.json";

export interface ElementMeta {
  /** Atomic number. */
  n: number;
  symbol: string;
  name: string;
  /** g/mol. */
  mass: number;
  category: string;
  group: number | null;
  period: number;
  block: string;
  config: string;
  electronegativity: number | null;
  /** pm. */
  radius: number | null;
  /** kJ/mol. */
  ionization: number | null;
  affinity: number | null;
  oxidation: string;
  state: string;
  /** K. */
  melting: number | null;
  boiling: number | null;
  /** g/cm³. */
  density: number | null;
  /** Blank for an element known since antiquity. */
  discovered: number | null;
}

export const ELEMENTS: ElementMeta[] = TABLE as ElementMeta[];

export const ELEMENT_BY_SYMBOL: Map<string, ElementMeta> =
  new Map(ELEMENTS.map((e) => [e.symbol, e]));

/** The categories in table order (metals left to right, then the rest), so each keeps its palette color. */
export const ELEMENT_CATEGORIES = [
  "Alkali metal", "Alkaline earth metal", "Transition metal", "Post-transition metal", "Metalloid",
  "Nonmetal", "Halogen", "Noble gas", "Lanthanide", "Actinide",
] as const;
