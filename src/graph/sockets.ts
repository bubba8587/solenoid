import { ClassicPreset } from "rete";

// ─── Socket data types ────────────────────────────────────────────────────────
// Naming convention: single-word scalars (number, string, date, complex),
// plain-concat arrays (list, strlist, datelist, complexlist), combos (numlist,
// strcombo, datecombo, complexcombo — scalar OR its list), 2-D matrices (table,
// strtable, datetable, complextable — one homogeneous matrix per element family;
// `frame` is the heterogeneous named-column cross-type), the recursive container
// (`cube` — a frame of any values, the data supremum), special (any/trueany). The
// regular types form an (element × dimension) lattice — see FAMILIES below; the
// accept-sets / areCompatible / canConnect are DERIVED from it, not hand-written.
//   number  → number  / list        / numlist      / table
//   string  → string  / strlist     / strcombo     / strtable
//   date    → date    / datelist    / datecombo    / datetable
//   complex → complex / complexlist / complexcombo / complextable
// "percentage" and "weighted-list" were removed — no active socket instances.
export type SocketDataType =
  | "number"    // scalar number
  | "list"      // number[]
  | "numlist"   // number | number[] — flexible, used by element-wise math nodes
  | "string"    // scalar string
  | "strlist"   // string[]
  | "strcombo"  // string | string[] — flexible, element-wise text nodes
  | "date"      // date serial (numeric, like Excel)
  | "datelist"  // date[]
  | "datecombo" // date | date[] — flexible, element-wise date nodes
  | "complex"   // tagged { __cx, re, im } (VAL-15) — complex number (engineering / signal processing)
  | "complexlist" // Cx[] — list of complex numbers
  | "complexcombo"// complex | complex[] — flexible, element-wise complex nodes
  | "complextable"// 2-D complex matrix
  | "logical"     // scalar boolean (TRUE/FALSE) — see valueKinds.ts
  | "logicallist" // boolean[]
  | "logicalcombo"// boolean | boolean[] — flexible, element-wise logic nodes
  | "logicaltable"// 2-D boolean matrix
  | "table"     // 2-D numeric matrix (linear algebra)
  | "strtable"  // 2-D string matrix (polyform MAP/MAKEARRAY over text)
  | "datetable" // 2-D date-serial matrix (polyform MAP/MAKEARRAY over dates)
  | "anytable"  // 2-D matrix of any element type — the reshapers' output (Any 2D)
  | "anylist"   // 1-D list of ANY element type — the element-agnostic list wildcard
                // (Any List), the rank-1 sibling of `anytable`. Used by element-
                // agnostic list ops (Set). STRICT: a scalar widens to a singleton.
  | "anydata"   // ANY element type, rank ≤ 2 (scalar | list | matrix) — SOCK-9, the D23
                // rung for Expression variables/results: matrices in, frames/cubes out
  | "anycombo"  // ANY element type, scalar OR 1-D list — the element-agnostic COMBO,
                // what `numlist` is to `number`. Accepts exactly what `anylist` does;
                // the difference is that a scalar STAYS a scalar (no singleton
                // widening), so a broadcaster reads its natural rank. For a producer
                // whose result rank follows its input (Expression) or its op (Regex).
  | "frame"     // named-column data table (Matrix + headers) — see frame.ts
  | "cube"      // recursive container: a frame whose cells hold ANY value (incl. a
                // nested frame/cube) — the lattice SUPREMUM. See frame.ts CubeValue.
  | "lambda"    // first-class function value — see nodes/lambda.ts
  | "chart"     // first-class chart/visual-output value — the OBJECT socket family's
                // other member alongside lambda; identity-only (self + trueany), like lambda
  | "document"  // a whole Note/Report's renderable content (DocumentValue) — an OBJECT
                // socket, identity-only (self + trueany), like chart/lambda. Report/Note
                // OUTPUT it; a document sink (Write to Obsidian) INPUTs it.
  | "any"       // element-agnostic SCALAR — the rank-0 rung of the wildcard ladder
                // (any → anylist → anytable). Accepts any family's scalar (and combos,
                // which can be scalars); its output is a scalar of unknown family, so
                // it widens anywhere data flows. NOT the supremum — that's `trueany`.
  | "trueany";  // the TRUE wildcard/supremum — accepts and flows to everything,
                // object family included. For genuine anything-nodes (Display,
                // selectors, Cast, Report refs, composite ports, unwired lanes).

