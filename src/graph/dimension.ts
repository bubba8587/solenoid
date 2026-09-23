// [[C25]] firstClassUnits
// Must stay free of the editor, React and every node.

export const BASE_DIMS = [
  "length", "mass", "time", "current", "temperature",
  "amount", "luminous", "angle", "currency", "information",
] as const;
export type BaseDim = (typeof BASE_DIMS)[number];

export const CUSTOM_DIM_PREFIX = "custom:";
export const customDim = (name: string): Dim => ({ [CUSTOM_DIM_PREFIX + name.trim().toLowerCase()]: 1 });

export type Dim = Record<string, number>;

function dimAxes(...ds: Dim[]): string[] {
  const seen = new Set<string>();
  for (const d of ds) for (const k of Object.keys(d)) seen.add(k);
  return [...seen];
}

export interface Unit {
  dim: Dim;
  scale: number;
  offset?: number;
}

export const DIMENSIONLESS: Dim = {};

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

export function dimEqual(a: Dim, b: Dim): boolean {
  return dimAxes(a, b).every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

/** `k` with `dim` = `base`^k, or null when `dim` is no power of `base`. */
export function dimPowerOf(dim: Dim, base: Dim): number | null {
  let k: number | null = null;
  for (const key of dimAxes(dim, base)) {
    const d = dim[key] ?? 0, b = base[key] ?? 0;
    if (b === 0) { if (d !== 0) return null; continue; }
    if (k === null) k = d / b;
    else if (Math.abs(d / b - k) > 1e-12) return null;
  }
  return k;
}

export function isDimensionless(a: Dim): boolean {
  return Object.keys(a).every((k) => (a[k] ?? 0) === 0);
}

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

export function commensurable(a: Unit, b: Unit): boolean {
  return dimEqual(a.dim, b.dim);
}

export function convert(value: number, a: Unit, b: Unit): number | null {
  if (!commensurable(a, b)) return null;
  const base = value * a.scale + (a.offset ?? 0);
  const out = (base - (b.offset ?? 0)) / b.scale;
  return Number.isFinite(out) ? out : null;
}

const L = (n: number): Dim => ({ length: n });
const d = (dim: Dim, scale: number, offset?: number): Unit =>
  offset === undefined ? { dim, scale } : { dim, scale, offset };

export const SI_PREFIXES: Record<string, number> = {
  Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, "µ": 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24,
};

export const UNITS: Record<string, Unit> = {
  "1": d(DIMENSIONLESS, 1),
  "%": d(DIMENSIONLESS, 0.01),

  m: d(L(1), 1),
  in: d(L(1), 0.0254), ft: d(L(1), 0.3048), yd: d(L(1), 0.9144), mi: d(L(1), 1609.344),
  g: d({ mass: 1 }, 0.001), kg: d({ mass: 1 }, 1), t: d({ mass: 1 }, 1000),
  lb: d({ mass: 1 }, 0.45359237), oz: d({ mass: 1 }, 0.028349523125), stone: d({ mass: 1 }, 6.35029318),
  s: d({ time: 1 }, 1), min: d({ time: 1 }, 60), h: d({ time: 1 }, 3600),
  day: d({ time: 1 }, 86400), wk: d({ time: 1 }, 604800), yr: d({ time: 1 }, 31557600),
  A: d({ current: 1 }, 1), mol: d({ amount: 1 }, 1), cd: d({ luminous: 1 }, 1),
  rad: d({ angle: 1 }, 1), deg: d({ angle: 1 }, Math.PI / 180), grad: d({ angle: 1 }, Math.PI / 200),
  K: d({ temperature: 1 }, 1), degC: d({ temperature: 1 }, 1, 273.15), degF: d({ temperature: 1 }, 5 / 9, 273.15 - (32 * 5) / 9),
  bit: d({ information: 1 }, 1), byte: d({ information: 1 }, 8),
  "¤": d({ currency: 1 }, 1),

  Hz: d({ time: -1 }, 1),
  N: d({ mass: 1, length: 1, time: -2 }, 1),
  Pa: d({ mass: 1, length: -1, time: -2 }, 1),
  J: d({ mass: 1, length: 2, time: -2 }, 1),
  W: d({ mass: 1, length: 2, time: -3 }, 1),
  L_vol: d(L(3), 0.001), // keyed L_vol, not L, so the prefix parser's "L" handling can't clash
};

// Order matters: most specific first.
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

function resolveSymbol(sym: string): Unit | null {
  if (UNITS[sym]) return UNITS[sym];
  if (sym === "L" || sym === "l") return UNITS.L_vol;
  // "da" first: it is the only two-letter prefix and must win over "d".
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
  const caret = /^([^^]+)\^(-?\d+(?:\.\d+)?)$/.exec(t);
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

export function formatDim(dim: Dim): string {
  if (isDimensionless(dim)) return "";
  for (const der of DERIVED_DISPLAY) if (dimEqual(dim, der.dim)) return der.sym;

  const pos: string[] = [];
  const neg: string[] = [];
  const axes = [
    ...BASE_DIMS.filter((k) => (dim[k] ?? 0) !== 0),
    ...Object.keys(dim).filter((k) => k.startsWith(CUSTOM_DIM_PREFIX)).sort(),
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
