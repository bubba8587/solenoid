import { ClassicPreset } from "rete";
import { numberSocket, listSocket, numListSocket, tableSocket, strTableSocket, dateTableSocket, anyTableSocket, anyComboSocket, stringSocket, strListSocket, strComboSocket, dateSocket, dateListSocket, dateComboSocket, complexSocket, complexListSocket, complexComboSocket, complexTableSocket, logicalSocket, logicalListSocket, logicalComboSocket, logicalTableSocket, frameSocket, cubeSocket, lambdaSocket, chartSocket, documentSocket, anySocket, trueAnySocket, AdoptiveSocket } from "../sockets";
import { resolveColor, paletteStore, type PaletteSlot } from "../palette";
import { type SolError } from "../errorValue";
import { cellShortCircuit, guardFinite, COMPUTE } from "../valueKinds";
import { type UnitCell, isUnitCell, magnitudeOf, tagDim, tagRatio } from "../unitValue";
import { dimOf } from "../unitValue";

// Socket-typed port factories. `new ClassicPreset.Input(numberSocket, "A")`
// repeated across ~60 constructor lines is just noise; these name the
// socket type and keep node constructors to one readable line per port.
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
// `any` = element-agnostic SCALAR (a single value of any family). For a true
// accept-anything port (containers + object family) use the adoptive/trueany
// factories below.
export const anyIn      = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("any"), label); // adoptive: colors to the wired type (see anyTableIn note below)
// ADOPTIVE trueany ports (the default for accept-anything): a fresh
// AdoptiveSocket per port — it adopts the wired cable's type and reverts to the
// hollow trueany on disconnect (reconcileTrueAnyTypes). Use the STATIC variants
// only for a port whose type genuinely stays unknowable while wired (INDEX /
// XLOOKUP results — the value's type varies per row/column).
export const trueAnyIn        = (label: string) => new ClassicPreset.Input(new AdoptiveSocket(), label);
export const trueAnyOut       = (label: string) => new ClassicPreset.Output(new AdoptiveSocket(), label);
// Adoptive matrix / list inputs: accept any element family (like anyTableIn /
// anyListIn) but ADOPT the wired cable's concrete type, so the consuming node can
// read its element family off the socket — the one thing values can't recover (a
// date serial is indistinguishable from a number). Build Frame / Frame from Lists
// use these to type frame columns by the incoming matrix/list, dates included.
export const adoptiveTableIn  = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anytable"), label);
export const adoptiveListIn   = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anylist"), label);
// Adoptive OUTPUTS for element-preserving, same-rank agnostic ops (Reverse,
// TRANSPOSE, CHOOSEROWS…): the op forwards its input's element type unchanged, so its
// output adopts that type (via settleWildcardTypes + a passthrough() decl) — a
// reversed date list stays a date list downstream, not a neutral `anylist`.
export const adoptiveTableOut = (label: string) => new ClassicPreset.Output(new AdoptiveSocket("anytable"), label);
export const adoptiveListOut  = (label: string) => new ClassicPreset.Output(new AdoptiveSocket("anylist"), label);
/** A NON-adoptive `trueany` output — the shared singleton, so it never takes a type.
 *  For a genuinely generative result whose type can't be derived from any input
 *  (XLOOKUP, whose cell type varies per row). An EXTRACTION uses `trueAnyOut` + a
 *  `passthrough()` with `project` instead; see INDEX. There is no static trueany INPUT
 *  — every element-agnostic input adopts, so it can color to the wired cable.  */
export const staticTrueAnyOut = (label: string) => new ClassicPreset.Output(trueAnySocket, label);
// Element-agnostic INPUTS (any / anylist / anytable) are ADOPTIVE (2026-07-15): they
// accept any element family (a lower-rank value widens IN, as before) AND color the
// dot to the wired cable's concrete type, reverting to the neutral rung on disconnect
// (settleWildcardTypes). Purely informative — acceptance is unchanged (the base rung),
// and coerceInputs treats the adopted concrete type identically to the neutral one for
// these (verified by the full suite). anyTableIn = 2-D (TRANSPOSE/HSTACK/reshape/MAP),
// anyListIn = 1-D (Set/position ops), anyIn = scalar.
export const anyTableIn = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anytable"), label);
export const anyListIn  = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anylist"), label);
// `anycombo` — the element-agnostic COMBO: accepts what `anyListIn` accepts, but a
// scalar reaches data() as a SCALAR instead of widening to a singleton. The port for a
// producer whose result rank follows its input (Expression's formula variables) or its
// op (Regex). Before this rung existed, the same effect needed the `noWidenInputs`
// side-channel, which overrode the socket rather than being expressed by it.
export const anyComboIn  = (label: string) => new ClassicPreset.Input(new AdoptiveSocket("anycombo"), label);
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
// The value-polymorphic formula producers (Expression, BYROW/BYCOL, REDUCE, MAP,
// MAKEARRAY) loop ANY Excel function over their inputs (see excelFormula.ts +
// the polymorphic broadcast below). Their output element type can't be inferred
// from a runtime-polymorphic lambda, so the user declares it; the choice swaps
// the output socket to the matching type AT THE NODE'S OWN DIMENSIONALITY so
// downstream type-checking stays honest. `auto` falls back to the untyped
// wildcard at the right rank: `any` for scalar/combo (a combo may be a scalar,
// and only `any` keeps the scalar path open), `anytable` for the 2-D producers.
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
  combo:  { number: numListSocket, text: strComboSocket, date: dateComboSocket,   auto: anySocket },
  matrix: { number: tableSocket,   text: strTableSocket, date: dateTableSocket,   auto: anyTableSocket },
};