// SocketComponent renders: scalars/complex/any as circles, list types as
// squares, combos as bicolor split squares, table/frame as 2×2-grid squares,
// and `cube` as a 3-rhombus hexagon (a flat isometric cube — the recursive
// container).
// Values are CSS variables (defined in App.css) so the colors theme live —
// light mode lightens the dark array variants. Used as fills/strokes/inline
// colors everywhere (dots, cables, conduit, legend); never parsed as hex.
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
  chart:    "var(--sock-chart)",    // blue           — circle (chart/visual-output value)
  document: "var(--sock-chart)",    // blue (chart)   — a whole-document value (Note/Report content)
  any:      "var(--sock-any)",      // gray          — circle (any single value)
  trueany:  "var(--sock-any)",      // gray          — HOLLOW circle (border only; anything)
};

// Human-readable type name for a socket dot's hover title — the only
// colorblind-accessible path to "what type is this" (color alone isn't
// enough). Kept terse; the Socket Legend panel carries the fuller picture.
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

// ─── The (element × dimension) lattice ────────────────────────────────────────
// Every "regular" socket is one cell of an (element family × dimensionality)
// grid. Rather than hand-maintain the accept-sets, we DERIVE them from ONE rule:
// a value widens UP in dimensionality (scalar → list → matrix) for free, and
// narrowing back down is blocked at the socket. A `combo` is the scalar-or-list
// union a polymorphic op emits (Add(2,3) → scalar, Add([…],[…]) → list).
//
//   element   scalar    list          combo           matrix
//   number    number    list          numlist         table
//   string    string    strlist       strcombo        strtable
//   date      date      datelist      datecombo       datetable
//   complex   complex   complexlist   complexcombo    complextable
//
// To add a 5th element family: add a row here, its colors (App.css + SOCKET_COLORS),
// a render branch (SocketComponent), and a case in formatModel.ts `familyOf`
// (else the FC shows no controls for it — fail-safe but blank). The accept-sets,
// areCompatible, and canConnect all fall out — no other edits.
type Dim = "scalar" | "list" | "combo" | "matrix";

const FAMILIES: Record<string, Record<Dim, SocketDataType>> = {
  number:  { scalar: "number",  list: "list",        combo: "numlist",      matrix: "table" },
  string:  { scalar: "string",  list: "strlist",     combo: "strcombo",     matrix: "strtable" },
  date:    { scalar: "date",    list: "datelist",    combo: "datecombo",    matrix: "datetable" },
  complex: { scalar: "complex", list: "complexlist", combo: "complexcombo", matrix: "complextable" },
  logical: { scalar: "logical", list: "logicallist", combo: "logicalcombo", matrix: "logicaltable" },
};

// Highest concrete dimensionality a dim can carry: scalar 0-D, list/combo 1-D
// (combo = scalar-or-list, so 0-or-1-D ⇒ rank 1), matrix 2-D. An INPUT of dim Di
// accepts an OUTPUT of dim Do (SAME family) iff Do never exceeds Di's capacity —
// i.e. DIM_RANK[Do] ≤ DIM_RANK[Di]. That single inequality encodes most of the
// "widening flows up, narrowing is blocked" policy: a scalar feeds a list
// (singleton broadcast); a list feeds a matrix; a matrix feeds nothing narrower.
// ONE exception rides on top in `dimFlows` below: a COMBO may feed its element
// SCALAR (a combo is scalar-or-list, so it can be a scalar) — a plain `list` still
// cannot. The rank model can't express that (combo/list both rank 1).
const DIM_RANK: Record<Dim, number> = { scalar: 0, list: 1, combo: 1, matrix: 2 };
const DIMS: Dim[] = ["scalar", "list", "combo", "matrix"];

