import { ClassicPreset } from "rete";
import { numberSocket, listSocket, numListSocket, tableSocket, strTableSocket, dateTableSocket, anyTableSocket, anyComboSocket, stringSocket, strListSocket, strComboSocket, dateSocket, dateListSocket, dateComboSocket, complexSocket, complexListSocket, complexComboSocket, complexTableSocket, logicalSocket, logicalListSocket, logicalComboSocket, logicalTableSocket, frameSocket, cubeSocket, lambdaSocket, chartSocket, documentSocket, anySocket, trueAnySocket, AdoptiveSocket } from "../sockets";
import { resolveColor, paletteStore, type PaletteSlot } from "../palette";
import { type SolError } from "../errorValue";
import { cellShortCircuit, guardFinite, COMPUTE } from "../valueKinds";
import { type UnitCell, isUnitCell, magnitudeOf, tagDim, tagRatio } from "../unitValue";
import { dimOf } from "../unitValue";

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
// `any` = element-agnostic SCALAR; a true accept-anything port uses trueany below.
export const anyIn      = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("any"), label);
// ADOPTIVE trueany ports (the accept-anything default) take a fresh AdoptiveSocket
// each; the STATIC variants are only for a type that stays unknowable while wired.
export const trueAnyIn        = (label: string) => new ClassicPreset.Input(new AdoptiveSocket(), label);
export const trueAnyOut       = (label: string) => new ClassicPreset.Output(new AdoptiveSocket(), label);
// These ADOPT the wired cable's concrete type so the node can read the element
// family off the socket — the one thing values can't recover (a date serial is
// indistinguishable from a number).
export const adoptiveTableIn  = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anytable"), label);
export const adoptiveListIn   = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anylist"), label);
// Adoptive OUTPUTS for element-preserving ops: the output adopts the input's
// element type, so a reversed date list stays a date list downstream.
export const adoptiveTableOut = (label: string) => new ClassicPreset.Output(new AdoptiveSocket("anytable"), label);
export const adoptiveListOut  = (label: string) => new ClassicPreset.Output(new AdoptiveSocket("anylist"), label);
/** A NON-adoptive `trueany` output for a generative result whose type can't be
 *  derived from any input; an EXTRACTION uses `trueAnyOut` + `passthrough()`. */
export const staticTrueAnyOut = (label: string) => new ClassicPreset.Output(trueAnySocket, label);
// Adoption here is purely informative: acceptance is unchanged and coerceInputs
// treats an adopted concrete type identically to the neutral rung.
export const anyTableIn = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anytable"), label);
export const anyListIn  = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anylist"), label);
// `anycombo` accepts what `anyListIn` does, but a scalar reaches data() as a SCALAR
// instead of widening to a singleton — for a producer whose rank follows its input.
export const anyComboIn  = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anycombo"), label);
/** The rank-≤2 element-agnostic input (SOCK-9), adoptive like anyComboIn. */
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

// ─── Polyform result-type selector ────────────────────────────────────────────
// A polyform producer's element type can't be inferred from a runtime-polymorphic
// lambda, so the user declares it and the output socket swaps AT THE NODE'S OWN
// DIMENSIONALITY:
//
//   scalar  (REDUCE)               → number / string / date / any
//   combo   (Expression, BYROW/…)  → numlist / strcombo / datecombo / any
//   matrix  (MAP, MAKEARRAY)       → table / strtable / datetable / anytable
export type ResultType = "number" | "text" | "date" | "auto";
export type ResultDim = "scalar" | "combo" | "matrix";

export const RESULT_TYPE_META: Record<ResultType, { label: string; title: string }> = {
  number: { label: "Number", title: "Result is numeric, the default; matches Excel arithmetic" },
  text:   { label: "Text",   title: "Result is text: UPPER(x), TEXTJOIN(…), x & \" \" & y" },
  date:   { label: "Date",   title: "Result is a date (Excel serial): DATE(y,m,d), EDATE(x,1)" },
  auto:   { label: "Auto",   title: "Untyped: the wildcard socket accepts whatever the formula returns" },
};

