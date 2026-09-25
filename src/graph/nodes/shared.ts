// [[D51]], [[D36]] nullSkippedNotZero (aggregators skip null)
import { ClassicPreset } from "rete";
import { numberSocket, listSocket, numListSocket, tableSocket, strTableSocket, dateTableSocket, anyTableSocket, anyComboSocket, stringSocket, strListSocket, strComboSocket, dateSocket, dateListSocket, dateComboSocket, complexSocket, complexListSocket, complexComboSocket, complexTableSocket, logicalSocket, logicalListSocket, logicalComboSocket, logicalTableSocket, frameSocket, cubeSocket, lambdaSocket, chartSocket, documentSocket, anySocket, trueAnySocket, AdoptiveSocket } from "../sockets";
import { resolveColor, paletteStore, type PaletteSlot } from "../palette";
import { type SolError } from "../errorValue";
import { cellShortCircuit, guardFinite, COMPUTE } from "../valueKinds";
import { type UnitCell, isUnitCell, magnitudeOf, tagDim, tagRatio } from "../unitValue";
import { dimOf } from "../unitValue";

export const BASIS_DOC = "Day-count basis: 0 = US 30/360, 1 = actual/actual, 2 = actual/360, 3 = actual/365, 4 = European 30/360.";

export const numIn      = (label: string) => new ClassicPreset.Input(numberSocket, label);
export const listIn     = (label: string) => new ClassicPreset.Input(listSocket, label);
export const numListIn  = (label: string) => new ClassicPreset.Input(numListSocket, label);
export const tableIn    = (label: string) => new ClassicPreset.Input(tableSocket, label);
export const strTableIn = (label: string) => new ClassicPreset.Input(strTableSocket, label);
export const dateTableIn= (label: string) => new ClassicPreset.Input(dateTableSocket, label);
export const strIn      = (label: string) => new ClassicPreset.Input(stringSocket,  label);
export const strListIn  = (label: string) => new ClassicPreset.Input(strListSocket, label);
export const dateIn     = (label: string) => new ClassicPreset.Input(dateSocket,    label);
export const dateListIn = (label: string) => new ClassicPreset.Input(dateListSocket,label);
export const anyIn      = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("any"), label);
export const trueAnyIn        = (label: string) => new ClassicPreset.Input(new AdoptiveSocket(), label);
export const trueAnyOut       = (label: string) => new ClassicPreset.Output(new AdoptiveSocket(), label);
export const adoptiveTableIn  = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anytable"), label);
export const adoptiveListIn   = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anylist"), label);
export const adoptiveTableOut = (label: string) => new ClassicPreset.Output(new AdoptiveSocket("anytable"), label);
export const adoptiveListOut  = (label: string) => new ClassicPreset.Output(new AdoptiveSocket("anylist"), label);
export const adoptiveDataOut  = (label: string) => new ClassicPreset.Output(new AdoptiveSocket("anydata"), label);
/** Never adopts: only for a generative result no input types; an extraction uses `trueAnyOut` plus `passthrough()`. */
export const staticTrueAnyOut = (label: string) => new ClassicPreset.Output(trueAnySocket, label);
export const cubeAdoptIn  = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("cube"), label);
export const tableAdoptOut = (label: string) => new ClassicPreset.Output(new AdoptiveSocket("frame"), label);
export const anyTableIn = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anytable"), label);
export const anyListIn  = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anylist"), label);
export const anyComboIn  = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anycombo"), label);
export const anyDataIn   = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anydata"), label);
export const anyComboOut = (label: string) => new ClassicPreset.Output(anyComboSocket, label);
export const numOut     = (label: string) => new ClassicPreset.Output(numberSocket,  label);
export const listOut    = (label: string) => new ClassicPreset.Output(listSocket,    label);
export const numListOut = (label: string) => new ClassicPreset.Output(numListSocket, label);
export const tableOut   = (label: string) => new ClassicPreset.Output(tableSocket,   label);
export const strTableOut = (label: string) => new ClassicPreset.Output(strTableSocket, label);
export const dateTableOut= (label: string) => new ClassicPreset.Output(dateTableSocket,label);
export const strOut     = (label: string) => new ClassicPreset.Output(stringSocket,  label);
export const strListOut = (label: string) => new ClassicPreset.Output(strListSocket, label);
export const dateOut      = (label: string) => new ClassicPreset.Output(dateSocket,    label);
export const dateListOut  = (label: string) => new ClassicPreset.Output(dateListSocket,label);
export const strComboIn   = (label: string) => new ClassicPreset.Input(strComboSocket,   label);
export const strComboOut  = (label: string) => new ClassicPreset.Output(strComboSocket,  label);
export const dateComboIn  = (label: string) => new ClassicPreset.Input(dateComboSocket,  label);
export const dateComboOut = (label: string) => new ClassicPreset.Output(dateComboSocket, label);
export const complexIn    = (label: string) => new ClassicPreset.Input(complexSocket,  label);
export const complexOut   = (label: string) => new ClassicPreset.Output(complexSocket, label);
export const complexListIn  = (label: string) => new ClassicPreset.Input(complexListSocket,  label);
export const complexListOut = (label: string) => new ClassicPreset.Output(complexListSocket, label);
export const complexComboIn  = (label: string) => new ClassicPreset.Input(complexComboSocket,  label);
export const complexComboOut = (label: string) => new ClassicPreset.Output(complexComboSocket, label);
export const complexTableIn  = (label: string) => new ClassicPreset.Input(complexTableSocket,  label);
export const complexTableOut = (label: string) => new ClassicPreset.Output(complexTableSocket, label);
export const logicalIn       = (label: string) => new ClassicPreset.Input(logicalSocket,  label);
export const logicalOut      = (label: string) => new ClassicPreset.Output(logicalSocket, label);
export const logicalListIn   = (label: string) => new ClassicPreset.Input(logicalListSocket,  label);
export const logicalListOut  = (label: string) => new ClassicPreset.Output(logicalListSocket, label);
export const logicalComboIn  = (label: string) => new ClassicPreset.Input(logicalComboSocket,  label);
export const logicalComboOut = (label: string) => new ClassicPreset.Output(logicalComboSocket, label);
export const logicalTableOut = (label: string) => new ClassicPreset.Output(logicalTableSocket, label);
export const frameIn      = (label: string) => new ClassicPreset.Input(frameSocket,   label);
export const frameOut     = (label: string) => new ClassicPreset.Output(frameSocket,  label);
export const cubeIn       = (label: string) => new ClassicPreset.Input(cubeSocket,    label);
export const cubeOut      = (label: string) => new ClassicPreset.Output(cubeSocket,   label);
export const lambdaIn     = (label: string) => new ClassicPreset.Input(lambdaSocket,  label);
export const lambdaOut    = (label: string) => new ClassicPreset.Output(lambdaSocket, label);
export const chartIn      = (label: string) => new ClassicPreset.Input(chartSocket,   label);
export const chartOut     = (label: string) => new ClassicPreset.Output(chartSocket,  label);
export const documentIn   = (label: string) => new ClassicPreset.Input(documentSocket, label);
export const documentOut  = (label: string) => new ClassicPreset.Output(documentSocket, label);

