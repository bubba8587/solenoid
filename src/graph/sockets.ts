// [[C10]] socketLattice
import { GraphSocket } from "./graphModel";
import { latticeTables } from "./engineWasm/solenoid_graph.js";

export type SocketDataType =
  | "number"
  | "list"
  | "numlist"
  | "string"
  | "strlist"
  | "strcombo"
  | "date"
  | "datelist"
  | "datecombo"
  | "complex"
  | "complexlist"
  | "complexcombo"
  | "complextable"
  | "logical"
  | "logicallist"
  | "logicalcombo"
  | "logicaltable"
  | "table"
  | "strtable"
  | "datetable"
  | "anytable"
  | "anylist"
  | "anydata"
  | "anycombo"
  | "frame"
  | "cube"
  | "lambda"
  | "chart"
  | "document"
  | "any"
  | "trueany";

// CSS variables so the colors follow the theme live; never parse them as hex.
export const SOCKET_COLORS: Record<SocketDataType, string> = {
  number:   "var(--sock-number)",
  list:     "var(--sock-list)",
  numlist:  "var(--sock-number)",
  string:   "var(--sock-string)",
  strlist:  "var(--sock-strlist)",
  strcombo: "var(--sock-string)",
  date:     "var(--sock-date)",
  datelist: "var(--sock-datelist)",
  datecombo:"var(--sock-date)",
  complex:  "var(--sock-complex)",
  complexlist:  "var(--sock-complexlist)",
  complexcombo: "var(--sock-complex)",
  complextable: "var(--sock-complextable)",
  logical:      "var(--sock-logical)",
  logicallist:  "var(--sock-logicallist)",
  logicalcombo: "var(--sock-logical)",
  logicaltable: "var(--sock-logicaltable)",
  table:    "var(--sock-table)",
  strtable: "var(--sock-strtable)",
  datetable:"var(--sock-datetable)",
  anytable: "var(--sock-any)",
  anylist:  "var(--sock-any)",
  anycombo: "var(--sock-any)",
  anydata:  "var(--sock-any)",
  frame:    "var(--sock-frame)",
  cube:     "var(--sock-cube)",
  lambda:   "var(--sock-lambda)",
  chart:    "var(--sock-chart)",
  document: "var(--sock-chart)",
  any:      "var(--sock-any)",
  trueany:  "var(--sock-any)",
};

export const SOCKET_TYPE_LABELS: Record<SocketDataType, string> = {
  number:       "Number",
  list:         "List (number)",
  numlist:      "Number or list",
  string:       "Text",
  strlist:      "List (text)",
  strcombo:     "Text or list",
  date:         "Date",
  datelist:     "List (date)",
  datecombo:    "Date or list",
  complex:      "Complex number",
  complexlist:  "List (complex)",
  complexcombo: "Complex or list",
  complextable: "Matrix (complex)",
  logical:      "Boolean",
  logicallist:  "List (boolean)",
  logicalcombo: "Boolean or list",
  logicaltable: "Matrix (boolean)",
  table:        "Matrix (number)",
  strtable:     "Matrix (text)",
  datetable:    "Matrix (date)",
  anytable:     "Matrix (any)",
  anylist:      "List (any)",
  anycombo:     "Any value or list",
  anydata:      "Any value, list or matrix",
  frame:        "Frame (table)",
  cube:         "Cube (nested table)",
  lambda:       "Function",
  chart:        "Chart / visual",
  document:     "Document",
  any:          "Any value",
  trueany:      "Anything",
};

// The rules are the core's (`crates/solenoid-graph/src/lattice.rs`, [[D102]] graphOnCore); these read its tables,
// fetched once on first use.
interface LatticeTables {
  connects: Record<SocketDataType, SocketDataType[]>;
  adopts: Record<SocketDataType, Record<SocketDataType, SocketDataType>>;
  projects: Record<SocketDataType, Record<SocketDataType, SocketDataType>>;
  types: Record<SocketDataType, { rank: number | null; family: ElementFamily | null; combo: SocketDataType | null; atRank: (SocketDataType | null)[]; wildcard: boolean }>;
}

let tables: (LatticeTables & { accepts: Map<SocketDataType, Set<SocketDataType>> }) | null = null;

function lattice() {
  if (!tables) {
    const t = JSON.parse(latticeTables()) as LatticeTables;
    tables = { ...t, accepts: new Map(Object.entries(t.connects).map(([k, v]) => [k as SocketDataType, new Set(v)])) };
  }
  return tables;
}

const facts = (dt: SocketDataType) => lattice().types[dt];

export type ElementFamily = "number" | "string" | "date" | "complex" | "logical";

export function is2DType(dt: SocketDataType): boolean {
  return dt === "frame" || dt === "cube" || (facts(dt)?.rank === 2 && dt !== "anydata");
}

export function isDateType(dt: SocketDataType): boolean {
  return facts(dt)?.family === "date";
}