/** The output socket a producer should carry for a chosen result type at its
 *  dimensionality level. Used both to build the port and to swap it in place
 *  (see the apply* helpers in components/polyformEdit.ts). */
export function resultSocket(dim: ResultDim, t: ResultType): ClassicPreset.Socket {
  return RESULT_SOCKETS[dim][t];
}

/** Build the result output port for a producer node. */
export function resultOut(label: string, dim: ResultDim, t: ResultType): ClassicPreset.Output<ClassicPreset.Socket> {
  return new ClassicPreset.Output(resultSocket(dim, t), label);
}

// Apply `fn` element-wise when any argument is a list (broadcasting any
// scalar args against it), else apply once. Powers the list-aware ("Map")
// behavior of element-wise nodes via the flexible `numlist` socket. An
// invalid element (fn → null) becomes NaN within a result list. Ragged lists
// zip to the LONGEST length: a position missing from a shorter list emits a
// first-class `null` (missing) in the result, without calling `fn` — the
// pad-to-longest policy settled with the array-semantics build. The result
// list therefore carries nulls at runtime; the `number[]` return type follows
// the node layer's loose-list convention (lists carry null/SolError cells).
// Read a scalar/list input slot, distinguishing UNWIRED from a wired MISSING.
// The `inputs.x?.[0] ?? this.literals.x` idiom is subtly wrong: `??` swallows a
// WIRED `null` into the literal, so a blank/missing cell flowing in silently
// becomes whatever number sits in the box (the settled P6 SQL-null model says it
// should PROPAGATE — null in → null out; Fill/Coalesce is the opt-in recovery).
// The rule: a CONNECTED cable's value wins even when it's `null`; only an unwired
// slot (`undefined`) falls back to the literal. Returns `T | null` so a `!== null`
// guard (or a broadcaster, which now short-circuits missing per cell) can act on
// the propagated missing.
export function readInput<T>(wired: readonly T[] | undefined, literal: T): T | null {
  return wired === undefined || wired.length === 0 ? literal : (wired[0] ?? null);
}

// A broadcaster's output for element type T: a scalar, or a list whose cells may
// each carry a first-class `null` (missing) or `SolError` (per the per-cell
// contract), or a whole-value short-circuit (scalar error/missing). The node
// layer's loose-list convention — lists carry null/SolError cells at runtime.
export type CellResult<T> = T | (T | SolError | null)[] | SolError | null;

/** The numeric broadcasters' output — `CellResult` at the number family. */
export type BroadcastResult = CellResult<number>;

export function broadcast(
  fn: (...xs: number[]) => number | null,
  // Args may be a scalar `null` (a wired MISSING read via `readInput`); the per-cell
  // contract short-circuits it, so callers pass it straight through.
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
    if (sc !== COMPUTE) { out.push(sc); continue; } // error / missing propagates
    const r = fn(...(ops as number[]));
    out.push(r === null ? null : guardFinite(r, ...ops)); // classify a non-finite result
  }
  return out;
}

// Like `broadcast`, but the per-element fn may emit a tagged `SolError` for a bad
// element (e.g. ÷0 → #DIV/0!). Array-semantics build: a list carries per-cell
// errors instead of collapsing a bad cell to NaN/null, so a scalar ÷0 and a
// list ÷0 read identically (#DIV/0! either way). At scalar level it just returns
// fn's value (number | SolError | null). Use this over `broadcast` whenever the
// element op has a genuine error case (vs a domain-`null` blank).
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
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; } // ragged pad
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a));
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; } // error / missing propagates
    const r = fn(...(ops as number[]));
    out.push(typeof r === "number" ? guardFinite(r, ...ops) : r); // classify a non-finite result
  }
  return out;
}

