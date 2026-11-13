// [[A1]] visualGraphCalculator, [[save-format#A save loses nothing quietly]]
// A card with addable rows (List Input's `v0`, `v1`; a filter's `column0`/`value0` pairs) rebuilds exactly the rows its
// saved `valueKeys` name, and a save always carries them. A line written by hand or by a model rarely does: it names
// `value1<-Other.out` or `condConfig={"1": …}` and expects the row to be there. So a text-form line without
// `valueKeys` gets them from what it names, and its rows exist because it uses them.
import type { SavedGraph, SavedNode } from "./persistence";
import { ctorRegistry } from "./nodeCtorRegistry";

const ROW_KEY = /^([A-Za-z_]+?)(\d+)$/;
const isRowMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => /^\d+$/.test(k));

/** The `valueKeys` a line implies, or null where the card has no addable rows or already starts with every row named. */
function impliedValueKeys(sn: SavedNode, wired: readonly string[]): string[] | null {
  const Ctor = ctorRegistry().get(sn.type);
  if (!Ctor) return null;
  let inst: unknown;
  try { inst = new Ctor({ ...sn.init }); } catch { return null; }
  const card = inst as { inputs: Record<string, unknown>; addValueInput?: unknown; addValuePair?: unknown };
  if (typeof card.addValueInput !== "function" && typeof card.addValuePair !== "function") return null;
  const defaults = Object.keys(card.inputs);
  const prefixes = [...new Set(defaults.map((k) => ROW_KEY.exec(k)?.[1]).filter((p): p is string => p !== undefined))];
  if (prefixes.length === 0) return null;
  const rows = new Set(defaults.map((k) => ROW_KEY.exec(k)).filter((m) => m !== null).map((m) => Number(m[2])));
  const start = rows.size;
  const named = [...Object.keys(sn.literals ?? {}), ...Object.keys(sn.stringLiterals ?? {}), ...wired];
  for (const key of named) {
    const m = ROW_KEY.exec(key);
    if (m && prefixes.includes(m[1])) rows.add(Number(m[2]));
  }
  // A per-row setting (a filter's `condConfig`, a sort's `keyOrder`) is keyed by its row's number, and the card reads
  // it only for the rows `valueKeys` names.
  const rowMaps = Object.values(sn.init ?? {}).filter(isRowMap);
  for (const map of rowMaps) for (const n of Object.keys(map)) rows.add(Number(n));
  if (rows.size === start && rowMaps.length === 0) return null;
  const rowKeys = [...rows].sort((a, b) => a - b).flatMap((n) => prefixes.map((p) => `${p}${n}`));
  const firstRow = defaults.findIndex((k) => ROW_KEY.test(k) && prefixes.includes(ROW_KEY.exec(k)![1]));
  const fixed = defaults.filter((k) => !rowKeys.includes(k) && !(ROW_KEY.test(k) && prefixes.includes(ROW_KEY.exec(k)![1])));
  const extra = named.filter((k) => !ROW_KEY.test(k) && !defaults.includes(k));
  const keys = [...fixed.slice(0, firstRow), ...rowKeys, ...fixed.slice(firstRow), ...new Set(extra)];
  // Only where the card rebuilds every key the line names from them.
  try {
    const rebuilt = Object.keys((new Ctor({ ...sn.init, valueKeys: keys }) as unknown as { inputs: object }).inputs);
    if (!rowKeys.every((k) => rebuilt.includes(k))) return null;
  } catch { return null; }
  return keys;
}

/** The graph with every row a line names built: a card written without `valueKeys` takes the ones it implies. */
export function withImpliedRows(g: SavedGraph): SavedGraph {
  let changed = false;
  const nodes = g.nodes.map((sn) => {
    if (sn.init && "valueKeys" in sn.init) return sn;
    const wired = g.connections.filter((c) => c.target === sn.id).map((c) => c.targetInput);
    const keys = impliedValueKeys(sn, wired);
    if (!keys) return sn;
    changed = true;
    return { ...sn, init: { ...sn.init, valueKeys: keys } };
  });
  return changed ? { ...g, nodes } : g;
}
