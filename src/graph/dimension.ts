// [[C25]] firstClassUnits
// Must stay free of the editor, React and every node. The unit catalog and the labels are the core's
// (`crates/solenoid-core/src/unit_catalog.rs`, `unit_lists.rs`); these are the value shape and its cheap checks.
import { formatDim as coreFormatDim, fcUnit } from "./engineWasm/solenoid_graph.js";

export type Dim = Record<string, number>;

export interface Unit {
  dim: Dim;
  scale: number;
  offset?: number;
}

export const DIMENSIONLESS: Dim = {};

export function dimPow(a: Dim, n: number): Dim {
  const out: Dim = {};
  for (const k of Object.keys(a)) {
    const v = (a[k] ?? 0) * n;
    if (v !== 0) out[k] = v;
  }
  return out;
}

export function dimEqual(a: Dim, b: Dim): boolean {
  if (a === b) return true;
  for (const k in a) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  for (const k in b) if (!(k in a) && (b[k] ?? 0) !== 0) return false;
  return true;
}

export function isDimensionless(a: Dim): boolean {
  for (const k in a) if ((a[k] ?? 0) !== 0) return false;
  return true;
}

const labels = new Map<string, string>();

/** A dimension's label, `m/s` or `N`, on the core (`unit_lists.rs` `format_dim`); dimensionless is "". */
export function formatDim(dim: Dim): string {
  const key = JSON.stringify(dim);
  let label = labels.get(key);
  if (label === undefined) labels.set(key, (label = coreFormatDim(key)));
  return label;
}

const units = new Map<string, Unit | null>();

/** A unit id's unit, on the core (`unit_catalog.rs` `fc_unit_to_unit`): an FC unit, a Convert unit, a currency code or
 *  a unit expression; null for none. */
export function fcUnitToUnit(id: string): Unit | null {
  let u = units.get(id);
  if (u === undefined) units.set(id, (u = JSON.parse(fcUnit(id)) as Unit | null));
  return u;
}
