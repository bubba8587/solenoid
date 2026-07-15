// Per-column frame FORMAT — a display annotation (number format / precision /
// grouping / negatives / scale) a user sets on ONE column of ONE frame node, the
// frame analog of the Format Controller. Like the FC's format it PERSISTS (in
// SavedGraph, see persistence.ts) and applies at that node's frame display —
// distinct from the column's UNIT, which is a VALUE property that flows (FrameColumn
// .unit). Module-level store (Rete renders in a separate React root; keyed
// `${nodeId}::${columnName}` so it survives column reorders but follows the name.
//
// Same shape as commentStore / pinStore: an additive optional field in SavedGraph,
// hydrated on load, serialized on save, cleared when its node is forgotten.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import type { FormatAnnotation } from "./formatAnnotationStore";

/** One persisted per-column format: which node, which column (by name), the
 *  annotation (the `unit` field is ignored — a column's unit is its value's, not a
 *  format). */
export interface FrameColumnFormat {
  nodeId: string;
  column: string;
  ann: FormatAnnotation;
}

function key(nodeId: string, column: string): string {
  return `${nodeId}::${column}`;
}

const _store = new Map<string, FrameColumnFormat>();
const { notify, subscribe, version } = createNotifier();

export const frameFormatStore = {
  get(nodeId: string, column: string): FormatAnnotation | undefined {
    return _store.get(key(nodeId, column))?.ann;
  },
  /** Every column format on a node (the popup seeds its per-column dropdowns). */
  forNode(nodeId: string): Map<string, FormatAnnotation> {
    const out = new Map<string, FormatAnnotation>();
    for (const v of _store.values()) if (v.nodeId === nodeId) out.set(v.column, v.ann);
    return out;
  },
  set(nodeId: string, column: string, ann: FormatAnnotation): void {
    _store.set(key(nodeId, column), { nodeId, column, ann });
    notify();
  },
  delete(nodeId: string, column: string): void {
    if (_store.delete(key(nodeId, column))) notify();
  },
  removeForNode(nodeId: string): void {
    let changed = false;
    for (const [k, v] of _store) if (v.nodeId === nodeId) { _store.delete(k); changed = true; }
    if (changed) notify();
  },
  clear(): void {
    if (_store.size > 0) { _store.clear(); notify(); }
  },

  /** Serialize for SavedGraph. */
  serialize(): FrameColumnFormat[] {
    return [..._store.values()].map((v) => ({ ...v, ann: { ...v.ann } }));
  },
  /** Replace the set (loadGraph, after id-remapping — the caller rewrites nodeId). */
  load(list: FrameColumnFormat[]): void {
    _store.clear();
    for (const v of list) _store.set(key(v.nodeId, v.column), { ...v, ann: { ...v.ann } });
    notify();
  },

  subscribe,
  version,
};

registerNodeForget((nodeId) => frameFormatStore.removeForNode(nodeId));
registerNodeForgetAll(() => frameFormatStore.clear());
