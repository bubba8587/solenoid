import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { SolenoidSocket, AdoptiveSocket, elementFamilyOf, type SocketDataType } from "./sockets";
import { toMatrix, toList, toScalar, toAnyMatrix, ShapeError } from "./nodes/coerce";
import { isPassthroughNode, getPassthrough } from "./nodes/passthrough";
import { isFrameValue, frameFromRows, toCube } from "./frame";
import { parseDateToSerial } from "./nodes/dateSerial";
import { coerceLogical } from "./valueKinds";
import { parseCsvLine } from "./csv";
import { isFrameRef, readFrame } from "./frameBackend";
import { isSolError } from "./errorValue";
import { stripUnitCells } from "./unitBridge";
import { isUnitCell, carryMatrixUnit } from "./unitValue";

// The relational verb nodes are LAZY: they emit a FrameRef and chain it (see
// frameBackend), so their frame inputs must reach data() as the raw ref, NOT
// materialized. Every OTHER node gets a ref collected to a FrameValue here, so it
// never has to know handles exist. Keyed by class name (keepNames makes it stable).
const LAZY_FRAME_NODES: ReadonlySet<string> = new Set([
  "DistinctNode", "HeadNode", "SortFrameNode", "FilterFrameNode", "JoinNode",
  "SelectColumnsNode", "DropColumnsNode", "GroupByFrameNode", "UnpivotNode",
  "AppendNode", "RenameNode",
  // Not a verb, but reads ONE column through the backend's column primitive —
  // materializing here would force a full-frame collect (audit finding 24).
  "GetColumnNode",
]);

// 1-D non-numeric list sockets that are typeable in place as CSV (the inline
// editor stores the raw text in `node.stringLiterals[key]`; we parse it here per
// element type and inject it as the list when the input is unwired). Exported so
// coerceInputs.test.ts can enforce: any node with such an input DECLARES
// `stringLiterals` — persistence restores literal maps only onto declaring
// classes (the inline-editability convention), so an undeclared class would
// silently drop the user's typed CSV on reload.
export const TYPEABLE_LIST: ReadonlySet<string> = new Set(["strlist", "datelist", "logicallist"]);

/** The type a socket COERCES its input to: its DECLARED type. For an adoptive port
 *  that means its BASE — never the concrete type it adopted for color.
 *
 *  For a container rung (`any`/`anycombo`/`anylist`/`anytable`) that keeps the widening
 *  the socket promises: a lower-rank value still reaches the rank the node's data()
 *  expects (a scalar into an `anylist` op → `[scalar]`, not a bare scalar). */
function coercionType(socket: unknown): SocketDataType | undefined {
  if (socket instanceof AdoptiveSocket) return socket.base;
  return socket instanceof SolenoidSocket ? socket.dataType : undefined;
}

// Per-input coercion policy (the general seam): ACCEPTANCE is socket-driven (the
// lattice in sockets.ts — every rank accepts lower ranks widening in), but the
// COERCION applied before data() is a NODE decision. The default is "widen to the
// socket's declared shape" (below), which lets 95% of nodes assume their input
// shape. A POLYMORPHIC node — one that declares a wide socket (`cube`/`any`) so it
// can BRANCH on the runtime shape (XLOOKUP: frame-vs-cube; a future multi-dim INDEX/
// reshaper) — declares those input keys on `node.rawInputs`, and they pass through
// UNCOERCED. This is what keeps a `cube` socket from `toCube`-ing (and type-stripping)
// a wired Frame that the node means to handle AS a frame.
//
// A BROADCASTER (Expression, a pack element-wise node) that handles scalar-or-list
// itself declares the COMBO rung instead of opting out of the boundary: the family
// combos, or `anycombo` when the element type is unknown.

/** TYPED text → logical. `coerceLogical` is the value-model rule for a WIRED value
 *  (TRUE/FALSE + the numeric bridge); a human typing into a list box also gets the
 *  friendlier yes/no/y/n/t/f spellings, which is why this vocabulary lives here and
 *  not in `coerceLogical` — widening that would change how every wired value coerces.
 *  Anything else is Kleene null (unknown), never a defaulted FALSE. */
