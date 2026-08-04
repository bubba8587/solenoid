// Dimensional algebra — the units foundation. A unit is an exponent vector over
// base dimensions plus a linear scale to the base-SI magnitude (and, for
// temperature, an affine offset). This file has no dependency on the editor,
// React, or any node.

// The base dimensions. SI's seven, plus three the app treats as first-class:
// `angle` (radian — dimensionless in strict SI but engineering tracks deg/rad),
// `currency` (money — its own axis, for the finance surfaces), and `information`
// (bit/byte). The exponent vector is sparse: a missing key means exponent 0.
export const BASE_DIMS = [
  "length", "mass", "time", "current", "temperature",
  "amount", "luminous", "angle", "currency", "information",
] as const;
export type BaseDim = (typeof BASE_DIMS)[number];

// A CUSTOM unit (an FC's free-text unit, e.g. "poop") gets its own opaque
// dimension axis keyed `custom:<name>`, so it participates in the algebra as a
// first-class base dimension — `poop ÷ s` is `poop/s`, `poop + poop` is `poop`,
// `poop + s` is `#UNIT!` — instead of collapsing to dimensionless (which made
// `poop ÷ s` read as `1/s` = Hz). The prefix can't collide with a base dim name.
export const CUSTOM_DIM_PREFIX = "custom:";
// The AXIS is case-insensitive ("Widgets" and "widgets" are the same quantity —
// two FCs differing only in case must add, not #UNIT!); the typed casing still
// shows via the annotation's display id. formatDim's derived label reads the
// normalized axis (lowercase) — the display-id path covers user-facing casing.
export const customDim = (name: string): Dim => ({ [CUSTOM_DIM_PREFIX + name.trim().toLowerCase()]: 1 });

/** A dimension = exponents over the base dims AND any `custom:<name>` axes. Sparse
 *  — absent key ⇒ 0. */
export type Dim = Record<string, number>;

/** The distinct axes present across the given dims (base + custom), for the
 *  key-agnostic algebra below — a custom axis must not be dropped. */
function dimAxes(...ds: Dim[]): string[] {
  const seen = new Set<string>();
  for (const d of ds) for (const k of Object.keys(d)) seen.add(k);
  return [...seen];
}

/**
 * A unit = a dimension + how its numeric magnitude relates to the base-SI unit.
 * `scale` is the linear factor (1 km = 1000 m ⇒ scale 1000 with length base m).
 * `offset` is the affine shift for temperature only (base = value·scale + offset;
 * 0 °C = 273.15 K ⇒ scale 1, offset 273.15). Offset units convert but can't
 * participate in ×/÷/^ (see requireLinear).
 */
export interface Unit {
  dim: Dim;
  scale: number;
  offset?: number;
}

export const DIMENSIONLESS: Dim = {};

/** Fold two dims elementwise with `f` (used by mul/div). Key-agnostic: folds over
 *  every base AND custom axis present in either operand. */
function combine(a: Dim, b: Dim, f: (x: number, y: number) => number): Dim {
  const out: Dim = {};
  for (const k of dimAxes(a, b)) {
    const v = f(a[k] ?? 0, b[k] ?? 0);
    if (v !== 0) out[k] = v;
  }
  return out;
}

export const dimMul = (a: Dim, b: Dim): Dim => combine(a, b, (x, y) => x + y);
export const dimDiv = (a: Dim, b: Dim): Dim => combine(a, b, (x, y) => x - y);

export function dimPow(a: Dim, n: number): Dim {
  const out: Dim = {};
  for (const k of Object.keys(a)) {
    const v = (a[k] ?? 0) * n;
    if (v !== 0) out[k] = v;
  }
  return out;
}

/** Same dimension? (Commensurable — a conversion between them exists.) Compares
 *  every base AND custom axis present in either dim. */