/** May a value of dim `dOut` flow into an input of dim `dIn`? The whole
 *  dimensional policy in one predicate: widening up the rank ladder, plus the ONE
 *  exception the rank model can't express — a COMBO may narrow into its element
 *  SCALAR (a combo IS scalar-or-list, so it can be a scalar). Used for BOTH the
 *  within-family accept-sets and the logical↔number bridge, so the exception can't
 *  drift out of one of them (it used to be bolted onto the within-family case only,
 *  which left `logicalcombo → number` blocked while `logical → number` flowed). */
function dimFlows(dOut: Dim, dIn: Dim): boolean {
  return DIM_RANK[dOut] <= DIM_RANK[dIn] || (dOut === "combo" && dIn === "scalar");
}

// The homogeneous 2-D matrix types + the 2-D wildcard `anytable`, but NOT `frame`
// (heterogeneous named columns — structurally distinct). `anytable` flows both
// ways among these (a reshaper's element type is unknown statically), staying 2-D
// so the narrowing block still keeps it out of 1-D/0-D inputs.
const MATRIX_TYPES = new Set<SocketDataType>([
  "table", "strtable", "datetable", "complextable", "logicaltable", "anytable",
]);

// Every concrete family value type (number/string/date/complex/logical ×
// scalar/list/combo/matrix) — i.e. any value of rank ≤ 2. A 2-D `anytable` INPUT
// accepts all of these (a lower-rank value widens in); excludes `frame` (named
// heterogeneous columns) and `lambda` (a function), which are structurally distinct.
const FAMILY_VALUE_TYPES = new Set<SocketDataType>(
  Object.values(FAMILIES).flatMap((fam) => Object.values(fam)),
);

// Rank-≤1 family values (scalar / list / combo of every family) — what an `anylist`
// INPUT accepts by dimensional widening (a matrix does NOT: that would be narrowing).
// The 1-D analogue of FAMILY_VALUE_TYPES. Derived, so a new family needs no edit.
const RANK1_VALUE_TYPES = new Set<SocketDataType>(
  Object.values(FAMILIES).flatMap((fam) => [fam.scalar, fam.list, fam.combo]),
);
// Rank-0-capable family values — what an `any` (element-agnostic SCALAR) INPUT
// accepts: every family's scalar, plus its combo (a combo CAN be a scalar — the
// same exception each family scalar makes; runtime-accepted risk if it's a list).
const SCALAR_COMBO_TYPES = new Set<SocketDataType>(
  Object.values(FAMILIES).flatMap((fam) => [fam.scalar, fam.combo]),
);
// The concrete 1-D list + combo types — where an `anylist` OUTPUT may drop (its
// element type is unknown statically, so this is a runtime-accepted risk, exactly
// like `anytable` flowing into a concrete matrix).
const LIST_COMBO_TYPES = new Set<SocketDataType>(
  Object.values(FAMILIES).flatMap((fam) => [fam.list, fam.combo]),
);

/** Derived directional accept-sets: for each lattice type, which OTHER types
 *  (same family, lower-or-equal rank) widen INTO it. Built once at module load. */
