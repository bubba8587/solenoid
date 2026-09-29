// [[D41]] formatFlowsDownstream

import { createNotifier } from "./storeKit";
import { settingsStore } from "./settingsStore";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { FORMAT_STYLE_LABELS, LOGICAL_STYLE_LABELS, TEXT_CASE_LABELS, type FormatAnnotation, type FormatStyle } from "./formatAnnotationStore";
import { precisionApplies } from "./formatModel";
import type { FrameColType } from "./frame";
import { DEFAULT_DATE_FORMAT } from "./nodes/dateSerial";

/** The annotation's `unit` field is ignored — a column's unit is its value's. */
export interface FrameColumnFormat {
  nodeId: string;
  column: string;
  ann: FormatAnnotation;
}

/** The key a matrix popup's one format pick is stored under. */
export const MATRIX_FORMAT_KEY = "*";

function key(nodeId: string, column: string): string {
  return `${nodeId}::${column}`;
}

const _store = new Map<string, FrameColumnFormat>();
const { notify, subscribe, version } = createNotifier();

// A new "Decimal places" setting redraws every value shown through this store ([[D94]] oneNumberDisplay).
let _decimals = settingsStore.get("numberDecimals");
settingsStore.subscribe(() => {
  const d = settingsStore.get("numberDecimals");
  if (d !== _decimals) { _decimals = d; notify(); }
});

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
  /** Moves each column's format from its name at position i in `from` to the name at i in `to`, and drops the formats of names that left. */
  rekey(nodeId: string, from: ReadonlyArray<string | undefined>, to: ReadonlyArray<string>): void {
    const moved = from.map((name, i) =>
      name !== undefined && to[i] !== undefined && name !== to[i] ? _store.get(key(nodeId, name))?.ann : undefined);
    const kept = new Set(to);
    let changed = false;
    for (const name of from) {
      if (name !== undefined && !kept.has(name) && _store.delete(key(nodeId, name))) changed = true;
    }
    from.forEach((name, i) => {
      const next = to[i];
      if (name === undefined || next === undefined || name === next) return;
      const ann = moved[i];
      if (ann) { _store.set(key(nodeId, next), { nodeId, column: next, ann }); changed = true; }
      else if (_store.delete(key(nodeId, next))) changed = true;
    });
    if (changed) notify();
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
  /** Adds loaded formats; the caller has already rewritten nodeIds after id-remapping. */
  merge(list: FrameColumnFormat[]): void {
    if (list.length === 0) return;
    for (const v of list) _store.set(key(v.nodeId, v.column), { ...v, ann: { ...v.ann } });
    notify();
  },

  subscribe,
  version,
};

registerNodeForget((nodeId) => frameFormatStore.removeForNode(nodeId));
registerNodeForgetAll(() => frameFormatStore.clear());

export interface ColumnFormatRow {
  value: string;
  hint?: string;
  /** The pattern box under a Custom pick: its text, and whether it reads as a date pattern. */
  pattern?: { text: string; date: boolean };
}

const DEFAULT_NUMBER_PATTERN = "0.00";

/** A Custom style's pattern, the one it renders with when none was typed. */
function patternOf(ann: FormatAnnotation): { text: string; date: boolean } | undefined {
  if (ann.format === "custom") return { text: ann.customPattern || DEFAULT_NUMBER_PATTERN, date: false };
  if (ann.format === "date_custom") return { text: ann.customPattern || DEFAULT_DATE_FORMAT, date: true };
  return undefined;
}

function styleValueOf(ann: FormatAnnotation, type: FrameColType): string {
  if (type === "logical") return ann.logicalStyle ?? "truefalse";
  if (type === "string") return ann.chip ? "chip" : (ann.textCase ?? "none");
  return ann.format;
}

export function describeAnnotation(ann: FormatAnnotation, type: FrameColType): string {
  if (type === "logical") return LOGICAL_STYLE_LABELS[ann.logicalStyle ?? "truefalse"];
  if (type === "string") return ann.chip ? "Chip" : TEXT_CASE_LABELS[ann.textCase ?? "none"];
  const label = FORMAT_STYLE_LABELS[ann.format as FormatStyle] ?? ann.format;
  const pattern = patternOf(ann);
  if (pattern) return `${label.replace(/…$/, "")} · ${pattern.text}`;
  if (!precisionApplies(ann.format)) return label;
  const d = ann.decimalDigits ?? 2;
  const noun = ann.decimalMode === "sigfigs" ? "sig fig" : "place";
  return `${label} · ${d} ${noun}${d === 1 ? "" : "s"}`;
}

export function columnFormatRow(
  local: FormatAnnotation | undefined,
  inherited: FormatAnnotation | undefined,
  type: FrameColType = "number",
): ColumnFormatRow {
  if (local) {
    const pattern = type === "number" || type === "date" ? patternOf(local) : undefined;
    return { value: styleValueOf(local, type), ...(pattern ? { pattern } : {}) };
  }
  return inherited ? { value: "", hint: `← ${describeAnnotation(inherited, type)}` } : { value: "" };
}
