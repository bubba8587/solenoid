import { ClassicPreset, type NodeEditor } from "rete";
import { broadcastErr, numListIn, numListOut } from "./shared";
import { isFcUnit, type FormatStyle } from "../formatAnnotationStore";
import { solError, type SolError } from "../errorValue";
import { convert as dimConvert, commensurable, type Dim, type Unit } from "../dimension";

// ─── Convert ─────────────────────────────────────────────────────────────────
// Excel equivalent: =CONVERT(number, from_unit, to_unit)
//
// The conversion MATH is delegated to the dimensional-algebra core (dimension.ts,
// Bundle 05) — the single source of truth for unit magnitudes. Each unit here
// gets a `dim` Unit (dimension vector + SI scale); `convertValue` runs through
// `dimConvert`, and the cross-family guard is a real commensurability check
// (m² vs m is now caught by unequal dimension vectors, not just a category
// label). The `category` stays for the dropdown's grouping + the legacy
// toBase/fromBase pair for any direct caller.

export type ConvertCategory =
  | "angle" | "length" | "mass" | "temperature"
  | "time" | "area" | "volume" | "speed" | "energy" | "pressure";

export interface ConvertUnitDef {
  label: string;
  excelCode: string;
  category: ConvertCategory;
  toBase: (x: number) => number;
  fromBase: (x: number) => number;
  /** Dimensional-algebra unit (dimension.ts): the SI-scaled source of truth the
   *  Convert math actually runs through. */
  dim: Unit;
}

// Each category's dimension + the SI scale of its LOCAL base unit (the one every
// factor here is relative to): angle base rad, length base m, mass base gram
// (0.001 kg), time base s, area base m², volume base litre (0.001 m³), speed
// base m/s, energy base J, pressure base Pa. So a unit's SI scale = its factor ×
// the category base's SI scale.
const CATEGORY_DIM: Record<Exclude<ConvertCategory, "temperature">, { dim: Dim; baseScale: number }> = {
  angle:    { dim: { angle: 1 }, baseScale: 1 },
  length:   { dim: { length: 1 }, baseScale: 1 },
  mass:     { dim: { mass: 1 }, baseScale: 0.001 },      // base gram
  time:     { dim: { time: 1 }, baseScale: 1 },
  area:     { dim: { length: 2 }, baseScale: 1 },
  volume:   { dim: { length: 3 }, baseScale: 0.001 },    // base litre
  speed:    { dim: { length: 1, time: -1 }, baseScale: 1 },
  energy:   { dim: { mass: 1, length: 2, time: -2 }, baseScale: 1 },
  pressure: { dim: { mass: 1, length: -1, time: -2 }, baseScale: 1 },
};

function mkUnit(label: string, excelCode: string, category: Exclude<ConvertCategory, "temperature">, factor: number): ConvertUnitDef {
  const c = CATEGORY_DIM[category];
  return {
    label, excelCode, category,
    toBase: (x) => x * factor,
    fromBase: (x) => x / factor,
    dim: { dim: c.dim, scale: factor * c.baseScale },
  };
}

export const CONVERT_CATEGORY_LABELS: Record<ConvertCategory, string> = {
  angle:       "Angle",
  length:      "Length",
  mass:        "Mass",
  temperature: "Temperature",
  time:        "Time",
  area:        "Area",
  volume:      "Volume",
  speed:       "Speed",
  energy:      "Energy",
  pressure:    "Pressure",
};

