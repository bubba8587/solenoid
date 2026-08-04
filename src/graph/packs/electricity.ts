// Electricity & Circuits pack. SI units throughout: volts, amps, ohms, farads,
// henries, hertz, seconds.

import {
  ParallelCombineNode, ESeriesNode, AwgNode, ResistorCodeNode,
  parallelCombine, awgWire, nearestESeries, decodeResistor, E_SERIES, type ESeriesOp,
} from "../rete-nodes";
import { placeFormulas, solError, isSolError, type Pack, type FormulaPackEntry, type PackFormula } from "./packShared";

// A rearrangement group ships as ONE locked Equation preset, not several solved
// forms.
export const ELECTRICITY_BASE: FormulaPackEntry[] = [
  { type: "elec-ohms-law", label: "Ohm's Law", expr: "v = i * r", equation: true,
    description: "V = I·R, solved for whichever of the three you leave unwired; wire all three and Check answers TRUE/FALSE",
    keywords: "ohm ohms law volts amps resistance triangle",
    varDescriptions: { v: "Voltage (V)", i: "Current (A)", r: "Resistance (Ω)" }, },
  { type: "elec-power-vi", label: "Power (V·I)", expr: "v*i",
    description: "Electrical power from voltage and current   (P = V·I)",
    keywords: "watts" },
  { type: "elec-power-i2r", label: "Power (I²R)", expr: "i^2*r",
    description: "Power dissipated in a resistance from current   (P = I²·R)",
    keywords: "watts dissipation joule heating" },
  { type: "elec-power-v2r", label: "Power (V²/R)", expr: "v^2/r",
    description: "Power dissipated in a resistance from voltage   (P = V²/R)",
    keywords: "watts dissipation" },
  { type: "elec-energy", label: "Electrical Energy", expr: "p*t",
    description: "Energy from power and time: watts × seconds → joules; kW × hours → kWh   (E = P·t)",
    keywords: "joules kwh" },
  { type: "elec-voltage-divider", label: "Voltage Divider", expr: "vin*r2/(r1+r2)",
    description: "Output of a two-resistor divider: vin across r1+r2, tapped over r2   (Vout = Vin·R2/(R1+R2))" },
  { type: "elec-led-resistor", label: "LED Series Resistor", expr: "(vs-vf)/i",
    description: "Series resistor for an LED: supply vs, forward voltage vf, target current i   (R = (Vs−Vf)/I)",
    keywords: "diode current limiting" },
  { type: "elec-wire-resistance", label: "Conductor Resistance", expr: "rho*len/a",
    description: "Resistance of a conductor: resistivity rho (Ω·m, copper 1.724e-8), length len (m), cross-section a (m²)   (R = ρL/A)",
    keywords: "resistivity wire" },
  { type: "elec-battery-life", label: "Battery Life", expr: "mah/ma",
    description: "Runtime in hours: battery capacity mah (mAh) ÷ load current ma (mA)",
    keywords: "capacity runtime" },
  { type: "elec-cap-energy", label: "Capacitor Energy", expr: "c*v^2/2",
    description: "Energy stored in a capacitor: capacitance c (F), voltage v   (E = ½CV²)",
    keywords: "joules stored" },
  { type: "elec-ind-energy", label: "Inductor Energy", expr: "l*i^2/2",
    description: "Energy stored in an inductor: inductance l (H), current i   (E = ½LI²)",
    keywords: "joules stored" },
];

export const ELECTRICITY_AC: FormulaPackEntry[] = [
  { type: "elec-cap-reactance", label: "Capacitive Reactance", expr: "1/(2*PI()*f*c)",
    description: "Reactance of a capacitor at frequency f   (Xc = 1/(2πfC))",
    keywords: "impedance ac" },
  { type: "elec-ind-reactance", label: "Inductive Reactance", expr: "2*PI()*f*l",
    description: "Reactance of an inductor at frequency f   (Xl = 2πfL)",
    keywords: "impedance ac" },
  { type: "elec-rlc-impedance", label: "Series RLC Impedance", expr: "SQRT(r^2+(xl-xc)^2)",
    description: "Impedance magnitude of a series R-L-C: resistance r, reactances xl and xc   (|Z| = √(R²+(Xl−Xc)²))" },
  { type: "elec-resonance", label: "Resonant Frequency", expr: "1/(2*PI()*SQRT(l*c))",
    description: "Resonant frequency of an LC pair: inductance l (H), capacitance c (F)   (f = 1/(2π√(LC)))",
    keywords: "tank tuned lc" },
];

