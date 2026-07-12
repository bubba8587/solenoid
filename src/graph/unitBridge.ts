// ─── Unit bridge — FC unit ids ⇄ dimensional Units (Bundle 05: FC A4) ────────────
// The Format Controller layer names units by an ID string ("m", "km", "usd", "mph")
// from UNIT_ANNOTATIONS (formatAnnotationStore.ts). The value layer computes with
// dimensional `Unit`s (exponent vector + SI scale) from dimension.ts. This module
// is the one-way lookup between them, so a source that carries an FC unit id can
// mint a base-SI `UnitCell`, and a `UnitCell`'s dimension can be shown with the
// user's chosen display id.
//
// Pure — imports the dimension algebra + the FC unit list only, no React/Rete.

import { type Unit, type Dim, parseUnit, dimEqual, DIMENSIONLESS } from "./dimension";
import { UNIT_ANNOTATIONS } from "./formatAnnotationStore";

// Units the dimension.ts parser can't spell (compound / non-metric areas & volumes,
// and the shared currency axis — FX is out of scope, so every currency is ONE
// dimension). Everything else resolves through `parseUnit`.
const DIRECT: Record<string, Unit> = {
  // Currencies collapse onto the single `currency` base axis (no exchange rate).
  usd: { dim: { currency: 1 }, scale: 1 },
  eur: { dim: { currency: 1 }, scale: 1 },
  gbp: { dim: { currency: 1 }, scale: 1 },
  jpy: { dim: { currency: 1 }, scale: 1 },
  // Areas the parser doesn't know.
  ha: { dim: { length: 2 }, scale: 10000 },
  ac: { dim: { length: 2 }, scale: 4046.8564224 },
  // Volume (US liquid gallon).
  gal: { dim: { length: 3 }, scale: 0.003785411784 },
};

// FC unit id → the string `parseUnit` understands, where they differ. Absent ⇒ the
// id IS the parse string (m, km, kg, s, deg, …).
const PARSE_AS: Record<string, string> = {
  hr: "h",          // FC "hr" = hour
  ms1: "m/s",       // speed
  kmh: "km/h",
  mph: "mi/h",
  b: "byte",        // data
  kb: "kbyte", mb: "Mbyte", gb: "Gbyte", tb: "Tbyte",
  L: "L", mL: "mL", // volume (parser's litre special-case)
};

// Resolved FC id → Unit, built once. `none` / `custom` / unresolved ⇒ absent.
const _cache = new Map<string, Unit | null>();

/** The dimensional `Unit` an FC unit id denotes, or null (dimensionless / unknown /
 *  `none` / `custom`). Memoized. */
export function fcUnitToUnit(id: string): Unit | null {
  if (id === "" || id === "none" || id === "custom") return null;
  const hit = _cache.get(id);
  if (hit !== undefined) return hit;
  let u: Unit | null = DIRECT[id] ?? parseUnit(PARSE_AS[id] ?? id) ?? null;
  _cache.set(id, u);
  return u;
}

/** The dimension an FC unit id carries (dimensionless if it has none / is unknown). */
export function fcUnitDim(id: string): Dim {
  return fcUnitToUnit(id)?.dim ?? DIMENSIONLESS;
}

/** Is this FC unit id a real DIMENSIONAL unit (participates in the value-layer unit
 *  algebra)? `none`, `custom`, `percent`-style and unresolved ids are not. */
export function isDimensionalFcUnit(id: string): boolean {
  const u = fcUnitToUnit(id);
  return u !== null && !dimEqual(u.dim, DIMENSIONLESS);
}

/** Find an FC unit id whose dimension + scale match a `Unit` (for showing a derived
 *  value in a friendly id). Prefers an exact scale match; falls back to the first
 *  id of the same dimension. Absent ⇒ no FC id fits (show the derived symbol). */
export function fcUnitIdForUnit(u: Unit): string | undefined {
  let sameDim: string | undefined;
  for (const ann of UNIT_ANNOTATIONS) {
    const cand = fcUnitToUnit(ann.id);
    if (!cand || !dimEqual(cand.dim, u.dim)) continue;
    if (Math.abs(cand.scale - u.scale) < 1e-12 && (cand.offset ?? 0) === (u.offset ?? 0)) return ann.id;
    if (sameDim === undefined) sameDim = ann.id;
  }
  return sameDim;
}
