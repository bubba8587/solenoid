import { ClassicPreset } from "rete";

export type SocketDataType =
  | "number"    // scalar number
  | "list"      // number[]
  | "numlist"   // number | number[]
  | "string"    // scalar string
  | "strlist"   // string[]
  | "strcombo"  // string | string[]
  | "date"      // date serial (numeric, like Excel)
  | "datelist"  // date[]
  | "datecombo" // date | date[]
  | "complex"   // tagged { __cx, re, im }
  | "complexlist" // Cx[]
  | "complexcombo"// complex | complex[]
  | "complextable"// 2-D complex matrix
  | "logical"     // scalar boolean (TRUE/FALSE)
  | "logicallist" // boolean[]
  | "logicalcombo"// boolean | boolean[]
  | "logicaltable"// 2-D boolean matrix
  | "table"     // 2-D numeric matrix
  | "strtable"  // 2-D string matrix
  | "datetable" // 2-D date-serial matrix
  | "anytable"  // 2-D matrix of any element type
  | "anylist"   // 1-D list of ANY element type; a scalar widens to a singleton
  | "anydata"   // ANY element type, rank ≤ 2 (scalar | list | matrix)
  | "anycombo"  // ANY element type, scalar OR 1-D list; a scalar STAYS a scalar
  | "frame"     // named-column data table (Matrix + headers) — see frame.ts
  | "cube"      // recursive container — the lattice SUPREMUM. See frame.ts CubeValue.
  | "lambda"    // first-class function value — see nodes/lambda.ts
  | "chart"     // first-class chart/visual-output value
  | "document"  // a whole Note/Report's renderable content (DocumentValue)
  | "any"       // element-agnostic SCALAR — rank-0 wildcard rung
  | "trueany";  // the TRUE wildcard/supremum

// CSS variables (App.css) so the colors theme live — never parsed as hex.
export const SOCKET_COLORS: Record<SocketDataType, string> = {
  number:   "var(--sock-number)",   // amber         — circle
  list:     "var(--sock-list)",     // dark amber    — square (array of number)
  numlist:  "var(--sock-number)",   // amber         — bicolor split square (number | list)
  string:   "var(--sock-string)",   // yellow-green  — circle
  strlist:  "var(--sock-strlist)",  // dark y-g      — square (array of string)
  strcombo: "var(--sock-string)",   // yellow-green  — bicolor split square (string | strlist)
  date:     "var(--sock-date)",     // pink          — circle
  datelist: "var(--sock-datelist)", // dark pink     — square (array of date)
  datecombo:"var(--sock-date)",     // pink          — bicolor split square (date | datelist)
  complex:  "var(--sock-complex)",  // sky blue      — circle (complex number)
  complexlist:  "var(--sock-complexlist)",  // dark sky blue — square (array of complex)
  complexcombo: "var(--sock-complex)",      // sky blue      — split square (complex | list)
  complextable: "var(--sock-complextable)", // saturated blue— grid (complex matrix; scalar-derived)
  logical:      "var(--sock-logical)",      // purple        — circle (boolean TRUE/FALSE)
  logicallist:  "var(--sock-logicallist)",  // dark purple   — square (array of boolean)
  logicalcombo: "var(--sock-logical)",      // purple        — split square (boolean | list)
  logicaltable: "var(--sock-logicaltable)", // saturated purple — grid (boolean matrix)
  table:    "var(--sock-table)",    // gold-shade    — grid (numeric matrix)
  strtable: "var(--sock-strtable)", // saturated y-g — grid (string matrix; scalar-derived, like table↔number)
  datetable:"var(--sock-datetable)",// saturated rose— grid (date matrix; scalar-derived)
  anytable: "var(--sock-any)",      // gray          — grid (any-element 2-D matrix; reshaper output)
  anylist:  "var(--sock-any)",      // gray          — square (any-element 1-D list)
  anycombo: "var(--sock-any)",      // gray          — split square (any scalar | any list)
  anydata:  "var(--sock-any)",      // gray          — split grid (any value up to a 2-D matrix)
  frame:    "var(--sock-frame)",    // violet        — grid (named-column data table)
  cube:     "var(--sock-cube)",     // violet (frame) — hexagon (recursive any-value container)
  lambda:   "var(--sock-lambda)",   // teal-green    — circle with λ (function value)
  chart:    "var(--sock-chart)",    // green          — circle (chart/visual-output value)
  document: "var(--sock-chart)",    // green (chart)  — a whole-document value (Note/Report content)
  any:      "var(--sock-any)",      // gray          — circle (any single value)
  trueany:  "var(--sock-any)",      // gray          — HOLLOW circle (border only; anything)
};

// A socket dot's hover title — the only colorblind-accessible path to "what
// type is this".
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