const RESULT_SOCKETS: Record<ResultDim, Record<ResultType, ClassicPreset.Socket>> = {
  scalar: { number: numberSocket,  text: stringSocket,   date: dateSocket,        auto: anySocket },
  // combo/auto is anyCOMBO, not `any`: an Auto result IS a list whenever a list
  // variable broadcasts, and `any` would let it reach strict scalar inputs.
  combo:  { number: numListSocket, text: strComboSocket, date: dateComboSocket,   auto: anyComboSocket },
  matrix: { number: tableSocket,   text: strTableSocket, date: dateTableSocket,   auto: anyTableSocket },
};

/** The output socket a producer carries for a result type at its dimensionality —
 *  used both to build the port and to swap it in place. */
export function resultSocket(dim: ResultDim, t: ResultType): ClassicPreset.Socket {
  return RESULT_SOCKETS[dim][t];
}

/** Build the result output port for a producer node. */
export function resultOut(label: string, dim: ResultDim, t: ResultType): ClassicPreset.Output<ClassicPreset.Socket> {
  return new ClassicPreset.Output(resultSocket(dim, t), label);
}

// Read a slot distinguishing UNWIRED from a wired MISSING: a connected cable's
// value wins even when `null` and only `undefined` falls back to the literal, so
// the `inputs.x?.[0] ?? literal` idiom is wrong (`??` swallows a wired null).
export function readInput<T>(wired: readonly T[] | undefined, literal: T): T | null {
  return wired === undefined || wired.length === 0 ? literal : (wired[0] ?? null);
}

// A broadcaster's output: a scalar, a list whose cells may each carry a
// first-class `null`/`SolError`, or a whole-value short-circuit.
export type CellResult<T> = T | (T | SolError | null)[] | SolError | null;

/** The numeric broadcasters' output — `CellResult` at the number family. */
export type BroadcastResult = CellResult<number>;

export function broadcast(
  fn: (...xs: number[]) => number | null,
  // A scalar `null` (a wired MISSING) short-circuits per the per-cell contract.
  ...args: Array<number | number[] | null>
): BroadcastResult {
  const lists = args.filter((a): a is number[] => Array.isArray(a));
  if (lists.length === 0) {
    const sc = cellShortCircuit(args);
    if (sc !== COMPUTE) return sc;
    const r = fn(...(args as number[]));
    return r === null ? null : guardFinite(r, ...args);
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (number | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; }
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a));
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; }
    const r = fn(...(ops as number[]));
    out.push(r === null ? null : guardFinite(r, ...ops));
  }
  return out;
}

// Like `broadcast`, but the per-element fn may emit a tagged `SolError`, so a list
// carries per-cell errors and a scalar ÷0 reads identically to a list ÷0.
export function broadcastErr(
  fn: (...xs: number[]) => number | SolError | null,
  ...args: Array<number | number[] | null>
): BroadcastResult {
  const lists = args.filter((a): a is number[] => Array.isArray(a));
  if (lists.length === 0) {
    const sc = cellShortCircuit(args);
    if (sc !== COMPUTE) return sc;
    const r = fn(...(args as number[]));
    return typeof r === "number" ? guardFinite(r, ...args) : r;
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (number | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; }
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a));
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; }
    const r = fn(...(ops as number[]));
    out.push(typeof r === "number" ? guardFinite(r, ...ops) : r);
  }
  return out;
}

// ─── Element-agnostic broadcast (the non-numeric families' broadcaster) ─────────
// The number-typed broadcasters above can't take text, whose operands are MIXED and
// whose result is often another family; same ragged-zip and per-cell contract, with
// the element type opened up. Overloaded by ARITY so each call site keeps precise
// per-operand types. Element types are constrained to `Cell` because the list check
// is `Array.isArray` — an array-shaped element needs its own broadcaster.
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
    return typeof r === "number" ? guardFinite(r, ...args) : r;
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (Cell | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; }
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a));
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; }
    const r = call(...(ops as Cell[]));
    out.push(typeof r === "number" ? guardFinite(r, ...ops) : r);
  }
  return out;
}