function parseBoolText(p: string): boolean | null {
  const t = p.trim().toLowerCase();
  if (t === "yes" || t === "y" || t === "t") return true;
  if (t === "no"  || t === "n" || t === "f") return false;
  return coerceLogical(p);
}

export function parseListLiteral(csv: string, dt: SocketDataType): unknown[] {
  // Real CSV parsing (RFC 4180 via parseCsvLine), so a value containing a comma
  // works when quoted — `"First, Last", qty` → ["First, Last", "qty"] — and a
  // literal double-quote is the doubled `""`. Trim the UNquoted whitespace and
  // drop empty fields (a trailing comma).
  const parts = parseCsvLine(csv).map((s) => s.trim()).filter((s) => s !== "");
  // A part that doesn't parse for the type is first-class `null` (MISSING) — never a
  // dropped element, a NaN, or a coerced `false`. Dropping would silently shorten the
  // list and shift every position after it; `?? false` would assert a FALSE the user
  // never typed, throwing away exactly the Kleene null `coerceLogical` returns for
  // "not coercible". A hole is visible, propagates, and Fill/Coalesce recovers it.
  if (dt === "numlist" || dt === "list") return parts.map((p) => (p !== "" && Number.isFinite(Number(p)) ? Number(p) : null));
  if (dt === "datelist") return parts.map((p) => { const n = parseDateToSerial(p); return Number.isFinite(n) ? n : null; });
  if (dt === "logicallist") return parts.map(parseBoolText);
  return parts;
}

// ─── Central input coercion ───────────────────────────────────────────────────
// Wraps every node's `data()` once, at creation, to normalize each incoming value
// to the shape the consuming socket declares. Narrowing (table → list/number)
// throws a ShapeError when the data genuinely doesn't fit.
//
// A thrown ShapeError isn't caught here: it propagates out of data() to the
// error-value guard (errorValue.ts), which wraps every node OUTSIDE this one
// (Canvas installs coercion first, the guard second). The guard turns it into a
// tagged #SHAPE! value on every output, so a dimension mismatch propagates and
// renders the red badge through the same path as every other error.

type Numeric = number | number[] | number[][];

// logical ↔ number coercion (the connection is permitted by SOCKET_ACCEPTS in
// sockets.ts; this does the runtime conversion). Deep so it covers lists/matrices.
// `null` (missing) and any other kind pass through untouched.
function boolsToNums(v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return v.map(boolsToNums);
  return v;
}
function numsToBools(v: unknown): unknown {
  // NaN is an undefined number, not a confident TRUE — its truth value is Kleene
  // null (unknown), matching R/pandas coercion, coerceLogical's "not coercible →
  // null", and the NaN→null IPC normalization. 0 → FALSE, other finite → TRUE.
  if (typeof v === "number") return Number.isNaN(v) ? null : v !== 0;
  if (Array.isArray(v)) return v.map(numsToBools);
  return v;
}

/** True when the value is (or contains, in a 1-D list) a dimensioned `UnitCell`.
 *  Only reachable in coerceValue for a UNIT-AWARE node — every other node's inputs
 *  are stripped to magnitudes before this runs (the unit-blind boundary). */
function hasUnitCell(v: unknown): boolean {
  return isUnitCell(v) || (Array.isArray(v) && v.some(isUnitCell));
}

/** Shape a unit-cell-bearing value to the socket's rank WITHOUT the numeric
 *  coercers (`toScalar`/`toList`/`toMatrix` switch on `typeof === "number"`, so a
 *  `UnitCell` object falls through and throws `#SHAPE!`). Cells are atomic scalars
 *  in the value lattice, so widen them element-agnostically and KEEP the cell (the
 *  unit-aware node runs the dimension algebra on it). Cells are scalar or 1-D only
 *  (matrices are unit-agnostic by decision), so a table/frame/cube target still
 *  widens via the element-agnostic wideners. */