export const CONVERT_UNIT_DEFS: Record<string, ConvertUnitDef> = {
  // Angle (base: radian)
  rad:   mkUnit("Radians",      "rad",   "angle",  1),
  deg:   mkUnit("Degrees",      "deg",   "angle",  Math.PI / 180),
  grad:  mkUnit("Gradians",     "grad",  "angle",  Math.PI / 200),

  // Length (base: meter)
  m:     mkUnit("Meters",       "m",     "length", 1),
  km:    mkUnit("Kilometers",   "km",    "length", 1000),
  cm:    mkUnit("Centimeters",  "cm",    "length", 0.01),
  mm:    mkUnit("Millimeters",  "mm",    "length", 0.001),
  in:    mkUnit("Inches",       "in",    "length", 0.0254),
  ft:    mkUnit("Feet",         "ft",    "length", 0.3048),
  yd:    mkUnit("Yards",        "yd",    "length", 0.9144),
  mi:    mkUnit("Miles",        "mi",    "length", 1609.344),

  // Mass (base: gram)
  g:     mkUnit("Grams",        "g",     "mass",   1),
  kg:    mkUnit("Kilograms",    "kg",    "mass",   1000),
  mg:    mkUnit("Milligrams",   "mg",    "mass",   0.001),
  lb:    mkUnit("Pounds",       "lbm",   "mass",   453.59237),
  oz_m:  mkUnit("Ounces",       "ozm",   "mass",   28.349523125),
  stone: mkUnit("Stone",        "stone", "mass",   6350.29318),
  tonne: mkUnit("Metric ton",   "t",     "mass",   1e6),

  // Temperature (affine — a factor alone can't express it). toBase/fromBase are
  // to CELSIUS (the legacy local base); the `dim` units are to KELVIN (SI), which
  // dimConvert uses. Both encode the same physics.
  C: { label: "Celsius",    excelCode: "C", category: "temperature", toBase: (x) => x,                 fromBase: (x) => x,               dim: { dim: { temperature: 1 }, scale: 1,     offset: 273.15 } },
  F: { label: "Fahrenheit", excelCode: "F", category: "temperature", toBase: (x) => (x - 32) * 5 / 9, fromBase: (x) => x * 9 / 5 + 32,  dim: { dim: { temperature: 1 }, scale: 5 / 9, offset: 273.15 - (32 * 5) / 9 } },
  K: { label: "Kelvin",     excelCode: "K", category: "temperature", toBase: (x) => x - 273.15,        fromBase: (x) => x + 273.15,      dim: { dim: { temperature: 1 }, scale: 1,     offset: 0 } },

  // Time (base: second)
  s:   mkUnit("Seconds", "sec", "time", 1),
  min: mkUnit("Minutes", "mn",  "time", 60),
  hr:  mkUnit("Hours",   "hr",  "time", 3600),
  day: mkUnit("Days",    "day", "time", 86400),
  wk:  mkUnit("Weeks",   "wk",  "time", 604800),
  yr:  mkUnit("Years",   "yr",  "time", 31557600),

  // Area (base: m²)
  m2:   mkUnit("Sq. meters",      "m2",      "area", 1),
  km2:  mkUnit("Sq. kilometers",  "km2",     "area", 1e6),
  cm2:  mkUnit("Sq. centimeters", "cm2",     "area", 0.0001),
  in2:  mkUnit("Sq. inches",      "in2",     "area", 0.00064516),
  ft2:  mkUnit("Sq. feet",        "ft2",     "area", 0.09290304),
  yd2:  mkUnit("Sq. yards",       "yd2",     "area", 0.83612736),
  mi2:  mkUnit("Sq. miles",       "mi2",     "area", 2589988.110336),
  ha:   mkUnit("Hectares",        "ha",      "area", 10000),
  acre: mkUnit("Acres",           "uk_acre", "area", 4046.8564224),

  // Volume (base: liter)
  l:    mkUnit("Liters",        "l",   "volume", 1),
  ml:   mkUnit("Milliliters",   "ml",  "volume", 0.001),
  tsp:  mkUnit("Teaspoons",     "tsp", "volume", 0.00492892159375),
  tbs:  mkUnit("Tablespoons",   "tbs", "volume", 0.01478676478125),
  cup:  mkUnit("Cups",          "cup", "volume", 0.2365882365),
  floz: mkUnit("Fl. oz",        "oz",  "volume", 0.0295735295625),
  pt:   mkUnit("Pints",         "pt",  "volume", 0.473176473),
  qt:   mkUnit("Quarts",        "qt",  "volume", 0.946352946),
  gal:  mkUnit("Gallons",       "gal", "volume", 3.785411784),
  m3:   mkUnit("Cubic meters",  "m3",  "volume", 1000),

  // Speed (base: m/s)
  m_s:  mkUnit("m/s",    "m/s", "speed", 1),
  km_h: mkUnit("km/h",   "m/h", "speed", 1 / 3.6),
  mph:  mkUnit("mph",    "mph", "speed", 0.44704),
  knot: mkUnit("Knots",  "kn",  "speed", 0.514444),

  // Energy (base: joule)
  J:    mkUnit("Joules",        "J",   "energy", 1),
  kJ:   mkUnit("Kilojoules",    "kJ",  "energy", 1000),
  cal:  mkUnit("Calories",      "cal", "energy", 4.184),
  kcal: mkUnit("Kilocalories",  "Cal", "energy", 4184),
  BTU:  mkUnit("BTU",           "BTU", "energy", 1055.05585262),
  Wh:   mkUnit("Watt-hours",    "Wh",  "energy", 3600),
  kWh:  mkUnit("Kilowatt-hr",   "kWh", "energy", 3600000),

  // Pressure (base: Pascal)
  Pa:   mkUnit("Pascals",       "Pa",   "pressure", 1),
  kPa:  mkUnit("Kilopascals",   "kPa",  "pressure", 1000),
  bar:  mkUnit("Bar",           "bar",  "pressure", 100000),
  atm:  mkUnit("Atmospheres",   "atm",  "pressure", 101325),
  psi:  mkUnit("PSI",           "psi",  "pressure", 6894.757293168),
  mmHg: mkUnit("mmHg",          "mmHg", "pressure", 133.322387415),
};