const SOCKET_ACCEPTS: Partial<Record<SocketDataType, SocketDataType[]>> = (() => {
  const map: Partial<Record<SocketDataType, SocketDataType[]>> = {};
  for (const fam of Object.values(FAMILIES)) {
    for (const di of DIMS) {
      // `dimFlows` carries the combo→scalar exception, so e.g. an Expression's
      // `numlist` output feeds a `number` rate/count input while a plain `list`
      // (1-D only) still cannot. The runtime half of this lives in coerceInputs'
      // `collapseSingleton`: a ONE-element list arriving at a combo or scalar rung IS
      // that scalar, which is what makes "a combo can be a scalar" true rather than
      // merely permitted. A longer list reaching a scalar input remains the accepted
      // risk (same as `anytable`), and `toScalar` raises `#SHAPE!` for the numeric one.
      map[fam[di]] = DIMS
        .filter((dof) => dof !== di && dimFlows(dof, di))
        .map((dof) => fam[dof]);
    }
  }
  // Cross-family coercion: logical ↔ number. A logical coerces to 1/0 in any
  // numeric context (Excel + Polars), and a 0/1 number feeds a logic input
  // (the spreadsheet multiply-by-a-condition trick). coerceInputs does the
  // runtime boolean↔number conversion; this just permits the connection. The
  // bridge mirrors the SAME dimensional rule as a within-family edge — including
  // combo→scalar, so EXACT's `logicalcombo` result reaches a `number` input just
  // as a bare `logical` does.
  const NUM = FAMILIES.number, LOG = FAMILIES.logical;
  for (const di of DIMS) {
    for (const dof of DIMS) {
      if (dimFlows(dof, di)) {
        map[NUM[di]]!.push(LOG[dof]); // logical output → numeric input
        map[LOG[di]]!.push(NUM[dof]); // numeric output → logical input
      }
    }
  }
  return map;
})();

/** The 2-D socket types — homogeneous matrices, the 2-D wildcard, the
 *  heterogeneous frame, and the recursive cube (tabular at its top level).
 *  Public predicate for "is this value 2-D?". */
export function is2DType(dt: SocketDataType): boolean {
  return MATRIX_TYPES.has(dt) || dt === "frame" || dt === "cube";
}

/** Does this socket type carry date serials (scalar, list, the scalar-or-list
 * combo, OR the matrix)? A date serial is just a number, so the SOCKET TYPE is the
 * only signal that a value should format as a date — every "is this a date?" check
 * must agree, so they all route through here (was duplicated, and `datecombo` —
 * Cast(date)'s output — kept getting forgotten, so the FC showed a raw serial). */
export function isDateType(dt: SocketDataType): boolean {
  return dt === "date" || dt === "datelist" || dt === "datecombo" || dt === "datetable";
}

export type ElementFamily = keyof typeof FAMILIES; // number | string | date | complex | logical

/** The ELEMENT family of a lattice type (any rank), or null for the structural
 *  types outside the 5-family lattice (frame, cube, anytable, chart, lambda,
 *  any, trueany). Derived from FAMILIES so a new family/dim needs no edit here. */
export function elementFamilyOf(dt: SocketDataType): ElementFamily | null {
  for (const [fam, dims] of Object.entries(FAMILIES)) {
    if (Object.values(dims).includes(dt)) return fam as ElementFamily;
  }
  return null;
}

/** The COMBO rung of a type's element family — "a scalar OR a list of F, and which
 *  one isn't knowable statically". That is the honest output type for an
 *  element-preserving EXTRACTION whose rank depends on runtime arguments: INDEX
 *  over a `datelist` yields one date for `Row 2` and the whole column for `Row [all]`,
 *  and `datecombo` is exactly the type that feeds BOTH a `date` and a `datelist`
 *  input. `null` for a type with no element family (frame / cube / the wildcards),
 *  where the extracted value genuinely could be anything. */
export function comboOfType(dt: SocketDataType): SocketDataType | null {
  const fam = elementFamilyOf(dt);
  return fam ? FAMILIES[fam].combo : null;
}

/** The COMBO rung of a NAMED element family — `comboOfType`'s sibling for a caller
 *  that already holds a family instead of a socket type. A frame column's `type`
 *  (`FrameColType`) IS a family name, so an extraction out of a named column resolves
 *  through here (INDEX over a frame: which family you get is decided by the COLUMN,
 *  not by the container's socket, which is the family-less `frame`). `null` for a
 *  name outside the lattice. */