function coerceUnitCellValue(dataType: SocketDataType, v: unknown): unknown {
  switch (dataType) {
    case "number": {
      if (isUnitCell(v)) return v;
      if (Array.isArray(v) && v.length === 1 && isUnitCell(v[0])) return v[0];
      throw new ShapeError(`Expected a single value, got ${Array.isArray(v) ? v.length : "a table"}`);
    }
    case "list":
    case "anylist":
      return isUnitCell(v) ? [v] : v;
    case "numlist":
      return v; // numlist broadcasts number|number[]: a scalar cell STAYS scalar (matches the numeric branch)
    case "table":
      return toAnyMatrix(v);
    case "frame":
      if (isFrameValue(v)) return v;
      return Array.isArray(v) ? frameFromRows([v as unknown[]]) : frameFromRows([[v]]);
    case "cube":
      return toCube(v);
    default:
      return v; // scalar / combo / any / trueany — the node takes the cell as-is
  }
}

/**
 * A ONE-element list IS the scalar it contains, for any socket whose declared rank
 * can be 0 — the COMBO rungs (`numlist`/`strcombo`/`datecombo`/`complexcombo`/
 * `logicalcombo`) and the scalar rungs.
 *
 * A STRICT list socket (`list`/`strlist`/`datelist`/`logicallist`/`anylist`) keeps its
 * list — that IS the difference between the two rungs, and it re-widens a scalar on
 * the way in, so the round trip is lossless.
 */
function collapseSingleton(v: unknown): unknown {
  return Array.isArray(v) && v.length === 1 ? v[0] : v;
}

/** Normalize one incoming value to the shape the consuming socket declares. */
function coerceValue(dataType: SocketDataType, v: unknown): unknown {
  // A lazy frame ref or a tagged error passes through ANY socket untouched: a ref is
  // an opaque handle (materialized upstream in wrapNodeData for non-lazy nodes, or
  // left raw for the verb nodes), and an error propagates regardless of socket type.
  if (isFrameRef(v) || isSolError(v)) return v;
  // A dimensioned `UnitCell` (only present for a unit-aware node) is shaped by rank
  // without the numeric coercers, which would #SHAPE! on the object. See above.
  if (hasUnitCell(v)) return coerceUnitCellValue(dataType, v);
  switch (dataType) {
    case "table":
      // Preserve a homogeneous matrix unit (D20) across the numeric matrix coercer:
      // toMatrix rebuilds the outer array, which would drop the non-enumerable symbol
      // tag. A numeric matrix wired into an ADOPTIVE trueany input (INDEX) adopts
      // "table", so without this its extracted cells lose the unit. carryMatrixUnit is
      // a no-op when v isn't tagged. The cells stay bare numbers (no NaN-poisoning),
      // so this is safe for the unit-blind boundary.
      return carryMatrixUnit(toMatrix(boolsToNums(v) as Numeric), v);
    case "list":
      return toList(boolsToNums(v) as Numeric);
    case "number":
      return toScalar(boolsToNums(v) as Numeric);
    case "numlist": {
      // numlist nodes already accept number | number[] and broadcast; only a 2-D
      // table needs flattening so their element-wise logic never sees rows.
      const n = boolsToNums(v);
      const flat = Array.isArray(n) && Array.isArray((n as unknown[])[0]) ? toList(n as Numeric) : n;
      return collapseSingleton(flat);
    }
    case "logicalcombo":
      return collapseSingleton(numsToBools(v));
    case "logical":
      return collapseSingleton(numsToBools(v));
    case "logicaltable":
      return numsToBools(v);
    case "string":
    case "date":
    case "complex":
    case "strcombo":
    case "datecombo":
    case "complexcombo":
    // `anycombo` is the element-agnostic one: no element coercion (the family is
    // unknown) and no rank widening — a scalar STAYS a scalar, which is the whole
    // point of the rung. Contrast `anylist` below, which widens one in.
    // `anydata` (SOCK-9) is its rank-≤2 sibling: same pass-through, and a matrix
    // flows whole — the formula evaluator owns the rank semantics (FX-10).
    case "anydata":
    case "anycombo":
      return collapseSingleton(v);
    case "logicallist": {
      const b = numsToBools(v);
      return Array.isArray(b) ? b : [b];
    }
    case "strlist":
    case "datelist":
    case "complexlist":
      // Non-numeric 1-D lists: a lone value widens to a 1-element array (the
      // numeric `list` case above gets this from toList).
      if (v == null) return v;
      return Array.isArray(v) ? v : [v];
    case "anylist":
      // The element-agnostic 1-D wildcard (Set nodes): promote a lone value to a
      // singleton — without this a number throws in the node's for...of and a
      // string iterates PER CHARACTER.
      if (v == null) return v;
      return Array.isArray(v) ? v : [v];
    case "frame":
      // A 1-D list widens into a frame as a single ROW (CSV-consistent —
      // transpose for a column).
      if (isFrameValue(v)) return v;
      if (v == null) return v;
      if (Array.isArray(v)) return Array.isArray((v as unknown[])[0]) ? frameFromRows(v as unknown[][]) : frameFromRows([v as unknown[]]);
      return frameFromRows([[v]]);
    case "cube":
      if (v == null) return v;
      return toCube(v);
    default:
      return v;
  }
}