export function elementFamilyOf(dt: SocketDataType): ElementFamily | null {
  return facts(dt)?.family ?? null;
}

export function comboOfType(dt: SocketDataType): SocketDataType | null {
  return facts(dt)?.combo ?? null;
}

export function typeAtRank(dt: SocketDataType, rank: 0 | 1 | 2): SocketDataType | null {
  return facts(dt)?.atRank[rank] ?? null;
}

export function comboOfFamily(fam: string): SocketDataType | null {
  return comboOfType(fam as SocketDataType);
}

export function latticeRank(dt: SocketDataType): number | null {
  return facts(dt)?.rank ?? null;
}

export function adoptTypeForBase(base: SocketDataType, wired: SocketDataType): SocketDataType {
  return lattice().adopts[base]?.[wired] ?? wired;
}

export function projectTypeToBase(base: SocketDataType, t: SocketDataType): SocketDataType {
  return lattice().projects[base]?.[t] ?? t;
}

export function areCompatible(a: SocketDataType, b: SocketDataType): boolean {
  return canConnect(a, b) || canConnect(b, a);
}

export function canConnect(out: SocketDataType, inp: SocketDataType): boolean {
  return lattice().accepts.get(out)?.has(inp) ?? false;
}

export class SolenoidSocket extends GraphSocket {
  constructor(public readonly dataType: SocketDataType) {
    super(dataType);
  }
  isCompatibleWith(socket: GraphSocket): boolean {
    return (
      socket instanceof SolenoidSocket &&
      areCompatible(this.dataType, socket.dataType)
    );
  }
  canConnectTo(input: GraphSocket): boolean {
    return input instanceof SolenoidSocket && canConnect(this.dataType, input.dataType);
  }
}

/** A socket retyped in place; its declared rung follows, so the core's port type does too. */
export class MutableSocket extends SolenoidSocket {
  protected get changes(): boolean { return true; }
  setType(type: SocketDataType): void {
    (this as unknown as { dataType: SocketDataType }).dataType = type;
    this.rename(type);
  }
}

/** Adopts a cable's type to color the port; its declared rung stays `base`. */
export class AdoptiveSocket extends MutableSocket {
  constructor(public readonly base: SocketDataType = "trueany") {
    super(base);
  }
  setType(type: SocketDataType): void {
    if (type === this.dataType) return;
    (this as unknown as { dataType: SocketDataType }).dataType = type;
    // The type it took up is part of the card's call (graph-core.md § Direct calls), not of the port.
    this.heldEdited();
  }
}

/** The rung a port was DECLARED at: an adoptive port's base, never the type it adopted
 *  from its cable. Judge an input's acceptance and coerce its value by this
 *  ([[C10]] socketLattice). */
export function declaredTypeOf(socket: unknown): SocketDataType | undefined {
  if (socket instanceof AdoptiveSocket) return socket.base;
  return socket instanceof SolenoidSocket ? socket.dataType : undefined;
}

export const numberSocket  = new SolenoidSocket("number");
export const listSocket    = new SolenoidSocket("list");
export const numListSocket = new SolenoidSocket("numlist");
export const strComboSocket  = new SolenoidSocket("strcombo");
export const dateComboSocket = new SolenoidSocket("datecombo");
export const tableSocket   = new SolenoidSocket("table");
export const strTableSocket  = new SolenoidSocket("strtable");
export const dateTableSocket = new SolenoidSocket("datetable");
export const anyTableSocket  = new SolenoidSocket("anytable");
export const anyComboSocket  = new SolenoidSocket("anycombo");
export const stringSocket  = new SolenoidSocket("string");
export const strListSocket = new SolenoidSocket("strlist");
export const dateSocket    = new SolenoidSocket("date");
export const dateListSocket= new SolenoidSocket("datelist");
export const complexSocket = new SolenoidSocket("complex");
export const complexListSocket  = new SolenoidSocket("complexlist");
export const complexComboSocket = new SolenoidSocket("complexcombo");
export const complexTableSocket = new SolenoidSocket("complextable");
export const logicalSocket      = new SolenoidSocket("logical");
export const logicalListSocket  = new SolenoidSocket("logicallist");
export const logicalComboSocket = new SolenoidSocket("logicalcombo");
export const logicalTableSocket = new SolenoidSocket("logicaltable");
export const frameSocket   = new SolenoidSocket("frame");
export const cubeSocket    = new SolenoidSocket("cube");
export const lambdaSocket  = new SolenoidSocket("lambda");
export const chartSocket   = new SolenoidSocket("chart");
export const documentSocket = new SolenoidSocket("document");
export const anySocket     = new SolenoidSocket("any");
export const trueAnySocket = new SolenoidSocket("trueany");

export function isWildcardType(dt: SocketDataType): boolean {
  return dt === "any" || dt === "trueany";
}

export function isWildcardRung(dt: SocketDataType): boolean {
  return facts(dt)?.wildcard === true;
}
