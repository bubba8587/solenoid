// [[C24]] arraySemantics
import { GraphInput, GraphNode, GraphOutput, GraphSocket } from "../graphModel";
import { numberSocket, listSocket, numListSocket, tableSocket, strTableSocket, dateTableSocket, anyTableSocket, anyComboSocket, stringSocket, strListSocket, strComboSocket, dateSocket, dateListSocket, dateComboSocket, complexSocket, complexListSocket, complexComboSocket, logicalSocket, logicalListSocket, logicalComboSocket, logicalTableSocket, frameSocket, cubeSocket, lambdaSocket, chartSocket, documentSocket, anySocket, trueAnySocket, AdoptiveSocket } from "../sockets";
import { resolveColor, paletteStore, type PaletteSlot } from "../palette";
import { type SolError } from "../errorValue";
import { applyRole, type InputRole } from "../inputRoles";
import { type UnitCell, magnitudeOf } from "../unitValue";
import { dimOf } from "../unitValue";

export const BASIS_DOC = "Day-count basis: 0 = US 30/360, 1 = actual/actual, 2 = actual/360, 3 = actual/365, 4 = European 30/360.";

export const numIn      = (label: string) => new GraphInput(numberSocket, label);
export const listIn     = (label: string) => new GraphInput(listSocket, label);
export const numListIn  = (label: string) => new GraphInput(numListSocket, label);
export const tableIn    = (label: string) => new GraphInput(tableSocket, label);
export const strIn      = (label: string) => new GraphInput(stringSocket,  label);
export const strListIn  = (label: string) => new GraphInput(strListSocket, label);
export const dateIn     = (label: string) => new GraphInput(dateSocket,    label);
export const dateListIn = (label: string) => new GraphInput(dateListSocket,label);
export const anyIn      = (label: string) => new GraphInput(new AdoptiveSocket("any"), label);
export const trueAnyIn        = (label: string) => new GraphInput(new AdoptiveSocket(), label);
export const trueAnyOut       = (label: string) => new GraphOutput(new AdoptiveSocket(), label);
export const adoptiveTableIn  = (label: string) => new GraphInput(new AdoptiveSocket("anytable"), label);
export const adoptiveListIn   = (label: string) => new GraphInput(new AdoptiveSocket("anylist"), label);
export const adoptiveTableOut = (label: string) => new GraphOutput(new AdoptiveSocket("anytable"), label);
export const adoptiveListOut  = (label: string) => new GraphOutput(new AdoptiveSocket("anylist"), label);
export const adoptiveDataOut  = (label: string) => new GraphOutput(new AdoptiveSocket("anydata"), label);
/** Never adopts: only for a generative result no input types; an extraction uses `trueAnyOut` plus `passthrough()`. */
export const staticTrueAnyOut = (label: string) => new GraphOutput(trueAnySocket, label);
export const cubeAdoptIn  = (label: string) => new GraphInput(new AdoptiveSocket("cube"), label);
export const tableAdoptOut = (label: string) => new GraphOutput(new AdoptiveSocket("frame"), label);
export const anyTableIn = (label: string) => new GraphInput(new AdoptiveSocket("anytable"), label);
export const anyListIn  = (label: string) => new GraphInput(new AdoptiveSocket("anylist"), label);
export const anyComboIn  = (label: string) => new GraphInput(new AdoptiveSocket("anycombo"), label);
export const anyDataIn   = (label: string) => new GraphInput(new AdoptiveSocket("anydata"), label);
export const anyComboOut = (label: string) => new GraphOutput(anyComboSocket, label);
export const numOut     = (label: string) => new GraphOutput(numberSocket,  label);
export const listOut    = (label: string) => new GraphOutput(listSocket,    label);
export const numListOut = (label: string) => new GraphOutput(numListSocket, label);
export const tableOut   = (label: string) => new GraphOutput(tableSocket,   label);
export const strTableOut = (label: string) => new GraphOutput(strTableSocket, label);
export const dateTableOut= (label: string) => new GraphOutput(dateTableSocket,label);
export const strOut     = (label: string) => new GraphOutput(stringSocket,  label);
export const strListOut = (label: string) => new GraphOutput(strListSocket, label);
export const dateOut      = (label: string) => new GraphOutput(dateSocket,    label);
export const dateListOut  = (label: string) => new GraphOutput(dateListSocket,label);
export const strComboIn   = (label: string) => new GraphInput(strComboSocket,   label);
export const strComboOut  = (label: string) => new GraphOutput(strComboSocket,  label);
export const dateComboIn  = (label: string) => new GraphInput(dateComboSocket,  label);
export const dateComboOut = (label: string) => new GraphOutput(dateComboSocket, label);
export const complexOut   = (label: string) => new GraphOutput(complexSocket, label);
export const complexListOut = (label: string) => new GraphOutput(complexListSocket, label);
export const complexComboIn  = (label: string) => new GraphInput(complexComboSocket,  label);
export const complexComboOut = (label: string) => new GraphOutput(complexComboSocket, label);
export const logicalIn       = (label: string) => new GraphInput(logicalSocket,  label);
export const logicalOut      = (label: string) => new GraphOutput(logicalSocket, label);
export const logicalListIn   = (label: string) => new GraphInput(logicalListSocket,  label);
export const logicalListOut  = (label: string) => new GraphOutput(logicalListSocket, label);
export const logicalComboIn  = (label: string) => new GraphInput(logicalComboSocket,  label);
export const logicalComboOut = (label: string) => new GraphOutput(logicalComboSocket, label);
export const logicalTableOut = (label: string) => new GraphOutput(logicalTableSocket, label);
export const frameIn      = (label: string) => new GraphInput(frameSocket,   label);
export const frameOut     = (label: string) => new GraphOutput(frameSocket,  label);
export const cubeIn       = (label: string) => new GraphInput(cubeSocket,    label);
export const cubeOut      = (label: string) => new GraphOutput(cubeSocket,   label);
export const lambdaIn     = (label: string) => new GraphInput(lambdaSocket,  label);
export const lambdaOut    = (label: string) => new GraphOutput(lambdaSocket, label);
export const chartIn      = (label: string) => new GraphInput(chartSocket,   label);
export const chartOut     = (label: string) => new GraphOutput(chartSocket,  label);
export const documentIn   = (label: string) => new GraphInput(documentSocket, label);
export const documentOut  = (label: string) => new GraphOutput(documentSocket, label);