/** Element coercion WITHOUT rank widening — the coercion for a `noWidenInputs` key.
 *  The socket's dimensional widening (scalar → singleton list, list → matrix, → frame…)
 *  is SKIPPED, so a value reaches data() at its natural rank; the node broadcasts /
 *  handles the shape itself (Expression, or a pack-authored element-wise node). The one
 *  thing kept is ELEMENT coercion — the logical↔number bridge — so the node's arithmetic
 *  still sees numbers, not booleans. Refs / errors / unit-cells pass through untouched
 *  (a unit-aware node handles cells; every other node had them stripped upstream). */
function coerceValueNoWiden(dataType: SocketDataType, v: unknown): unknown {
  if (isFrameRef(v) || isSolError(v) || hasUnitCell(v)) return v;
  const fam = elementFamilyOf(dataType);
  if (fam === "number") return boolsToNums(v);
  if (fam === "logical") return numsToBools(v);
  return v;
}

type NodeLike = {
  data: (inputs: Record<string, unknown[]>) => unknown;
  inputs?: Record<string, { socket?: unknown } | undefined>;
  stringLiterals?: Record<string, string>;
  /** Input keys the node wants UNCOERCED — it branches on the runtime shape itself
   *  (see the per-input coercion policy note above). */
  rawInputs?: ReadonlySet<string>;
  /** Input keys that OPT OUT of rank widening (the painless "unsubscribe from widening"
   *  hook — forced widening stays the default at the socket). The value reaches data()
   *  at its natural rank (a scalar stays a scalar, a list a list) instead of being
   *  widened to the socket's declared rank; the SOCKET itself is unchanged — it still
   *  accepts lower-rank values and shows its declared glyph. Element coercion (logical↔
   *  number) still applies, so this is the right flag for a BROADCASTER (Expression, or
   *  a pack node that iterates/broadcasts scalar-or-list itself). Contrast `rawInputs`,
   *  which skips ALL coercion (for a node that branches on the raw runtime shape). */
  noWidenInputs?: ReadonlySet<string>;
  /** The node runs the dimension algebra itself (FC A4) — its inputs keep their
   *  `UnitCell` tags. Everything else gets cells unwrapped to display magnitudes
   *  here (the unit-blind boundary — see unitBridge.stripUnitCells). */
  unitAware?: boolean;
  __coerced?: boolean;
};