export function comboOfFamily(fam: string): SocketDataType | null {
  return FAMILIES[fam]?.combo ?? null;
}

/** The lattice rank of a type: 0 scalar, 1 list/combo, 2 matrix — including the
 *  rank-bearing wildcard rungs any(0)/anylist(1)/anytable(2). null for the rankless
 *  structural types (frame/cube/lambda/chart/document/trueany). */
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

/** The type an adoptive INPUT should take when a cable of type `wired` lands, given
 *  the port's declared `base`. A rank-bearing wildcard base (anylist / anytable) KEEPS
 *  its rank and adopts only the wired ELEMENT family, so a lower-rank value widening in
 *  (a scalar number → a Concat-Lists `anylist` input) reads as a LIST square, not a
 *  scalar circle — the socket still represents a list. Everything else (trueany / any
 *  bases, a same-or-higher-rank wire, a non-family structural type) adopts verbatim. */
export function adoptTypeForBase(base: SocketDataType, wired: SocketDataType): SocketDataType {
  const fam = elementFamilyOf(wired);
  if (base === "anylist" || base === "anytable") {
    const baseRank = latticeRank(base);
    const wiredRank = latticeRank(wired);
    // A FAMILY-LESS wire (another wildcard — `any`/`anylist`/`anycombo`/`trueany`, or a
    // frame/cube) carries nothing to adopt, so the port KEEPS ITS BASE. Returning the
    // wired type here broke the restriction this port's whole doc comment promises: a
    // `trueany` cable into a Concat-Lists row turned that row INTO a `trueany` port, which
    // then accepted a frame or a lambda — values the node can't handle. It also erased the
    // rank glyph (a hollow ring where a list square belongs). Matches
    // `projectTypeToBase`'s family-less branch, so the two agree on every connectable pair
    // (machine-checked in socketConnect.test.ts).
    if (fam === null || baseRank === null || wiredRank === null) return base;
    if (wiredRank >= baseRank) return wired;
    return FAMILIES[fam][baseRank === 2 ? "matrix" : "list"];
  }
  // The rank-0/combo wildcard bases (`any`, `anycombo`) keep the SAME family-less
  // rule: a `trueany` cable (NA(), XLOOKUP, Get Cell) into a SWITCH row or an
  // Expression variable must not turn the port INTO `trueany` — that erased the
  // rank glyph AND made every drag-time/connection-dialog check treat the occupied
  // port as accept-anything (the exact defect the anylist/anytable branch fixed).
  if ((base === "any" || base === "anycombo" || base === "anydata") && fam === null) return base;
  // Everything else (a `trueany` base, a family-typed wire) adopts verbatim.
  return wired;
}

/** The OUTPUT-side sibling of adoptTypeForBase: project a resolved passthrough
 *  type onto an adoptive OUTPUT's declared wildcard rank, in BOTH directions —
 *  so a rank-crossing element-preserving reshape adopts the element FAMILY at
 *  the output's own rank (WRAPROWS: strlist in → strtable out on an `anytable`
 *  base; flatten: strtable in → strlist out on an `anylist` base). A family-less
 *  resolution (an un-adopted wildcard, a frame) reverts to the declared base;
 *  a non-wildcard base (trueany) adopts verbatim. */
export function projectTypeToBase(base: SocketDataType, t: SocketDataType): SocketDataType {
  if (base !== "anylist" && base !== "anytable") return t;
  const baseRank = latticeRank(base);
  if (baseRank === null) return t;
  const fam = elementFamilyOf(t);
  if (fam === null) return base;
  if (latticeRank(t) === baseRank) return t;
  return FAMILIES[fam][baseRank === 2 ? "matrix" : "list"];
}