// ─── Unit-aware broadcast ───────────────────────────────────────────────────────
// The dimensional twin of `broadcastErr`: the per-cell `fn` sees RAW
// `number | UnitCell` operands, and the plain-number path stays byte-identical to
// `broadcastErr` so an untagged graph is unaffected.
export type UnitOperand = number | UnitCell;
export type BroadcastUnitResult =
  number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null;

/** Classify a numeric-or-cell result: apply `guardFinite` to its magnitude (so an
 *  overflowing dimensioned product still becomes `#OVERFLOW!`), keeping the tag. */
function guardCell(r: number | UnitCell | SolError | null, ...inputs: unknown[]): number | UnitCell | SolError | null {
  if (r === null || typeof r === "string") return r;
  if (isUnitCell(r)) {
    const g = guardFinite(r.value, ...inputs);
    if (typeof g !== "number") return g;
    // Keep the RATIO brand — tagDim would collapse the empty-dim ratio cell to a
    // bare number, un-minting it.
    return r.ratio === true ? tagRatio(g) : tagDim(g, r.dim, r.display);
  }
  if (typeof r === "number") return guardFinite(r, ...inputs);
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
    return guardCell(fn(...(args as UnitOperand[])), ...args);
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (number | UnitCell | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; }
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a)) as UnitOperand[];
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; }
    out.push(guardCell(fn(...ops), ...ops));
  }
  return out;
}

/** True when any operand (scalar or a list cell) carries a real dimension — the
 *  cheap gate a unit-aware node uses to skip the unit path entirely for plain data. */
export function anyDimensioned(...args: Array<UnitOperand | UnitOperand[] | null>): boolean {
  for (const a of args) {
    if (Array.isArray(a)) { if (a.some((c) => isUnitCell(c))) return true; }
    else if (isUnitCell(a)) return true;
  }
  return false;
}

export { dimOf, magnitudeOf };

// ─── Node kind → header accent ─────────────────────────────────────────────────
// A kind is the node's FAMILY (what it does), distinct from socket type.

export type NodeKind = "input" | "math" | "convert" | "logic" | "list" | "lambda" | "util" | "display" | "string" | "date" | "complex" | "table" | "frame" | "format" | "boundary";

// A kind picks a palette SLOT, not a raw hex, so retuning a color in palette.ts
// moves every use of it together.
export const NODE_KIND_SLOTS: Record<NodeKind, PaletteSlot> = {
  input:   "amber",
  math:    "blue",
  convert: "teal",
  logic:   "purple",
  // A list is not a first-class socket type, so list nodes share the neutral gold.
  list:    "gold",
  lambda:  "green",
  util:    "gray",
  display: "gold",
  string:  "lime",      // text / string nodes (matches string socket)
  date:    "pink",      // date / time nodes (matches date socket)
  complex: "sky",       // complex number nodes (matches complex socket)
  table:   "gold",      // matches the table socket's gold matrix-shade
  frame:   "violet",    // matches frame socket
  format:  "gold",
  boundary: "green",    // green = "special"
};

// Kept LIVE by mutating in place: consumers index this object, so swapping the
// binding (or a const map) would freeze them at the startup palette.
export const NODE_KIND_ACCENTS: Record<NodeKind, string> = Object.fromEntries(
  (Object.entries(NODE_KIND_SLOTS) as [NodeKind, PaletteSlot][]).map(([k, slot]) => [k, resolveColor(slot)]),
) as Record<NodeKind, string>;

function refreshKindAccents() {
  for (const [k, slot] of Object.entries(NODE_KIND_SLOTS) as [NodeKind, PaletteSlot][]) {
    NODE_KIND_ACCENTS[k] = resolveColor(slot);
  }
}
paletteStore.subscribe(refreshKindAccents);

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  input:   "Input",
  math:    "Math",
  convert: "Convert",
  logic:   "Logic",
  list:    "List",
  lambda:  "Lambda",
  util:    "Utility",
  display: "Display",
  string:  "Text",
  date:    "Date",
  complex: "Complex",
  table:   "Table",
  frame:   "Frame",
  format:  "Format",
  boundary: "Boundary",
};