export function wrapNodeData(node: NodeLike) {
  if (node.__coerced || typeof node.data !== "function") return;
  node.__coerced = true;
  const orig = node.data.bind(node);
  const className = (node as { constructor: { name: string } }).constructor.name;
  const lazy = LAZY_FRAME_NODES.has(className);
  const rawInputs = node.rawInputs;
  // Captured once (like rawInputs). A node with DYNAMIC keys (Expression's formula
  // variables) keeps the SAME Set object and mutates it in place, so this reference
  // stays live across rebuilds.
  const noWiden = node.noWidenInputs;
  // The unit-blind boundary, PER-INPUT: a unitAware node keeps `UnitCell` tags on
  // EVERY input; a passthrough/selector keeps them ONLY on the inputs its
  // passthrough() spec names. SIDE inputs unwrap to display magnitudes.
  const keepAllUnits = node.unitAware === true;
  const isPass = !keepAllUnits && isPassthroughNode(node);

  // The synchronous coercion + literal-injection (the original body), run once
  // inputs are ref-free (either none arrived, or they were materialized first).
  const coerceAll = (inputs: Record<string, unknown[]>) => {
    // Re-read the spec each pass — it can be op-dependent (Fill's coalesce rows).
    const passKeys = isPass ? new Set(getPassthrough(node).flatMap((s) => s.inputs)) : null;
    const coerced: Record<string, unknown[]> = {};
    for (const key of Object.keys(inputs)) {
      const raw = inputs[key];
      const keepUnits = keepAllUnits || (passKeys?.has(key) ?? false);
      const arr = keepUnits || !Array.isArray(raw) ? raw : (raw.map(stripUnitCells) as unknown[]);
      const socket = node.inputs?.[key]?.socket;
      // Coerce to the socket's DECLARED base rung, not an adopted concrete type —
      // the node's data() was authored against the base rung.
      const dt = coercionType(socket);
      if (!dt || !Array.isArray(arr)) { coerced[key] = arr; continue; }
      if (rawInputs?.has(key)) { coerced[key] = arr; continue; }
      if (noWiden?.has(key)) { coerced[key] = arr.map((v) => coerceValueNoWiden(dt, v)); continue; }
      // A narrowing failure throws ShapeError here; it propagates to the
      // error-value guard, which renders it as #SHAPE! (see the module header).
      coerced[key] = arr.map((v) => coerceValue(dt, v));
    }
    // Typed-list literals: an UNWIRED 1-D list input with CSV text in
    // `stringLiterals[key]` gets that text parsed + injected as its list — so a
    // list socket is typeable in place. A wired cable (handled above, non-empty)
    // always wins; this only fills an otherwise-empty input.
    const lits = node.stringLiterals;
    if (lits && node.inputs) {
      for (const key of Object.keys(node.inputs)) {
        if ((coerced[key]?.length ?? 0) > 0) continue;
        const socket = node.inputs[key]?.socket;
        const dt = socket instanceof SolenoidSocket ? socket.dataType : undefined;
        if (!dt || !TYPEABLE_LIST.has(dt)) continue;
        const csv = lits[key];
        if (csv != null && csv.trim() !== "") coerced[key] = [parseListLiteral(csv, dt)];
      }
    }
    return orig(coerced);
  };

  node.data = (inputs: Record<string, unknown[]>) => {
    // A non-lazy node that received a lazy FrameRef must collect it to a FrameValue
    // first (so it never sees a handle). Async, but only when a ref is actually
    // present — every other node (and the lazy verb nodes) stays on the sync path.
    if (!lazy) {
      let hasRef = false;
      for (const key of Object.keys(inputs)) {
        const arr = inputs[key];
        if (Array.isArray(arr) && arr.some(isFrameRef)) { hasRef = true; break; }
      }
      if (hasRef) {
        return (async () => {
          const mat: Record<string, unknown[]> = {};
          for (const key of Object.keys(inputs)) {
            const arr = inputs[key];
            mat[key] = Array.isArray(arr)
              ? await Promise.all(arr.map((v) => (isFrameRef(v) ? readFrame(v) : v)))
              : arr;
          }
          return coerceAll(mat);
        })();
      }
    }
    return coerceAll(inputs);
  };
}

/** Call once, right after the editor is created and before any nodes are added. */
export function installInputCoercion(editor: NodeEditor<Schemes>) {
  editor.addPipe((context) => {
    if (context.type === "nodecreated") {
      wrapNodeData(context.data as unknown as NodeLike);
    }
    return context;
  });
}