export type ResultType = "number" | "text" | "date" | "auto";
export type ResultDim = "scalar" | "combo" | "matrix";

export const RESULT_TYPE_META: Record<ResultType, { label: string; title: string }> = {
  number: { label: "Number", title: "The result is a number, the default" },
  text:   { label: "Text",   title: "The result is text, like UPPER(x) or x & \" \" & y" },
  date:   { label: "Date",   title: "The result is a date, like DATE(y,m,d) or EDATE(x,1)" },
  auto:   { label: "Auto",   title: "The result takes whatever type the formula returns" },
};

const RESULT_SOCKETS: Record<ResultDim, Record<ResultType, ClassicPreset.Socket>> = {
  scalar: { number: numberSocket,  text: stringSocket,   date: dateSocket,        auto: anySocket },
  combo:  { number: numListSocket, text: strComboSocket, date: dateComboSocket,   auto: anyComboSocket },
  matrix: { number: tableSocket,   text: strTableSocket, date: dateTableSocket,   auto: anyTableSocket },
};

export function resultSocket(dim: ResultDim, t: ResultType): ClassicPreset.Socket {
  return RESULT_SOCKETS[dim][t];
}

export function resultOut(label: string, dim: ResultDim, t: ResultType): ClassicPreset.Output<ClassicPreset.Socket> {
  return new ClassicPreset.Output(resultSocket(dim, t), label);
}

/** Re-seats a fixed input after a grown row, so the live key order is the one a reload rebuilds. */
export function keepInputLast(node: ClassicPreset.Node, key: string): void {
  const input = node.inputs[key];
  if (!input) return;
  delete node.inputs[key];
  node.inputs[key] = input;
}

export function readInput<T>(wired: readonly T[] | undefined, literal: T): T | null {
  return wired === undefined || wired.length === 0 ? literal : (wired[0] ?? null);
}

export type CellResult<T> = T | (T | SolError | null)[] | SolError | null;

export type BroadcastResult = CellResult<number>;

export function broadcast(
  fn: (...xs: number[]) => number | null,
  ...args: Array<number | number[] | null>
): BroadcastResult {
  const lists = args.filter((a): a is number[] => Array.isArray(a));
  if (lists.length === 0) {
    const sc = cellShortCircuit(args);
    if (sc !== COMPUTE) return sc;
    const r = fn(...(args as number[]));
    return r === null ? null : guardFinite(r, args);
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (number | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; }
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a));
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; }
    const r = fn(...(ops as number[]));
    out.push(r === null ? null : guardFinite(r, ops));
  }
  return out;
}

export function broadcastErr(
  fn: (...xs: number[]) => number | SolError | null,
  ...args: Array<number | number[] | null>
): BroadcastResult {
  const lists = args.filter((a): a is number[] => Array.isArray(a));
  if (lists.length === 0) {
    const sc = cellShortCircuit(args);
    if (sc !== COMPUTE) return sc;
    const r = fn(...(args as number[]));
    return typeof r === "number" ? guardFinite(r, args) : r;
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (number | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; }
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a));
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; }
    const r = fn(...(ops as number[]));
    out.push(typeof r === "number" ? guardFinite(r, ops) : r);
  }
  return out;
}

