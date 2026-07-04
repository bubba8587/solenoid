import { ClassicPreset } from "rete";
import { numberSocket, listSocket, numListSocket, tableSocket, strTableSocket, dateTableSocket, anyTableSocket, stringSocket, strListSocket, strComboSocket, dateSocket, dateListSocket, dateComboSocket, complexSocket, complexListSocket, complexComboSocket, complexTableSocket, logicalSocket, logicalListSocket, logicalComboSocket, logicalTableSocket, frameSocket, cubeSocket, lambdaSocket, chartSocket, anySocket } from "../sockets";
import { resolveColor, paletteStore, type PaletteSlot } from "../palette";
import { type SolError } from "../errorValue";
import { cellShortCircuit, COMPUTE } from "../valueKinds";

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
export const anyIn      = (label: string) => new ClassicPreset.Input(anySocket,     label);
// A 2-D (grid) input of ANY element type — for element-agnostic matrix ops
// (TRANSPOSE / HSTACK / CHOOSEROWS / reshape / MAP). A lower-rank value (a 1-D
// list, a scalar) widens IN, the same way a `list` widens into a `table` input.
export const anyTableIn = (label: string) => new ClassicPreset.Input(anyTableSocket, label);
export const numOut     = (label: string) => new ClassicPreset.Output(numberSocket,  label);
export const listOut    = (label: string) => new ClassicPreset.Output(listSocket,    label);
export const numListOut = (label: string) => new ClassicPreset.Output(numListSocket, label);
export const tableOut   = (label: string) => new ClassicPreset.Output(tableSocket,   label);
export const strTableOut = (label: string) => new ClassicPreset.Output(strTableSocket, label);
export const dateTableOut= (label: string) => new ClassicPreset.Output(dateTableSocket,label);
export const anyTableOut = (label: string) => new ClassicPreset.Output(anyTableSocket, label);
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
export const anyOut       = (label: string) => new ClassicPreset.Output(anySocket,     label);

// ─── Polyform result-type selector ────────────────────────────────────────────
// The value-polymorphic formula producers (Expression, BYROW/BYCOL, REDUCE, MAP,
// MAKEARRAY) loop ANY Excel function over their inputs (see excelFormula.ts +
// the polymorphic broadcast below). Their output element type can't be inferred
// from a runtime-polymorphic lambda, so the user declares it; the choice swaps
// the output socket to the matching type AT THE NODE'S OWN DIMENSIONALITY so
// downstream type-checking stays honest. `auto` falls back to `any` (wildcard).
//
//   scalar  (REDUCE)               → number / string / date / any
//   combo   (Expression, BYROW/…)  → numlist / strcombo / datecombo / any
//   matrix  (MAP, MAKEARRAY)       → table / strtable / datetable / any
export type ResultType = "number" | "text" | "date" | "auto";
export type ResultDim = "scalar" | "combo" | "matrix";

export const RESULT_TYPE_META: Record<ResultType, { label: string; title: string }> = {
  number: { label: "Number", title: "Result is numeric (the default — same as Excel arithmetic)" },
  text:   { label: "Text",   title: "Result is text — e.g. UPPER(x), TEXTJOIN(…), x & \" \" & y" },
  date:   { label: "Date",   title: "Result is a date (Excel serial) — e.g. DATE(y,m,d), EDATE(x,1)" },
  auto:   { label: "Auto",   title: "Untyped (any socket) — accepts whatever the formula returns" },
};

const RESULT_SOCKETS: Record<ResultDim, Record<ResultType, ClassicPreset.Socket>> = {
  scalar: { number: numberSocket,  text: stringSocket,   date: dateSocket,        auto: anySocket },
  combo:  { number: numListSocket, text: strComboSocket, date: dateComboSocket,   auto: anySocket },
  matrix: { number: tableSocket,   text: strTableSocket, date: dateTableSocket,   auto: anySocket },
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
// behaviour of element-wise nodes via the flexible `numlist` socket. An
// invalid element (fn → null) becomes NaN within a result list. Ragged lists
// zip to the LONGEST length: a position missing from a shorter list emits a
// first-class `null` (missing) in the result, without calling `fn` — the
// pad-to-longest policy settled with the array-semantics build. The result
// list therefore carries nulls at runtime; the `number[]` return type follows
// the node layer's loose-list convention (lists carry null/SolError cells).
// A numeric broadcaster's output: a scalar, or a list whose cells may each carry
// a first-class `null` (missing) or `SolError` (per the per-cell contract), or a
// whole-value short-circuit (scalar error/missing). The node layer's loose-list
// convention — lists carry null/SolError cells at runtime.
export type BroadcastResult = number | (number | SolError | null)[] | SolError | null;

export function broadcast(
  fn: (...xs: number[]) => number | null,
  ...args: Array<number | number[]>
): BroadcastResult {
  const lists = args.filter((a): a is number[] => Array.isArray(a));
  if (lists.length === 0) {
    const sc = cellShortCircuit(args);
    return sc === COMPUTE ? fn(...(args as number[])) : sc;
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (number | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; }
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a));
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; } // error / missing propagates
    const r = fn(...(ops as number[]));
    out.push(r ?? NaN);
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
  ...args: Array<number | number[]>
): BroadcastResult {
  const lists = args.filter((a): a is number[] => Array.isArray(a));
  if (lists.length === 0) {
    const sc = cellShortCircuit(args);
    return sc === COMPUTE ? fn(...(args as number[])) : sc;
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (number | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; } // ragged pad
    const ops = args.map((a) => (Array.isArray(a) ? a[i] : a));
    const sc = cellShortCircuit(ops);
    out.push(sc !== COMPUTE ? sc : fn(...(ops as number[]))); // error / missing propagates
  }
  return out;
}

// ─── Node kind → header accent ─────────────────────────────────────────────────
// A node's "kind" is its family (what it does), distinct from socket
// type (what flows through it). Drives the colored header bar, and is
// reusable for future grouping / search / legend work.

export type NodeKind = "input" | "math" | "convert" | "logic" | "list" | "lambda" | "util" | "display" | "string" | "date" | "complex" | "table" | "frame" | "format";

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
  // element type — a number-list socket is still number-coloured), so list nodes
  // don't earn a dedicated hue; they share the neutral gold with display/format.
  list:    "gold",      // list / aggregate (neutral — see note)
  lambda:  "green",     // LAMBDA value definition
  util:    "gray",      // utility / passthrough
  display: "gold",      // output / display
  string:  "lime",      // text / string nodes (matches string socket)
  date:    "pink",      // date / time nodes (matches date socket)
  complex: "sky",       // complex number nodes (matches complex socket)
  table:   "vermilion", // 2D matrix / table nodes (matches table socket)
  frame:   "violet",    // frame / data-table nodes (matches frame socket)
  format:  "gold",      // format controller (amber family)
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
};
