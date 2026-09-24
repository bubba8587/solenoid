// [[C10]] socketLattice
import { ClassicPreset } from "rete";

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

type Dim = "scalar" | "list" | "combo" | "matrix";

const FAMILIES: Record<string, Record<Dim, SocketDataType>> = {
  number:  { scalar: "number",  list: "list",        combo: "numlist",      matrix: "table" },
  string:  { scalar: "string",  list: "strlist",     combo: "strcombo",     matrix: "strtable" },
  date:    { scalar: "date",    list: "datelist",    combo: "datecombo",    matrix: "datetable" },
  complex: { scalar: "complex", list: "complexlist", combo: "complexcombo", matrix: "complextable" },
  logical: { scalar: "logical", list: "logicallist", combo: "logicalcombo", matrix: "logicaltable" },
};

const DIM_RANK: Record<Dim, number> = { scalar: 0, list: 1, combo: 1, matrix: 2 };
const DIMS: Dim[] = ["scalar", "list", "combo", "matrix"];

function dimFlows(dOut: Dim, dIn: Dim): boolean {
  return DIM_RANK[dOut] <= DIM_RANK[dIn] || (dOut === "combo" && dIn === "scalar");
}

const MATRIX_TYPES = new Set<SocketDataType>([
  "table", "strtable", "datetable", "complextable", "logicaltable", "anytable",
]);

const FAMILY_VALUE_TYPES = new Set<SocketDataType>(
  Object.values(FAMILIES).flatMap((fam) => Object.values(fam)),
);

const RANK1_VALUE_TYPES = new Set<SocketDataType>(
  Object.values(FAMILIES).flatMap((fam) => [fam.scalar, fam.list, fam.combo]),
);
const SCALAR_COMBO_TYPES = new Set<SocketDataType>(
  Object.values(FAMILIES).flatMap((fam) => [fam.scalar, fam.combo]),
);
const LIST_COMBO_TYPES = new Set<SocketDataType>(
  Object.values(FAMILIES).flatMap((fam) => [fam.list, fam.combo]),
);

const SOCKET_ACCEPTS: Partial<Record<SocketDataType, SocketDataType[]>> = (() => {
  const map: Partial<Record<SocketDataType, SocketDataType[]>> = {};
  for (const fam of Object.values(FAMILIES)) {
    for (const di of DIMS) {
      map[fam[di]] = DIMS
        .filter((dof) => dof !== di && dimFlows(dof, di))
        .map((dof) => fam[dof]);
    }
  }
  const NUM = FAMILIES.number, LOG = FAMILIES.logical;
  for (const di of DIMS) {
    for (const dof of DIMS) {
      if (dimFlows(dof, di)) {
        map[NUM[di]]!.push(LOG[dof]);
        map[LOG[di]]!.push(NUM[dof]);
      }
    }
  }
  return map;
})();

export function is2DType(dt: SocketDataType): boolean {
  return MATRIX_TYPES.has(dt) || dt === "frame" || dt === "cube";
}

export function isDateType(dt: SocketDataType): boolean {
  return dt === "date" || dt === "datelist" || dt === "datecombo" || dt === "datetable";
}

export type ElementFamily = keyof typeof FAMILIES;

export function elementFamilyOf(dt: SocketDataType): ElementFamily | null {
  for (const [fam, dims] of Object.entries(FAMILIES)) {
    if (Object.values(dims).includes(dt)) return fam;
  }
  return null;
}

export function comboOfType(dt: SocketDataType): SocketDataType | null {
  const fam = elementFamilyOf(dt);
  return fam ? FAMILIES[fam].combo : null;
}

export function typeAtRank(dt: SocketDataType, rank: 0 | 1 | 2): SocketDataType | null {
  const fam = elementFamilyOf(dt);
  return fam ? FAMILIES[fam][rank === 0 ? "scalar" : rank === 1 ? "list" : "matrix"] : null;
}

export function comboOfFamily(fam: string): SocketDataType | null {
  return FAMILIES[fam]?.combo ?? null;
}