// No array-shaped element: the list check is `Array.isArray`, so such an element needs its own broadcaster.
type Cell = string | number | boolean;

export function broadcastCells<A extends Cell, R extends Cell>(
  fn: (a: A) => R | SolError | null,
  a: A | A[] | null,
): CellResult<R>;
export function broadcastCells<A extends Cell, B extends Cell, R extends Cell>(
  fn: (a: A, b: B) => R | SolError | null,
  a: A | A[] | null, b: B | B[] | null,
): CellResult<R>;
export function broadcastCells<A extends Cell, B extends Cell, C extends Cell, R extends Cell>(
  fn: (a: A, b: B, c: C) => R | SolError | null,
  a: A | A[] | null, b: B | B[] | null, c: C | C[] | null,
): CellResult<R>;
export function broadcastCells<A extends Cell, B extends Cell, C extends Cell, D extends Cell, R extends Cell>(
  fn: (a: A, b: B, c: C, d: D) => R | SolError | null,
  a: A | A[] | null, b: B | B[] | null, c: C | C[] | null, d: D | D[] | null,
): CellResult<R>;
export function broadcastCells(
  fn: (...xs: never[]) => Cell | SolError | null,
  ...args: Array<Cell | Cell[] | null>
): CellResult<Cell> {
  const call = fn as (...xs: Cell[]) => Cell | SolError | null;
  const lists = args.filter((a): a is Cell[] => Array.isArray(a));
  if (lists.length === 0) {
    const sc = cellShortCircuit(args);
    if (sc !== COMPUTE) return sc;
    const r = call(...(args as Cell[]));
    return typeof r === "number" ? guardFinite(r, args) : r;
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (Cell | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; }
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a));
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; }
    const r = call(...(ops as Cell[]));
    out.push(typeof r === "number" ? guardFinite(r, ops) : r);
  }
  return out;
}

export type UnitOperand = number | UnitCell;
export type BroadcastUnitResult =
  number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null;

function guardCell(r: number | UnitCell | SolError | null, inputs: ReadonlyArray<unknown>): number | UnitCell | SolError | null {
  if (r === null || typeof r === "string") return r;
  if (isUnitCell(r)) {
    const g = guardFinite(r.value, inputs);
    if (typeof g !== "number") return g;
    // tagDim would collapse an empty-dim ratio cell to a bare number, so re-mint the ratio.
    return r.ratio === true ? tagRatio(g) : tagDim(g, r.dim, r.display);
  }
  if (typeof r === "number") return guardFinite(r, inputs);
  return r;
}

export function broadcastUnit(
  fn: (...xs: UnitOperand[]) => number | UnitCell | SolError | null,
  ...args: Array<UnitOperand | UnitOperand[] | null>
): BroadcastUnitResult {
  const lists = args.filter((a): a is UnitOperand[] => Array.isArray(a));
  if (lists.length === 0) {
    const sc = cellShortCircuit(args);
    if (sc !== COMPUTE) return sc;
    return guardCell(fn(...(args as UnitOperand[])), args);
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (number | UnitCell | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; }
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a)) as UnitOperand[];
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; }
    out.push(guardCell(fn(...ops), ops));
  }
  return out;
}

export function anyDimensioned(...args: Array<UnitOperand | UnitOperand[] | null>): boolean {
  for (const a of args) {
    if (Array.isArray(a)) { if (a.some((c) => isUnitCell(c))) return true; }
    else if (isUnitCell(a)) return true;
  }
  return false;
}

export { dimOf, magnitudeOf };


export type NodeKind = "input" | "math" | "convert" | "logic" | "list" | "lambda" | "util" | "string" | "date" | "complex" | "table" | "frame" | "format" | "boundary" | "chart" | "document";

export const NODE_KIND_SLOTS: Record<NodeKind, PaletteSlot> = {
  input:   "amber",
  math:    "blue",
  convert: "teal",
  logic:   "purple",
  list:    "gold",
  lambda:  "green",
  util:    "gray",
  chart:   "green",
  string:  "lime",
  date:    "pink",
  complex: "sky",
  table:   "gold",
  frame:   "violet",
  format:  "gold",
  boundary: "green",
  document: "green",
};

// Refreshed by mutating in place; replacing the object would freeze consumers at the startup palette.
export const NODE_KIND_ACCENTS: Record<NodeKind, string> = Object.fromEntries(
  (Object.entries(NODE_KIND_SLOTS) as [NodeKind, PaletteSlot][]).map(([k, slot]) => [k, resolveColor(slot)]),
) as Record<NodeKind, string>;

function refreshKindAccents() {
  for (const [k, slot] of Object.entries(NODE_KIND_SLOTS) as [NodeKind, PaletteSlot][]) {
    NODE_KIND_ACCENTS[k] = resolveColor(slot);
  }
}
paletteStore.subscribe(refreshKindAccents);