export const ELECTRICITY_TRANSIENTS: FormulaPackEntry[] = [
  { type: "elec-rc-tau", label: "RC Time Constant", expr: "r*c",
    description: "First-order RC time constant: 63% of a step in one τ, ~settled in 5τ   (τ = R·C)" },
  { type: "elec-rl-tau", label: "RL Time Constant", expr: "l/r",
    description: "First-order RL time constant   (τ = L/R)" },
  { type: "elec-cap-charge", label: "Capacitor Charging", expr: "v0*(1-EXP(-t/(r*c)))",
    description: "Voltage on a charging capacitor at time t: source v0, through r into c   (V = V₀(1−e^(−t/RC)))",
    keywords: "step response exponential" },
  { type: "elec-cap-discharge", label: "Capacitor Discharging", expr: "v0*EXP(-t/(r*c))",
    description: "Voltage on a discharging capacitor at time t, from v0 through r   (V = V₀·e^(−t/RC))",
    keywords: "decay exponential" },
  { type: "elec-555-astable", label: "555 Timer (Astable)", expr: "1.44/((r1+2*r2)*c)",
    description: "Output frequency of the classic 555 astable: timing resistors r1, r2 and capacitor c   (f ≈ 1.44/((R1+2R2)C))",
    keywords: "oscillator ne555" },
];

export const ELECTRICITY_DB: FormulaPackEntry[] = [
  { type: "elec-db-power", label: "Decibels (Power Ratio)", expr: "10*LOG10(p2/p1)",
    description: "Power ratio in dB   (10·log₁₀(P₂/P₁))",
    keywords: "gain attenuation" },
  { type: "elec-db-voltage", label: "Decibels (Voltage Ratio)", expr: "20*LOG10(v2/v1)",
    description: "Voltage (amplitude) ratio in dB   (20·log₁₀(V₂/V₁))",
    keywords: "gain attenuation" },
  { type: "elec-dbm-w", label: "dBm ↔ Watts", expr: "dbm = 10*LOG10(w)+30", equation: true,
    description: "Absolute power both ways: wire dbm to get watts, or w to get dBm (0 dBm = 1 mW)",
    keywords: "dbm watts milliwatt level convert" },
];

export const ELECTRICITY_FORMULAS: FormulaPackEntry[] = [
  ...ELECTRICITY_BASE, ...ELECTRICITY_AC, ...ELECTRICITY_TRANSIENTS, ...ELECTRICITY_DB,
];