export function latticeRank(dt: SocketDataType): number | null {
  if (dt === "any") return 0;
  if (dt === "anylist" || dt === "anycombo") return 1;
  if (dt === "anydata") return 2;
  if (dt === "anytable") return 2;
  for (const dims of Object.values(FAMILIES)) {
    for (const [dim, t] of Object.entries(dims)) if (t === dt) return DIM_RANK[dim as Dim];
  }
  return null;
}

export function adoptTypeForBase(base: SocketDataType, wired: SocketDataType): SocketDataType {
  const fam = elementFamilyOf(wired);
  if (base === "anylist" || base === "anytable") {
    const baseRank = latticeRank(base);
    const wiredRank = latticeRank(wired);
    if (fam === null || baseRank === null || wiredRank === null) return base;
    if (wiredRank >= baseRank) return wired;
    return FAMILIES[fam][baseRank === 2 ? "matrix" : "list"];
  }
  if ((base === "any" || base === "anycombo" || base === "anydata") && fam === null) return base;
  return wired;
}

export function projectTypeToBase(base: SocketDataType, t: SocketDataType): SocketDataType {
  if (base !== "anylist" && base !== "anytable") return t;
  const baseRank = latticeRank(base);
  if (baseRank === null) return t;
  const fam = elementFamilyOf(t);
  if (fam === null) return base;
  if (latticeRank(t) === baseRank) return t;
  return FAMILIES[fam][baseRank === 2 ? "matrix" : "list"];
}

function accepts(inT: SocketDataType, outT: SocketDataType): boolean {
  if (inT === outT) return true;
  if (inT === "trueany" || outT === "trueany") return true;
  if (inT === "any") return SCALAR_COMBO_TYPES.has(outT) || outT === "anycombo";
  if (outT === "any") return inT !== "lambda" && inT !== "chart" && inT !== "document";
  if (inT === "anytable" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anylist")) return true;
  if (outT === "anytable" && MATRIX_TYPES.has(inT)) return true;
  if (inT === "anylist" && (RANK1_VALUE_TYPES.has(outT) || outT === "anycombo")) return true;
  if (outT === "anylist" && LIST_COMBO_TYPES.has(inT)) return true;
  if (inT === "anycombo" && (RANK1_VALUE_TYPES.has(outT) || outT === "anylist")) return true;
  if (outT === "anycombo") return inT !== "lambda" && inT !== "chart" && inT !== "document";
  // [[C10]] socketLattice
  if (inT === "anydata" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anylist" || outT === "anytable")) return true;
  if (outT === "anydata") return inT !== "lambda" && inT !== "chart" && inT !== "document";
  if (inT === "frame" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anytable" || outT === "anylist")) return true;
  // [[C10]] socketLattice
  if (inT === "cube" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anytable" || outT === "anylist" || outT === "frame")) return true;
  return SOCKET_ACCEPTS[inT]?.includes(outT) ?? false;
}

export function areCompatible(a: SocketDataType, b: SocketDataType): boolean {
  return accepts(a, b) || accepts(b, a);
}

export function canConnect(out: SocketDataType, inp: SocketDataType): boolean {
  return accepts(inp, out);
}

export class SolenoidSocket extends ClassicPreset.Socket {
  constructor(public readonly dataType: SocketDataType) {
    super(dataType);
  }
  isCompatibleWith(socket: ClassicPreset.Socket): boolean {
    return (
      socket instanceof SolenoidSocket &&
      areCompatible(this.dataType, socket.dataType)
    );
  }
  canConnectTo(input: ClassicPreset.Socket): boolean {
    return input instanceof SolenoidSocket && canConnect(this.dataType, input.dataType);
  }
}

export class MutableSocket extends SolenoidSocket {
  setType(type: SocketDataType): void {
    (this as unknown as { dataType: SocketDataType }).dataType = type;
  }
}

export class AdoptiveSocket extends MutableSocket {
  constructor(public readonly base: SocketDataType = "trueany") {
    super(base);
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
export const anyDataSocket   = new SolenoidSocket("anydata");
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
  return isWildcardType(dt) || dt === "anycombo" || dt === "anylist"
    || dt === "anytable" || dt === "anydata";
}
