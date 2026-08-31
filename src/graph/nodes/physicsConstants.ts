// CODATA 2018 values (several exact by the 2019 SI redefinition); SI units in every label.

import { ClassicPreset } from "rete";
import { numOut } from "./shared";
import type { FormatAnnotation } from "../formatAnnotationStore";

export type PhysConstOp =
  // Universal
  | "c" | "G" | "h" | "hbar" | "g0" | "atm"
  // Electromagnetic
  | "e" | "eps0" | "mu0" | "ke" | "z0" | "faraday"
  // Atomic
  | "me" | "mp" | "mn" | "a0" | "rydberg"
  // Physico-chemical
  | "na" | "kb" | "rgas" | "sigma" | "wien";

export interface PhysConstMeta {
  symbol: string;
  label: string;
  value: number;
  unit: string;
  group: "Universal" | "Electromagnetic" | "Atomic" | "Physico-chemical";
}

export const PHYS_CONSTANTS: Record<PhysConstOp, PhysConstMeta> = {
  c:       { symbol: "c",   label: "Speed of light",        value: 299792458,          unit: "m/s",      group: "Universal" },
  G:       { symbol: "G",   label: "Gravitational constant", value: 6.67430e-11,       unit: "m³/(kg·s²)", group: "Universal" },
  h:       { symbol: "h",   label: "Planck constant",       value: 6.62607015e-34,     unit: "J·s",      group: "Universal" },
  hbar:    { symbol: "ħ",   label: "Reduced Planck",        value: 1.054571817e-34,    unit: "J·s",      group: "Universal" },
  g0:      { symbol: "g₀",  label: "Standard gravity",      value: 9.80665,            unit: "m/s²",     group: "Universal" },
  atm:     { symbol: "atm", label: "Standard atmosphere",   value: 101325,             unit: "Pa",       group: "Universal" },
  e:       { symbol: "e",   label: "Elementary charge",     value: 1.602176634e-19,    unit: "C",        group: "Electromagnetic" },
  eps0:    { symbol: "ε₀",  label: "Vacuum permittivity",   value: 8.8541878128e-12,   unit: "F/m",      group: "Electromagnetic" },
  mu0:     { symbol: "µ₀",  label: "Vacuum permeability",   value: 1.25663706212e-6,   unit: "H/m",      group: "Electromagnetic" },
  ke:      { symbol: "kₑ",  label: "Coulomb constant",      value: 8.9875517923e9,     unit: "N·m²/C²",  group: "Electromagnetic" },
  z0:      { symbol: "Z₀",  label: "Impedance of free space", value: 376.730313668,    unit: "Ω",        group: "Electromagnetic" },
  faraday: { symbol: "F",   label: "Faraday constant",      value: 96485.33212,        unit: "C/mol",    group: "Electromagnetic" },
  me:      { symbol: "mₑ",  label: "Electron mass",         value: 9.1093837015e-31,   unit: "kg",       group: "Atomic" },
  mp:      { symbol: "mₚ",  label: "Proton mass",           value: 1.67262192369e-27,  unit: "kg",       group: "Atomic" },
  mn:      { symbol: "mₙ",  label: "Neutron mass",          value: 1.67492749804e-27,  unit: "kg",       group: "Atomic" },
  a0:      { symbol: "a₀",  label: "Bohr radius",           value: 5.29177210903e-11,  unit: "m",        group: "Atomic" },
  rydberg: { symbol: "R∞",  label: "Rydberg constant",      value: 10973731.56816,     unit: "1/m",      group: "Atomic" },
  na:      { symbol: "Nₐ",  label: "Avogadro constant",     value: 6.02214076e23,      unit: "1/mol",    group: "Physico-chemical" },
  kb:      { symbol: "k_B", label: "Boltzmann constant",    value: 1.380649e-23,       unit: "J/K",      group: "Physico-chemical" },
  rgas:    { symbol: "R",   label: "Molar gas constant",    value: 8.314462618,        unit: "J/(mol·K)", group: "Physico-chemical" },
  sigma:   { symbol: "σ",   label: "Stefan–Boltzmann",      value: 5.670374419e-8,     unit: "W/(m²·K⁴)", group: "Physico-chemical" },
  wien:    { symbol: "b",   label: "Wien displacement",     value: 2.897771955e-3,     unit: "m·K",      group: "Physico-chemical" },
};

export class PhysicsConstantNode extends ClassicPreset.Node {
  label: string;
  op: PhysConstOp;
  width = 210;
  height = 110;

  constructor(init?: { label?: string; op?: PhysConstOp }) {
    super("PhysicsConstant");
    this.op = init?.op && init.op in PHYS_CONSTANTS ? init.op : "c";
    this.label = init?.label ?? "";
    this.addOutput("value", numOut("Value"));
  }

  data() {
    return { value: PHYS_CONSTANTS[this.op].value };
  }

  /** A constant CARRIES its unit the way an FC lock does — unitFlow.ts is duck-typed on
   *  this method. A CUSTOM unit suffix, since units like J·s aren't FC-pickable ids. */
  annotation(): FormatAnnotation {
    return { format: "auto", unit: "custom", customUnit: ` ${PHYS_CONSTANTS[this.op].unit}` };
  }
}