// Engineering/SI-prefix display at 3 significant figures: 4700 → "4.7k".
function toSiPrefix(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  const steps: Array<[number, string]> = [
    [1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""],
    [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"],
  ];
  const abs = Math.abs(n);
  for (const [factor, prefix] of steps) {
    if (abs >= factor * 0.999999999999) {
      return `${Number((n / factor).toPrecision(3))}${prefix}`;
    }
  }
  return `${Number((n / 1e-12).toPrecision(3))}p`;
}

// Each impl delegates to the same exported core its node calls, so the node and
// formula surfaces cannot drift.
const ELECTRICITY_PACK_FORMULAS: PackFormula[] = [
  {
    name: "PARALLELCOMBINE",
    impl: (...args: unknown[]) => {
      const cells = args.flatMap((a) => (Array.isArray(a) ? a : a == null ? [] : [a]));
      return parallelCombine(cells as Parameters<typeof parallelCombine>[0]);
    },
    returns: "number", listArgs: true, arity: [1, 255],
    signature: "values…",
  },
  {
    name: "ESERIESVALUE",
    impl: (value, series) => {
      if (value == null) return null;
      const v = Number(value);
      if (!Number.isFinite(v)) return null;
      const s = (series == null ? "E24" : String(series).toUpperCase()) as ESeriesOp;
      if (!(s in E_SERIES)) return solError("#VALUE!", `Unknown E-series "${s}" — E3, E6, E12, E24, E48, E96`);
      if (v <= 0) return solError("#DOMAIN!", "A component value must be a positive number");
      return nearestESeries(v, s);
    },
    returns: "number", arity: [1, 2],
    signature: "value, series (E24)",
  },
  {
    name: "AWGWIRE",
    impl: (gauge, property) => {
      if (gauge == null) return null;
      const n = Number(gauge);
      if (!Number.isFinite(n)) return null;
      const p = property == null ? "diameter" : String(property).toLowerCase();
      if (!["diameter", "area", "resistance", "ampacity"].includes(p)) {
        return solError("#VALUE!", `Unknown property "${p}" — diameter, area, resistance, ampacity`);
      }
      const w = awgWire(n);
      // Mirror the node: ampacity is blank outside the NEC table, never an error.
      if (isSolError(w)) return p === "ampacity" ? null : w;
      return w[p as keyof typeof w];
    },
    returns: "number", arity: [1, 2],
    signature: "gauge, property (diameter)",
  },
  {
    name: "RESISTORCOLORCODE",
    impl: (...bands: unknown[]) => {
      if (bands.some((b) => b == null)) return null;
      const c = bands.map((b) => String(b).toLowerCase());
      const r = c.length === 5
        ? decodeResistor(c[0], c[1], c[2], c[3], c[4], true)
        : decodeResistor(c[0], c[1], "black", c[2], c[3], false);
      return isSolError(r) ? r : r.ohms;
    },
    returns: "number", arity: [4, 5],
    signature: "digit, digit, multiplier, tolerance — or 5-band with a 3rd digit",
  },
];

export const ELECTRICITY_PACK: Pack = {
  formulas: ELECTRICITY_PACK_FORMULAS,
  id: "electricity",
  name: "Electricity & Circuits",
  description: "Everyday electrical engineering: Ohm's law and power, dividers, reactance and resonance, RC/RL transients, decibels, the resistor color-code decoder, E-series component values, and AWG wire properties. SI units.",
  builtin: true,
  defaultActive: false,
  nodes: [
    ...placeFormulas(["Packs", "Electricity"], ELECTRICITY_BASE),
    {
      path: ["Packs", "Electricity"],
      entry: {
        type: "elec-parallel",
        label: "Parallel Combine",
        description: "Combines a list as reciprocals: 1/Σ(1/xᵢ) — resistors in parallel, capacitors in series, springs in series",
        keywords: "parallel resistors reciprocal harmonic",
        create: () => new ParallelCombineNode(),
      },
    },
    ...placeFormulas(["Packs", "Electricity", "AC & Reactance"], ELECTRICITY_AC),
    ...placeFormulas(["Packs", "Electricity", "Transients & Timing"], ELECTRICITY_TRANSIENTS),
    ...placeFormulas(["Packs", "Electricity", "Signal Levels"], ELECTRICITY_DB),
    {
      path: ["Packs", "Electricity"],
      entry: {
        type: "elec-resistor-code",
        label: "Resistor Color Code",
        description: "Decode resistor bands: pick the colors on a live band diagram → resistance (Ω) and tolerance (±%). 4- or 5-band, IEC 60062",
        keywords: "resistor bands color color code ohms decode",
        create: () => new ResistorCodeNode(),
      },
    },
    {
      path: ["Packs", "Electricity", "Components & Wire"],
      entry: {
        type: "elec-eseries",
        label: "E-Series Value",
        fx: ["ESERIESVALUE"],
        description: "Snaps a value to the nearest IEC 60063 standard component value (E12 = 10% resistors, E24 = 5%, E96 = 1%…), with the % error",
        keywords: "resistor standard preferred value iec 60063",
        create: () => new ESeriesNode(),
      },
    },
    {
      path: ["Packs", "Electricity", "Components & Wire"],
      entry: {
        type: "elec-awg",
        label: "AWG Wire",
        description: "American Wire Gauge → diameter, cross-section, copper Ω/km (20 °C), and NEC 75 °C ampacity. For 1/0–4/0 enter 0 to −3.",
        keywords: "wire gauge awg ampacity copper",
        create: () => new AwgNode(),
      },
    },
  ],
  units: [
    { id: "V", label: " V", group: "electrical", groupLabel: "Electrical" },
    { id: "mV", label: " mV", group: "electrical" },
    { id: "kV", label: " kV", group: "electrical" },
    { id: "A", label: " A", group: "electrical" },
    { id: "mA", label: " mA", group: "electrical" },
    { id: "ohm", label: " Ω", group: "electrical" },
    { id: "kohm", label: " kΩ", group: "electrical" },
    { id: "Mohm", label: " MΩ", group: "electrical" },
    { id: "W", label: " W", group: "electrical" },
    { id: "kW", label: " kW", group: "electrical" },
    { id: "Hz", label: " Hz", group: "electrical" },
    { id: "kHz", label: " kHz", group: "electrical" },
    { id: "MHz", label: " MHz", group: "electrical" },
    { id: "uF", label: " µF", group: "electrical" },
    { id: "nF", label: " nF", group: "electrical" },
    { id: "mH", label: " mH", group: "electrical" },
    { id: "uH", label: " µH", group: "electrical" },
    { id: "dB", label: " dB", group: "electrical" },
    { id: "dBm", label: " dBm", group: "electrical" },
    { id: "mAh", label: " mAh", group: "electrical" },
  ],
  formats: [
    { id: "siprefix", label: "SI prefix (4.7k, 2.2µ)", group: "Engineering", apply: toSiPrefix },
  ],
};
