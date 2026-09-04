// A display annotation, distinct from the column's UNIT (a VALUE property that flows).
// Keyed `${nodeId}::${columnName}`, so it survives column reorders but follows the name.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { FORMAT_STYLE_LABELS, LOGICAL_STYLE_LABELS, TEXT_CASE_LABELS, type FormatAnnotation, type FormatStyle } from "./formatAnnotationStore";
import { precisionApplies } from "./formatModel";
import type { FrameColType } from "./frame";

/** The annotation's `unit` field is ignored — a column's unit is its value's. */
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

  serialize(): FrameColumnFormat[] {
    return [..._store.values()].map((v) => ({ ...v, ann: { ...v.ann } }));
  },
  /** Replaces the set; the caller has already rewritten nodeIds after id-remapping. */
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

/** The style dropdown's state for one column of the table popup's format row. */
export interface ColumnFormatRow {
  /** The dropdown's current value; `""` is the INHERIT pick (no local entry). */
  value: string;
  /** What the column carries in, e.g. `← Decimal · 3 places`; absent when nothing does. */
  hint?: string;
}

function styleValueOf(ann: FormatAnnotation, type: FrameColType): string {
  if (type === "logical") return ann.logicalStyle ?? "truefalse";
  if (type === "string") return ann.textCase ?? "none";
  return ann.format;
}

function describeAnnotation(ann: FormatAnnotation, type: FrameColType): string {
  if (type === "logical") return LOGICAL_STYLE_LABELS[ann.logicalStyle ?? "truefalse"];
  if (type === "string") return TEXT_CASE_LABELS[ann.textCase ?? "none"];
  const label = FORMAT_STYLE_LABELS[ann.format as FormatStyle] ?? ann.format;
  if (!precisionApplies(ann.format)) return label;
  const d = ann.decimalDigits ?? 2;
  const noun = ann.decimalMode === "sigfigs" ? "sig fig" : "place";
  return `${label} · ${d} ${noun}${d === 1 ? "" : "s"}`;
}

/** No local entry means INHERIT: the dropdown reads blank and the hint names what
 *  arrived, so an upstream format is never silently replaced by a look-alike pick
 *  (rules formatFlowsDownstream). */
export function columnFormatRow(
  local: FormatAnnotation | undefined,
  inherited: FormatAnnotation | undefined,
  type: FrameColType = "number",
): ColumnFormatRow {
  if (local) return { value: styleValueOf(local, type) };
  return inherited ? { value: "", hint: `← ${describeAnnotation(inherited, type)}` } : { value: "" };
}