export function convertValue(x: number, fromKey: string, toKey: string): number | null {
  const from = CONVERT_UNIT_DEFS[fromKey];
  const to   = CONVERT_UNIT_DEFS[toKey];
  if (!from || !to) return null;
  // Delegate to the dimensional-algebra core — commensurability (m² vs m) and
  // the affine temperature case are handled there, one source of truth.
  return dimConvert(x, from.dim, to.dim);
}

export class ConvertNode extends ClassicPreset.Node {
  label: string;
  fromUnit: string;
  toUnit: string;
  // Convert's own display formats for its in/out boxes (independent of any FC).
  inFormat: FormatStyle = "auto";
  outFormat: FormatStyle = "auto";
  cachedInput: number | number[] | null = null;
  cachedResult: number | (number | SolError | null)[] | SolError | null = null;
  // Convert is a hybrid node+FC with primacy over units in an FC→Convert→FC
  // chain: its own from/to dropdowns are the authority and dictate the units of
  // adjacent FCs (upstream FC locks to fromUnit, downstream FC locks to toUnit).
  // These flags say whether such an FC is actually attached, so the node can
  // show the imposing-arrow markers (◀ toward its input, ▶ toward its output).
  imposesUp = false;
  imposesDown = false;
  width = 200;
  height = 300;

  constructor(init?: { label?: string; fromUnit?: string; toUnit?: string; inFormat?: FormatStyle; outFormat?: FormatStyle }) {
    super("Convert");
    this.label    = init?.label    ?? "Convert";
    this.fromUnit = init?.fromUnit ?? "deg";
    this.toUnit   = init?.toUnit   ?? "rad";
    if (init?.inFormat)  this.inFormat  = init.inFormat;
    if (init?.outFormat) this.outFormat = init.outFormat;
    this.addInput("in",  numListIn("In"));
    this.addOutput("out", numListOut("Out"));
  }

  /**
   * Convert's output carries its toUnit forward — a downstream FC locks to it,
   * exactly as it would to an upstream FC. Exposed as `unit` (an FC unit id) so
   * FC.refreshAnnotation can treat Convert as a unit forwarder. "none" when the
   * toUnit has no matching FC unit.
   */
  get unit(): string {
    return isFcUnit(this.toUnit) ? this.toUnit : "none";
  }

  /**
   * Convert always imposes its unit semantics: it reads its input as fromUnit
   * and emits toUnit. That push is a property of the value (unitFlow carries
   * toUnit downstream on its own — it does NOT need an adjacent FC), so the
   * arrows track whether each socket is simply connected, not whether an FC is
   * sitting next to it. A downstream FC anywhere past here still locks to toUnit.
   */
  syncUnitArrows(
    editor: NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>,
  ): void {
    let up = false, down = false;
    for (const c of editor.getConnections()) {
      if (c.target === this.id && c.targetInput === "in")    up = true;
      if (c.source === this.id && c.sourceOutput === "out")  down = true;
    }
    this.imposesUp = up;
    this.imposesDown = down;
  }

  data(inputs: { in?: (number | number[])[] }): { out: number | (number | SolError | null)[] | SolError | null } {
    const x = inputs.in?.[0] ?? null;
    this.cachedInput = x;
    if (x === null) { this.cachedResult = null; return { out: null }; }
    // Cross-family conversion (metres → kilograms) measures different things —
    // Excel's CONVERT returns #N/A. This is the NODE's unit pick, not a per-cell
    // condition, so it's a whole-value error at every dimensionality (a scalar OR
    // an entire list becomes #N/A — no point per-celling a node-level mistake).
    const from = CONVERT_UNIT_DEFS[this.fromUnit];
    const to   = CONVERT_UNIT_DEFS[this.toUnit];
    // Incommensurable units (metres → kilograms, m² → m) measure different
    // things — a real dimension-vector check, not just a category label. Excel's
    // CONVERT returns #N/A; kept as #N/A (not #UNIT!) so IFNA/ISNA still catch a
    // bad Convert pick, matching the node's long-standing contract.
    if (from && to && !commensurable(from.dim, to.dim)) {
      const err = solError("#N/A", `Can't convert ${from.category} to ${to.category}: the units measure different things`);
      this.cachedResult = err;
      return { out: err };
    }
    // A same-family conversion whose result overflows is #OVERFLOW!, tagged per-cell
    // in a list exactly as the scalar tags (array-semantics: lists carry per-cell
    // errors — was a silent per-element null before).
    const rangeErr = () => solError("#OVERFLOW!", "The converted value is too large to represent");
    const result = broadcastErr((v) => convertValue(v, this.fromUnit, this.toUnit) ?? rangeErr(), x);
    this.cachedResult = result;
    return { out: result };
  }
}