/** May dim `dOut` flow into dim `dIn`? Shared by the within-family accept-sets
 *  and the logical↔number bridge so the combo→scalar exception can't drift. */
function dimFlows(dOut: Dim, dIn: Dim): boolean {
  return DIM_RANK[dOut] <= DIM_RANK[dIn] || (dOut === "combo" && dIn === "scalar");
}

// The homogeneous 2-D matrix types + the 2-D wildcard `anytable`, but NOT `frame`.
const MATRIX_TYPES = new Set<SocketDataType>([
  "table", "strtable", "datetable", "complextable", "logicaltable", "anytable",
]);

// Every concrete family value type (rank ≤ 2) — excludes the structurally
// distinct `frame` and `lambda`.
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

/** Derived directional accept-sets: which same-family, lower-or-equal-rank
 *  types widen INTO each lattice type. */
const SOCKET_ACCEPTS: Partial<Record<SocketDataType, SocketDataType[]>> = (() => {
  const map: Partial<Record<SocketDataType, SocketDataType[]>> = {};
  for (const fam of Object.values(FAMILIES)) {
    for (const di of DIMS) {
      map[fam[di]] = DIMS
        .filter((dof) => dof !== di && dimFlows(dof, di))
        .map((dof) => fam[dof]);
    }
  }
  // The ONE cross-family bridge — coerceInputs does the runtime conversion.
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

/** Is this type 2-D? — matrices, the 2-D wildcard, `frame`, and `cube`. */
export function is2DType(dt: SocketDataType): boolean {
  return MATRIX_TYPES.has(dt) || dt === "frame" || dt === "cube";
}

/** A date serial is just a number, so the SOCKET TYPE is the only date signal —
 * every "is this a date?" check must route through here. */
export function isDateType(dt: SocketDataType): boolean {
  return dt === "date" || dt === "datelist" || dt === "datecombo" || dt === "datetable";
}

export type ElementFamily = keyof typeof FAMILIES;

/** The ELEMENT family of a lattice type (any rank), or null for the structural
 *  types outside the 5-family lattice. */
export function elementFamilyOf(dt: SocketDataType): ElementFamily | null {
  for (const [fam, dims] of Object.entries(FAMILIES)) {
    if (Object.values(dims).includes(dt)) return fam as ElementFamily;
  }
  return null;
}

/** The COMBO rung of a type's element family — the honest output type for an
 *  element-preserving EXTRACTION whose rank depends on runtime arguments (INDEX);
 *  `null` for a type with no element family. */
export function comboOfType(dt: SocketDataType): SocketDataType | null {
  const fam = elementFamilyOf(dt);
  return fam ? FAMILIES[fam].combo : null;
}

/** `comboOfType` for a caller holding a family name instead of a socket type — a
 *  frame column's `type` IS a family name, so an extraction out of a named column
 *  resolves through here. */
export function comboOfFamily(fam: string): SocketDataType | null {
  return FAMILIES[fam]?.combo ?? null;
}

/** Lattice rank — 0 scalar, 1 list/combo, 2 matrix (incl. the rank-bearing
 *  wildcard rungs); null for the rankless structural types. */
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

/** The type an adoptive INPUT takes when a cable lands: a rank-bearing wildcard
 *  base (anylist / anytable) KEEPS its rank and adopts only the wired ELEMENT
 *  family; everything else adopts verbatim. */
export function adoptTypeForBase(base: SocketDataType, wired: SocketDataType): SocketDataType {
  const fam = elementFamilyOf(wired);
  if (base === "anylist" || base === "anytable") {
    const baseRank = latticeRank(base);
    const wiredRank = latticeRank(wired);
    // A FAMILY-LESS wire carries nothing to adopt, so the port KEEPS ITS BASE —
    // must match `projectTypeToBase`'s family-less branch (socketConnect.test.ts).
    if (fam === null || baseRank === null || wiredRank === null) return base;
    if (wiredRank >= baseRank) return wired;
    return FAMILIES[fam][baseRank === 2 ? "matrix" : "list"];
  }
  // The rank-0/combo wildcard bases keep the SAME family-less rule.
  if ((base === "any" || base === "anycombo" || base === "anydata") && fam === null) return base;
  return wired;
}

/** The OUTPUT-side sibling of `adoptTypeForBase`: project a resolved passthrough
 *  type onto an adoptive output's declared wildcard rank, in BOTH directions
 *  (WRAPROWS widens, flatten narrows). */
export function projectTypeToBase(base: SocketDataType, t: SocketDataType): SocketDataType {
  if (base !== "anylist" && base !== "anytable") return t;
  const baseRank = latticeRank(base);
  if (baseRank === null) return t;
  const fam = elementFamilyOf(t);
  if (fam === null) return base;
  if (latticeRank(t) === baseRank) return t;
  return FAMILIES[fam][baseRank === 2 ? "matrix" : "list"];
}

/** DIRECTIONAL: may an OUTPUT of type `out` flow into an INPUT of type `in`? The
 *  one primitive under areCompatible/canConnect; narrowing is blocked by its
 *  absence from every accept-set, not by a separate rule. */
function accepts(inT: SocketDataType, outT: SocketDataType): boolean {
  if (inT === outT) return true;
  if (inT === "trueany" || outT === "trueany") return true;
  // `anycombo` may be a scalar at runtime, so it reaches an `any` input exactly as
  // every family combo reaches its own scalar (the combo→scalar exception).
  if (inT === "any") return SCALAR_COMBO_TYPES.has(outT) || outT === "anycombo";
  if (outT === "any") return inT !== "lambda" && inT !== "chart" && inT !== "document";
  if (inT === "anytable" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anylist")) return true;
  if (outT === "anytable" && MATRIX_TYPES.has(inT)) return true;
  if (inT === "anylist" && (RANK1_VALUE_TYPES.has(outT) || outT === "anycombo")) return true;
  if (outT === "anylist" && LIST_COMBO_TYPES.has(inT)) return true;
  if (inT === "anycombo" && (RANK1_VALUE_TYPES.has(outT) || outT === "anylist")) return true;
  if (outT === "anycombo") return inT !== "lambda" && inT !== "chart" && inT !== "document";
  // `anydata` (anydataWildcard, D23): only `anylist`/`anytable` outputs need naming —
  // `anycombo`/`any` outputs already reached every non-object input above.
  if (inT === "anydata" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anylist" || outT === "anytable")) return true;
  if (outT === "anydata") return inT !== "lambda" && inT !== "chart" && inT !== "document";
  // A 1-D list widens into a `frame` as a single ROW (CSV-consistent — transpose for
  // a column); coerceInputs builds the frame.
  if (inT === "frame" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anytable" || outT === "anylist")) return true;
  // A cube OUTPUT does NOT flow into any narrower container — the nesting would be
  // silently dropped — so it reaches only another cube (identity) or `any`.
  if (inT === "cube" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anytable" || outT === "anylist" || outT === "frame")) return true;
  return SOCKET_ACCEPTS[inT]?.includes(outT) ?? false;
}

/** Symmetric type-family compatibility (used for legend / highlight grouping). */
export function areCompatible(a: SocketDataType, b: SocketDataType): boolean {
  return accepts(a, b) || accepts(b, a);
}

/** DIRECTIONAL connection check used by the connection guard. */
export function canConnect(out: SocketDataType, inp: SocketDataType): boolean {
  return accepts(inp, out);
}

export class SolenoidSocket extends ClassicPreset.Socket {
  constructor(public readonly dataType: SocketDataType) {
    super(dataType);
  }
  /** Symmetric — kept for any non-connection uses. Connections use canConnectTo. */
  isCompatibleWith(socket: ClassicPreset.Socket): boolean {
    return (
      socket instanceof SolenoidSocket &&
      areCompatible(this.dataType, socket.dataType)
    );
  }
  /** Directional: can THIS socket (as an OUTPUT) connect into `input`? */
  canConnectTo(input: ClassicPreset.Socket): boolean {
    return input instanceof SolenoidSocket && canConnect(this.dataType, input.dataType);
  }
}

/** A SolenoidSocket whose dataType can change after construction (FC, Conduit
 *  lanes) — each node owns its instances so a retype never hits a shared one. */
export class MutableSocket extends SolenoidSocket {
  setType(type: SocketDataType): void {
    (this as unknown as { dataType: SocketDataType }).dataType = type;
  }
}

/** A port that ADOPTS its cable's type and reverts on disconnect; the reconcile
 *  pass finds these by `instanceof`, one instance per port, never shared. */
export class AdoptiveSocket extends MutableSocket {
  /** The type this port reverts to when unwired; a narrower base keeps the port
   *  restricted to that rung while still adopting the wired CONCRETE type. */
  constructor(public readonly base: SocketDataType = "trueany") {
    super(base);
  }
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

/** The two RANKLESS wildcard rungs — deliberately narrower than `isWildcardRung`:
 *  a rank-bearing wildcard is a real dimensional constraint, not "untyped". */
export function isWildcardType(dt: SocketDataType): boolean {
  return dt === "any" || dt === "trueany";
}

/** EVERY wildcard rung — the types carrying no ELEMENT FAMILY. Use this, not
 *  `isWildcardType`, for FAMILY resolution. */
export function isWildcardRung(dt: SocketDataType): boolean {
  return isWildcardType(dt) || dt === "anycombo" || dt === "anylist"
    || dt === "anytable" || dt === "anydata";
}
