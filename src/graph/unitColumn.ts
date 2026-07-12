// ─── Per-column frame units — header parsing + display (Bundle 05: FC A4, step 5) ─
// A frame column locks to a dimensional unit two ways: a header written `Name (unit)`
// (the literal source path — Build Frame / Add Column strip the parenthetical and
// lock the column), or a Format Controller docked on the header string list. This
// module owns the header-spec parser and the column-value display helper; it sits
// between the value-layer `ColumnUnit` (unitValue.ts) and the FC unit ids
// (unitBridge.ts). Pure — no React/Rete.

import { type ColumnUnit } from "./unitValue";
import { fcUnitToUnit } from "./unitBridge";
import { type Unit, formatDim } from "./dimension";

// Currency symbol → FC unit id (the header spec "$0.00" means the currency $).
const CURRENCY_SYMBOL: Record<string, string> = { "$": "usd", "€": "eur", "£": "gbp", "¥": "jpy" };

/**
 * Parse a `Name (spec)` header into a clean column name + an optional `ColumnUnit`.
 * The parenthetical spec is a unit and/or number format: a currency symbol ("$0.00"
 * → $), or a unit token ("km", "m/s", "kg"). A header with no parenthetical, or a
 * spec that doesn't resolve to a dimensional unit, returns just the trimmed name.
 *
 *   "Revenue ($0.00)" → { clean: "Revenue", unit: { dim: currency, display: "usd" } }
 *   "Distance (km)"   → { clean: "Distance", unit: { dim: length, display: "km" } }
 *   "Item"            → { clean: "Item" }
 */
export function parseColumnUnitFromHeader(header: string): { clean: string; unit?: ColumnUnit } {
  const name = (header ?? "").trim();
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
  if (!m) return { clean: name };
  const clean = m[1].trim();
  const spec = m[2].trim();
  const cu = columnUnitFromSpec(spec);
  return cu ? { clean: clean || name, unit: cu } : { clean: name };
}

/** Resolve a header/FC unit spec ("$0.00", "km", "m/s") to a `ColumnUnit`, or null
 *  when it names no dimensional unit. */
export function columnUnitFromSpec(spec: string): ColumnUnit | null {
  const s = spec.trim();
  // Currency symbol anywhere in the spec ("$0.00", "€").
  for (const [sym, id] of Object.entries(CURRENCY_SYMBOL)) {
    if (s.includes(sym)) {
      const u = fcUnitToUnit(id)!;
      return { dim: u.dim, display: id };
    }
  }
  // A unit token: strip number-format punctuation ("0.00", "#,##0") to leave the
  // unit symbol, but KEEP `/`, `^`, letters, `%` (m/s, m^2, %).
  const token = s.replace(/[0#,.\s]/g, "");
  if (token === "") return null;
  const u = fcUnitToUnit(token);
  if (!u) return null;
  return { dim: u.dim, display: token };
}

/** The display label for a column's unit — the FC display id's symbol where it maps
 *  cleanly, else the derived-symbol form over the dimension vector ("m/s", "N"). */
export function columnUnitLabel(cu: ColumnUnit): string {
  if (cu.display) {
    const u = fcUnitToUnit(cu.display);
    if (u) return cu.display;
  }
  return formatDim(cu.dim);
}

/** Convert a column's stored base-SI magnitude to its display unit (for rendering a
 *  cell in the unit the column was locked to). Base value when no display unit or
 *  it doesn't resolve. */
export function columnDisplayValue(cu: ColumnUnit, base: number): number {
  const u: Unit | null = cu.display ? fcUnitToUnit(cu.display) : null;
  if (!u) return base;
  return (base - (u.offset ?? 0)) / u.scale;
}