/**
 * DIRECTIONAL: can a value from an OUTPUT of type `out` flow into an INPUT of
 * type `in`? The one primitive both areCompatible and canConnect build on.
 *  - identity / `trueany` (the supremum wildcard, either side) always connect;
 *  - `any` is the element-agnostic SCALAR (the rank-0 wildcard rung): its INPUT
 *    takes any family scalar/combo; its OUTPUT — a scalar of unknown family —
 *    widens anywhere data flows (never into the object family, lambda/chart);
 *  - `anytable` is a 2-D wildcard among MATRIX_TYPES (both directions);
 *  - otherwise the derived lattice accept-set decides (same-family widening).
 * Narrowing (list → scalar, matrix → list, anytable → 1-D, …) is simply absent
 * from every accept-set, so it's blocked here without a separate dimension rule.
 */
function accepts(inT: SocketDataType, outT: SocketDataType): boolean {
  if (inT === outT) return true;
  if (inT === "trueany" || outT === "trueany") return true;
  // `anycombo` may be a scalar at runtime, so it reaches an `any` input exactly as
  // every family combo reaches its own scalar (the combo→scalar exception) — without
  // this, retyping a Result socket from `any` to `anycombo` silently REMOVED the
  // Regex→SWITCH/CHOOSE/Set-row edges (and load silently dropped such cables).
  if (inT === "any") return SCALAR_COMBO_TYPES.has(outT) || outT === "anycombo";
  if (outT === "any") return inT !== "lambda" && inT !== "chart" && inT !== "document";
  // `anytable` as an INPUT is a 2-D, element-agnostic wildcard that any lower-rank
  // value WIDENS into — a 1-D list or a scalar of any family (TRANSPOSE of a list →
  // a column; MAP over a list), exactly as a `list` widens into a `table` input.
  if (inT === "anytable" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anylist")) return true;
  // `anytable` as an OUTPUT stays strictly 2-D: it drops into a concrete matrix
  // input but never narrows into a 1-D/0-D one.
  if (outT === "anytable" && MATRIX_TYPES.has(inT)) return true;
  // `anylist` — the 1-D element-agnostic wildcard, the rank-1 sibling of `anytable`.
  // As an INPUT, any scalar / list / combo of ANY family widens in (a matrix does not
  // — that's narrowing). As an OUTPUT, it stays 1-D: it drops into any concrete list/
  // combo input (element unknown statically → runtime-accepted, like anytable→matrix)
  // and widens UP into the 2-D containers (handled by the anytable/frame/cube rules,
  // which accept `anylist` too).
  if (inT === "anylist" && (RANK1_VALUE_TYPES.has(outT) || outT === "anycombo")) return true;
  if (outT === "anylist" && LIST_COMBO_TYPES.has(inT)) return true;
  // `anycombo` — the element-agnostic COMBO, `anylist`'s scalar-or-list sibling. It
  // ACCEPTS exactly what `anylist` accepts (the two differ only in coercion: a scalar
  // stays a scalar here). As an OUTPUT it may be a scalar, so unlike `anylist` it also
  // reaches a scalar input — i.e. it flows wherever `any` flows.
  if (inT === "anycombo" && (RANK1_VALUE_TYPES.has(outT) || outT === "anylist")) return true;
  if (outT === "anycombo") return inT !== "lambda" && inT !== "chart" && inT !== "document";
  // `anydata` — the rank-≤2 element-agnostic wildcard (SOCK-9, D23): the rung between
  // `anycombo` (refuses the matrices D23 admits) and `trueany` (admits the frames and
  // cubes D23 excludes). As an INPUT any family value of rank ≤ 2 widens in, and the
  // lower wildcards join it. As an OUTPUT it flows exactly where `anycombo` flows —
  // runtime-shaped, the same accepted risk.
  // (An `anycombo`/`any` OUTPUT already reached every non-object input via their own
  // permissive lines above, so only `anylist`/`anytable` outputs need naming here.)
  if (inT === "anydata" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anylist" || outT === "anytable")) return true;
  if (outT === "anydata") return inT !== "lambda" && inT !== "chart" && inT !== "document";
  // A `frame` INPUT accepts ANY lower-rank value by DIMENSIONAL widening — the type
  // system enforces ELEMENT separation (date/number/complex/string never auto-cross;
  // only the deliberate logical↔number bridge does) but allows DIMENSIONAL flow. So a
  // 2-D matrix → rows×cols, a 1-D list → a single ROW (CSV-consistent — transpose for
  // a column), a scalar → 1×1. coerceInputs builds the frame. (A frame OUTPUT does NOT
  // flow into a matrix input — it'd lose its headers / assume homogeneity.)
  if (inT === "frame" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anytable" || outT === "anylist")) return true;
  // A `cube` INPUT is the lattice SUPREMUM — the universal recursive container (a
  // frame whose cells may themselves hold any value). EVERY data value widens UP
  // into it: a scalar/list/matrix (→ a 1×1 / row / body of flat cells), an
  // `anytable`, or a `frame` (its flat cells). Another cube flows in as itself
  // (identity, above). Like a frame it enforces no element separation — it holds
  // whatever. A cube OUTPUT does NOT flow into any narrower container (frame /
  // matrix / list / anytable) — the nesting would be silently dropped — so it
  // reaches only another cube (identity) or `any` (both handled above). This is
  // what "closes" the socket lattice: a single top type every value reaches.
  if (inT === "cube" && (FAMILY_VALUE_TYPES.has(outT) || outT === "anytable" || outT === "anylist" || outT === "frame")) return true;
  return SOCKET_ACCEPTS[inT]?.includes(outT) ?? false;
}

/** Symmetric type-family compatibility (used for legend / highlight grouping). */
export function areCompatible(a: SocketDataType, b: SocketDataType): boolean {
  return accepts(a, b) || accepts(b, a);
}

/**
 * DIRECTIONAL connection check used by the connection guard: can a value from an
 * OUTPUT of type `out` flow into an INPUT of type `in`? Widening (scalar → list /
 * table, list → table, scalar → numlist, an `anytable` into a concrete matrix) is
 * allowed; narrowing a wider value into a smaller input is refused at the socket —
 * the user reshapes explicitly (TOCOL / Get Column) when they really do have a
 * lower-dim slice. `trueany` accepts/flows-to everything; `any` is scalar-only.
 */
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

/** A SolenoidSocket whose dataType can change after construction — for a node
 *  that ADOPTS the type flowing into it (Format Controller, Conduit lanes). Each
 *  such node owns its own instances so retyping never touches a shared singleton.
 *  The base declares `dataType` readonly for callers; the owner mutates it here. */
export class MutableSocket extends SolenoidSocket {
  setType(type: SocketDataType): void {
    (this as unknown as { dataType: SocketDataType }).dataType = type;
  }
}

/** A `trueany` PLACEHOLDER socket that ADOPTS the type of the cable plugged into
 *  it and reverts to `trueany` on disconnect — see `reconcileTrueAnyTypes`
 *  (trueAnyAdopt.ts). Marker subclass: the central reconcile pass finds adopting
 *  sockets by `instanceof`, so a node opts a port in just by constructing one.
 *  One instance per port, never shared (a retype must not leak across cards). */
export class AdoptiveSocket extends MutableSocket {
  /** The type this port reverts to when unwired. Default `trueany` (the hollow-ring
   *  placeholder). A narrower base (e.g. `anytable`, `anylist`) keeps the port
   *  RESTRICTED to that rung's acceptance while still adopting the wired cable's
   *  CONCRETE type — a `datetable` in still reads as `datetable`, but a scalar/frame
   *  is refused. Used by Build Frame / Frame from Lists to learn a matrix/list's
   *  element family (the one thing values can't recover — a date serial looks numeric). */
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

/** Both wildcard rungs — the types that carry NO family/rank information a
 *  resolver could adopt. Every "walk past untyped passthrough sockets" check
 *  (FC adoption, type-default display, conduit tracing) must treat these two
 *  identically, so they all route through here. */
export function isWildcardType(dt: SocketDataType): boolean {
  return dt === "any" || dt === "trueany";
}