export function dimEqual(a: Dim, b: Dim): boolean {
  return dimAxes(a, b).every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

export function isDimensionless(a: Dim): boolean {
  return Object.keys(a).every((k) => (a[k] ?? 0) === 0);
}

/** An offset (affine) unit can't be multiplied/divided/powered — °C·°C is
 *  meaningless. Callers get null and should surface #UNIT!. */
function isLinear(u: Unit): boolean {
  return !u.offset;
}

export function unitMul(a: Unit, b: Unit): Unit | null {
  if (!isLinear(a) || !isLinear(b)) return null;
  return { dim: dimMul(a.dim, b.dim), scale: a.scale * b.scale };
}

export function unitDiv(a: Unit, b: Unit): Unit | null {
  if (!isLinear(a) || !isLinear(b) || b.scale === 0) return null;
  return { dim: dimDiv(a.dim, b.dim), scale: a.scale / b.scale };
}

export function unitPow(a: Unit, n: number): Unit | null {
  if (!isLinear(a)) return null;
  return { dim: dimPow(a.dim, n), scale: a.scale ** n };
}

/** Commensurable = same dimension (so a conversion factor exists). */
export function commensurable(a: Unit, b: Unit): boolean {
  return dimEqual(a.dim, b.dim);
}

/**
 * Convert `value` from unit `a` to unit `b`. Returns null if the units are
 * incommensurable (different dimensions) — the caller turns that into #UNIT!.
 * Handles the affine (temperature) case: to base = v·scale + offset, then from
 * base = (base − offset)/scale.
 */
export function convert(value: number, a: Unit, b: Unit): number | null {
  if (!commensurable(a, b)) return null;
  const base = value * a.scale + (a.offset ?? 0);
  const out = (base - (b.offset ?? 0)) / b.scale;
  return Number.isFinite(out) ? out : null;
}

// ─── The unit registry ─────────────────────────────────────────────────────────
// Base-SI reference units per dimension: metre, kilogram, second, ampere,
// kelvin, mole, candela, radian, one currency unit, bit. Every entry's `scale`
// is relative to those. This is the single source of truth for unit magnitudes —
// the Convert node's category table (nodes/convert.ts) sources its factors here.

const L = (n: number): Dim => ({ length: n });
const d = (dim: Dim, scale: number, offset?: number): Unit =>
  offset === undefined ? { dim, scale } : { dim, scale, offset };

// SI decimal prefixes, applied by the parser to any base symbol.
export const SI_PREFIXES: Record<string, number> = {
  Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, "µ": 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24,
};

// Named units keyed by their canonical symbol. Derived units (N, J, W, Pa, …)
// carry their full dimension so the algebra and formatter recognize them.
export const UNITS: Record<string, Unit> = {
  // dimensionless
  "1": d(DIMENSIONLESS, 1),
  "%": d(DIMENSIONLESS, 0.01),

  // length (base m)
  m: d(L(1), 1),
  in: d(L(1), 0.0254), ft: d(L(1), 0.3048), yd: d(L(1), 0.9144), mi: d(L(1), 1609.344),
  // mass (base kg)
  g: d({ mass: 1 }, 0.001), kg: d({ mass: 1 }, 1), t: d({ mass: 1 }, 1000),
  lb: d({ mass: 1 }, 0.45359237), oz: d({ mass: 1 }, 0.028349523125), stone: d({ mass: 1 }, 6.35029318),
  // time (base s)
  s: d({ time: 1 }, 1), min: d({ time: 1 }, 60), h: d({ time: 1 }, 3600),
  day: d({ time: 1 }, 86400), wk: d({ time: 1 }, 604800), yr: d({ time: 1 }, 31557600),
  // current, amount, luminous (base units)
  A: d({ current: 1 }, 1), mol: d({ amount: 1 }, 1), cd: d({ luminous: 1 }, 1),
  // angle (base rad)
  rad: d({ angle: 1 }, 1), deg: d({ angle: 1 }, Math.PI / 180), grad: d({ angle: 1 }, Math.PI / 200),
  // temperature (base K) — affine
  K: d({ temperature: 1 }, 1), degC: d({ temperature: 1 }, 1, 273.15), degF: d({ temperature: 1 }, 5 / 9, 273.15 - (32 * 5) / 9),
  // information (base bit)
  bit: d({ information: 1 }, 1), byte: d({ information: 1 }, 8),
  // currency (base ¤)
  "¤": d({ currency: 1 }, 1),

  // derived
  Hz: d({ time: -1 }, 1),
  N: d({ mass: 1, length: 1, time: -2 }, 1),
  Pa: d({ mass: 1, length: -1, time: -2 }, 1),
  J: d({ mass: 1, length: 2, time: -2 }, 1),
  W: d({ mass: 1, length: 2, time: -3 }, 1),
  L_vol: d(L(3), 0.001), // litre; keyed L_vol so the parser's "L" prefix rules don't clash
};

// A registry of derived units for FORMATTING (dim vector → nice symbol). Order
// matters: more specific / more common first.
const DERIVED_DISPLAY: Array<{ sym: string; dim: Dim }> = [
  { sym: "N", dim: { mass: 1, length: 1, time: -2 } },
  { sym: "Pa", dim: { mass: 1, length: -1, time: -2 } },
  { sym: "J", dim: { mass: 1, length: 2, time: -2 } },
  { sym: "W", dim: { mass: 1, length: 2, time: -3 } },
  { sym: "Hz", dim: { time: -1 } },
  { sym: "V", dim: { mass: 1, length: 2, time: -3, current: -1 } },
  { sym: "Ω", dim: { mass: 1, length: 2, time: -3, current: -2 } },
];

const BASE_SYMBOL: Partial<Record<BaseDim, string>> = {
  length: "m", mass: "kg", time: "s", current: "A", temperature: "K",
  amount: "mol", luminous: "cd", angle: "rad", currency: "¤", information: "bit",
};

// ─── Parsing a unit expression ────────────────────────────────────────────────
// Grammar (informal): a product of factors separated by `*`/`·`, then an
// optional `/` denominator (also a product). Each factor is a symbol with an
// optional integer/decimal power via `^` or a trailing superscript-style digit
// ("m2" == "m^2"). Symbols resolve against UNITS directly, else a single SI
// prefix + a base symbol (km, ms, µs, kWh-style compounds are the caller's job
// to spell with operators). Returns null on anything unrecognized.

function resolveSymbol(sym: string): Unit | null {
  if (UNITS[sym]) return UNITS[sym];
  if (sym === "L" || sym === "l") return UNITS.L_vol; // litre special-case
  // Try a single prefix + known base symbol (longest prefix first: "da").
  for (const p of ["da", ...Object.keys(SI_PREFIXES).filter((k) => k !== "da")]) {
    if (sym.length > p.length && sym.startsWith(p)) {
      const rest = sym.slice(p.length);
      const base = UNITS[rest] ?? (rest === "L" || rest === "l" ? UNITS.L_vol : undefined);
      if (base && isLinear(base)) return { dim: base.dim, scale: base.scale * SI_PREFIXES[p] };
    }
  }
  return null;
}

function parseFactor(tok: string): Unit | null {
  const t = tok.trim();
  if (t === "") return null;
  const caret = /^([^\^]+)\^(-?\d+(?:\.\d+)?)$/.exec(t);
  const trailing = /^([A-Za-zµ¤%]+?)(-?\d+)$/.exec(t);
  let symStr = t;
  let power = 1;
  if (caret) { symStr = caret[1]; power = Number(caret[2]); }
  else if (trailing) { symStr = trailing[1]; power = Number(trailing[2]); }
  const base = resolveSymbol(symStr);
  if (!base) return null;
  if (power === 1) return base;
  return unitPow(base, power);
}

function parseProduct(s: string): Unit | null {
  const factors = s.split(/[*·]/).map((f) => f.trim()).filter((f) => f !== "");
  if (factors.length === 0) return null;
  let acc: Unit = d(DIMENSIONLESS, 1);
  for (const f of factors) {
    const u = parseFactor(f);
    if (!u) return null;
    const next = unitMul(acc, u);
    if (!next) return null;
    acc = next;
  }
  return acc;
}

/** Parse a unit expression ("m/s", "kg*m/s^2", "km/h", "m2"). Null if any part
 *  is unrecognized. A bare recognized symbol short-circuits (keeps affine units,
 *  which a product would reject). */
export function parseUnit(expr: string): Unit | null {
  const s = expr.trim();
  if (s === "") return null;
  const direct = resolveSymbol(s);
  if (direct) return direct;
  const slash = s.split("/");
  if (slash.length > 2) return null;
  const num = parseProduct(slash[0]);
  if (!num) return null;
  if (slash.length === 1) return num;
  const den = parseProduct(slash[1]);
  if (!den) return null;
  return unitDiv(num, den);
}

/**
 * Render a dimension vector as a readable unit symbol: a named derived unit
 * where one matches exactly ("N", "W", "Pa"), else a base-symbol product with
 * ^ exponents and a `/` split for the negative powers ("m/s", "kg·m/s²" style
 * rendered as "kg*m/s^2"). Dimensionless → "" (the caller shows the number bare).
 */
export function formatDim(dim: Dim): string {
  if (isDimensionless(dim)) return "";
  for (const der of DERIVED_DISPLAY) if (dimEqual(dim, der.dim)) return der.sym;

  const pos: string[] = [];
  const neg: string[] = [];
  // Base dims first (stable order), then any custom axes by their name — so a mixed
  // dimension like `poop/s` reads with the base symbol and the custom name together.
  const axes = [
    ...BASE_DIMS.filter((k) => (dim[k] ?? 0) !== 0),
    ...Object.keys(dim).filter((k) => k.startsWith(CUSTOM_DIM_PREFIX)).sort(), // stable label regardless of op order
  ];
  for (const k of axes) {
    const e = dim[k] ?? 0;
    if (e === 0) continue;
    const sym = k.startsWith(CUSTOM_DIM_PREFIX) ? k.slice(CUSTOM_DIM_PREFIX.length) : BASE_SYMBOL[k as BaseDim]!;
    const mag = Math.abs(e);
    const term = mag === 1 ? sym : `${sym}^${mag}`;
    (e > 0 ? pos : neg).push(term);
  }
  const posStr = pos.join("·") || "1";
  if (neg.length === 0) return posStr;
  return `${posStr}/${neg.join("·")}`;
}