export type ResultType = "number" | "text" | "date" | "auto";
export type ResultDim = "scalar" | "combo" | "matrix";

export const RESULT_TYPE_META: Record<ResultType, { label: string; title: string }> = {
  number: { label: "Number", title: "The result is a number, the default" },
  text:   { label: "Text",   title: "The result is text, like UPPER(x) or x & \" \" & y" },
  date:   { label: "Date",   title: "The result is a date, like DATE(y,m,d) or EDATE(x,1)" },
  auto:   { label: "Auto",   title: "The result takes whatever type the formula returns" },
};

const RESULT_SOCKETS: Record<ResultDim, Record<ResultType, GraphSocket>> = {
  scalar: { number: numberSocket,  text: stringSocket,   date: dateSocket,        auto: anySocket },
  combo:  { number: numListSocket, text: strComboSocket, date: dateComboSocket,   auto: anyComboSocket },
  matrix: { number: tableSocket,   text: strTableSocket, date: dateTableSocket,   auto: anyTableSocket },
};

export function resultSocket(dim: ResultDim, t: ResultType): GraphSocket {
  return RESULT_SOCKETS[dim][t];
}

export function resultOut(label: string, dim: ResultDim, t: ResultType): GraphOutput<GraphSocket> {
  return new GraphOutput(resultSocket(dim, t), label);
}

export function readInput<T>(wired: readonly T[] | undefined, literal: T): T | null {
  return wired === undefined || wired.length === 0 ? literal : (wired[0] ?? null);
}

/** A card's input roles: its class's, or for a card whose roles change with its op (Series), the current op's. */
export function rolesOf(node: GraphNode): Record<string, InputRole> | undefined {
  return (node as { currentInputRoles?: () => Record<string, InputRole> }).currentInputRoles?.()
    ?? (node.constructor as { inputRoles?: Record<string, InputRole> }).inputRoles;
}

/** A declared input read by its role ([[D86]] blankRoles): unwired, the typed value; wired, the cable's; a blank as the role reads it. */
export function readRole<T = unknown>(node: GraphNode, key: string, wired: readonly unknown[] | undefined): T {
  const role = rolesOf(node)?.[key];
  if (!role) throw new Error(`${node.constructor.name}: no input role declared for "${key}"`);
  return readAsRole<T>(node, key, wired, role);
}

/** `readRole` with the role given, for a card whose roles change with its op (Series). */
function readAsRole<T = unknown>(node: GraphNode, key: string, wired: readonly unknown[] | undefined, role: InputRole): T {
  const n = node as { literals?: Record<string, unknown>; stringLiterals?: Record<string, unknown> };
  const literal = n.literals?.[key] ?? n.stringLiterals?.[key];
  const v = wired === undefined || wired.length === 0 ? literal : wired[0];
  return applyRole(role, v ?? null, node.inputs[key]?.label ?? key) as T;
}

export type CellResult<T> = T | (T | SolError | null)[] | SolError | null;

export type BroadcastResult = CellResult<number>;

export type UnitOperand = number | UnitCell;
export type BroadcastUnitResult =
  number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null;

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