// ─── Element-agnostic broadcast (the non-numeric families' broadcaster) ─────────
// `broadcast`/`broadcastErr` are typed to numbers, which works for the number and
// date families (a date serial IS a number) but not for text: a text op's operands
// are MIXED (LEFT takes the text AND a count) and its result is often a different
// family than its input (LEN: string → number, EXACT: string → boolean). This is
// the same broadcaster with the element type opened up — identical ragged-zip and
// per-cell error/missing contract, so a text node broadcasts exactly like ADD.
//
// Overloaded by ARITY so each call site keeps precise per-operand types
// (`broadcastCells((t: string, n: number) => …, text, n)` infers both); the
// implementation is one loose body. A numeric result still runs `guardFinite`, so
// a computed NaN/∞ classifies into a tagged error just as in the numeric path.
//
// Element types are constrained to `Cell` (string | number | boolean) because the
// list check is `Array.isArray` — an element that is ITSELF an array can't be told
// apart from a list of them. That's why the complex family (a value is `[re, im]`)
// carries its OWN broadcaster instead: `broadcastComplex` in nodes/complex.ts, with
// an exact shape test and per-operand tags. Reach for that one, not this, if a
// future element type is array-shaped.
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
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; } // ragged pad
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a));
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; } // error / missing propagates
    const r = call(...(ops as Cell[]));
    out.push(typeof r === "number" ? guardFinite(r, ...ops) : r); // classify a non-finite result
  }
  return out;
}

// ─── Unit-aware broadcast (Bundle 05: FC A4, step 2) ────────────────────────────
// The dimensional twin of `broadcastErr`. Operands are `number | UnitCell` (a bare
// number is dimensionless); the per-cell `fn` receives the RAW operands and returns
// a tagged cell (a `UnitCell` when the result carries a dimension, a bare number
// when dimensionless), a `SolError` (`#UNIT!` on a dimensional mismatch, `#DIV/0!`,
// …), or `null`. The plain-number fast path is byte-identical to `broadcastErr`
// (no `UnitCell` anywhere ⇒ `fn` sees plain numbers, `guardFinite` classifies a
// non-finite result), so an untagged graph is unaffected. Only once a value carries
// a dimension does the unit algebra bite.
export type UnitOperand = number | UnitCell;
export type BroadcastUnitResult =
  number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null;

/** Classify a numeric-or-cell result: apply `guardFinite` to its magnitude (so an
 *  overflowing dimensioned product still becomes `#OVERFLOW!`), keeping the tag. */
function guardCell(r: number | UnitCell | SolError | null, ...inputs: unknown[]): number | UnitCell | SolError | null {
  if (r === null || typeof r === "string") return r;
  if (isUnitCell(r)) {
    const g = guardFinite(r.value, ...inputs);
    if (typeof g !== "number") return g; // surface the error
    // Re-tag, keeping the display — and the RATIO brand (tagDim would collapse the
    // empty-dim ratio cell to a bare number, un-minting it).
    return r.ratio === true ? tagRatio(g) : tagDim(g, r.dim, r.display);
  }
  if (typeof r === "number") return guardFinite(r, ...inputs);
  return r; // a SolError from fn passes through
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
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; } // ragged pad
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

// Re-export the per-cell primitives so unit-aware nodes import them from one place.
export { dimOf, magnitudeOf };

// ─── Node kind → header accent ─────────────────────────────────────────────────
// A node's "kind" is its family (what it does), distinct from socket
// type (what flows through it). Drives the colored header bar, and is
// reusable for future grouping / search / legend work.

export type NodeKind = "input" | "math" | "convert" | "logic" | "list" | "lambda" | "util" | "display" | "string" | "date" | "complex" | "table" | "frame" | "format" | "boundary";

// A node kind picks a palette SLOT, not a raw hex — so a kind's accent and a
// note/group painted the same color always resolve to the identical value, and
// retuning a color in palette.ts moves both together. NODE_KIND_ACCENTS is the
// resolved-hex view many consumers still read directly.
export const NODE_KIND_SLOTS: Record<NodeKind, PaletteSlot> = {
  input:   "amber",     // sources / literals
  math:    "blue",      // arithmetic & math fns
  convert: "teal",      // unit conversion
  logic:   "purple",    // comparison & boolean logic
  // A list is NOT a first-class socket type (it's a dimensional variant of an
  // element type — a number-list socket is still number-colored), so list nodes
  // don't earn a dedicated hue; they share the neutral gold with display/format.
  list:    "gold",      // list / aggregate (neutral — see note)
  lambda:  "green",     // LAMBDA value definition
  util:    "gray",      // utility / passthrough
  display: "gold",      // output / display
  string:  "lime",      // text / string nodes (matches string socket)
  date:    "pink",      // date / time nodes (matches date socket)
  complex: "sky",       // complex number nodes (matches complex socket)
  table:   "gold",      // 2D matrix / table nodes — numeric family (the table socket is a gold matrix-shade)
  frame:   "violet",    // frame / data-table nodes (matches frame socket)
  format:  "gold",      // format controller (amber family)
  boundary: "green",    // Composite Input/Output boundary markers — green = "special"
};

// Resolved-hex view of the kind accents, kept LIVE: it's an object consumers index
// as NODE_KIND_ACCENTS[kind], so we mutate it in place whenever the active palette
// changes rather than swap the binding (a const map would freeze at the startup
// palette). Components re-read it on their next render — palette changes also bump
// appThemeStore, which every node card subscribes to, so they re-render.
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
