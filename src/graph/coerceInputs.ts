import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { SolenoidSocket, AdoptiveSocket, elementFamilyOf, type SocketDataType } from "./sockets";
import { toMatrix, toList, toScalar, toAnyMatrix, ShapeError } from "./nodes/coerce";
import { isPassthroughNode, getPassthrough } from "./nodes/passthrough";
import { isFrameValue, frameFromRows, toCube } from "./frame";
import { parseDate } from "./nodes/dateSerial";
import { coerceLogical } from "./valueKinds";
import { parseCsvLine } from "./csv";
import { isFrameRef, readFrame } from "./frameBackend";
import { isSolError } from "./errorValue";
import { stripUnitCells } from "./unitBridge";
import { isUnitCell, carryMatrixUnit } from "./unitValue";

// The relational verb nodes are LAZY: their frame inputs must reach data() as the
// raw FrameRef; every OTHER node gets one collected to a FrameValue first.
export const LAZY_FRAME_NODES: ReadonlySet<string> = new Set([
  "DistinctNode", "HeadNode", "SortFrameNode", "FilterFrameNode", "JoinNode",
  "ColumnsNode", "GroupByFrameNode", "UnpivotNode",
  "AppendNode", "BindColumnsNode", "RenameNode",
  "FillBlanksNode", "ReplaceValuesNode", "WindowNode",
  // Read through the cheap primitives (column / preview / read-at-Run) instead of a
  // full-frame collect.
  "GetColumnNode", "SumIfsNode", "TableInfoNode", "WriteFileNode", "PivotNode",
  // Slicer (control.ts): reads the schema + one column for its buttons, filters lazily.
  "SlicerNode",
]);

// 1-D non-numeric list sockets typeable in place as CSV. Exported so
// coerceInputs.test.ts can enforce that a node with such an input DECLARES
// `stringLiterals` — persistence restores literal maps only onto declaring classes.
export const TYPEABLE_LIST: ReadonlySet<string> = new Set(["strlist", "datelist", "logicallist"]);

/** The type a socket COERCES its input to: its DECLARED type — for an adoptive port
 *  its BASE, never the concrete type it adopted for color. */
function coercionType(socket: unknown): SocketDataType | undefined {
  if (socket instanceof AdoptiveSocket) return socket.base;
  return socket instanceof SolenoidSocket ? socket.dataType : undefined;
}

// ACCEPTANCE is socket-driven; the COERCION applied before data() is a NODE
// decision, defaulting to "widen to the socket's declared shape". A POLYMORPHIC node
// declares its keys on `node.rawInputs` so they pass UNCOERCED — that is what keeps a
// `cube` socket from `toCube`-ing (and type-stripping) a Frame it means to handle AS
// a frame. A BROADCASTER declares the COMBO rung instead of opting out.

/** TYPED text → logical: also yes/no/y/n/t/f, kept out of `coerceLogical` because
 *  widening that would change how every WIRED value coerces. */
function parseBoolText(p: string): boolean | null {
  const t = p.trim().toLowerCase();
  if (t === "yes" || t === "y" || t === "t") return true;
  if (t === "no"  || t === "n" || t === "f") return false;
  return coerceLogical(p);
}

export function parseListLiteral(csv: string, dt: SocketDataType): unknown[] {
  // Real CSV parsing, so a quoted value containing a comma survives; UNquoted
  // whitespace is trimmed and empty fields dropped.
  const parts = parseCsvLine(csv).map((s) => s.trim()).filter((s) => s !== "");
  // An unparseable part is first-class `null` (MISSING): dropping would shift every
  // later position, and `?? false` would assert a FALSE the user never typed.
  if (dt === "numlist" || dt === "list") return parts.map((p) => (p !== "" && Number.isFinite(Number(p)) ? Number(p) : null));
  // #AMBIGUOUS! SURFACES here rather than collapsing to a blank (dateAmbiguitySurfaces):
  // "02-03-2026" is a question, not a missing value, and a blank would answer it silently.
  if (dt === "datelist") return parts.map((p) => {
    const d = parseDate(p);
    if (isSolError(d)) return d;
    return Number.isFinite(d) ? d : null;
  });
  if (dt === "logicallist") return parts.map(parseBoolText);
  return parts;
}

// A ShapeError thrown here is NOT caught: it propagates to the error-value guard,
// which wraps every node OUTSIDE this one (Canvas installs coercion first).

type Numeric = number | number[] | number[][];

// The runtime side of the logical ↔ number bridge SOCKET_ACCEPTS permits; deep, so
// lists/matrices are covered, and `null` passes through untouched.
function boolsToNums(v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return v.map(boolsToNums);
  return v;
}
function numsToBools(v: unknown): unknown {
  // NaN's truth value is Kleene null (unknown), not a confident TRUE.
  if (typeof v === "number") return Number.isNaN(v) ? null : v !== 0;
  if (Array.isArray(v)) return v.map(numsToBools);
  return v;
}

/** True when the value is (or contains) a dimensioned `UnitCell` — only reachable
 *  for a UNIT-AWARE node; every other node's inputs are stripped upstream. */
function hasUnitCell(v: unknown): boolean {
  return isUnitCell(v) || (Array.isArray(v) && v.some(isUnitCell));
}

/** Shape by rank WITHOUT the numeric coercers, which switch on `typeof === "number"`
 *  and would throw `#SHAPE!` on a cell object; widen element-agnostically and KEEP
 *  the cell for the unit-aware node's algebra. */
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

/** A ONE-element list IS the scalar it contains for any socket whose declared rank
 *  can be 0 — the COMBO rungs and the scalar rungs. A STRICT list socket
 *  (`list`/`strlist`/`datelist`/`logicallist`/`anylist`) keeps its list; that IS the
 *  difference between the two rungs. */
function collapseSingleton(v: unknown): unknown {
  return Array.isArray(v) && v.length === 1 ? v[0] : v;
}

/** Normalize one incoming value to the shape the consuming socket declares. */
function coerceValue(dataType: SocketDataType, v: unknown): unknown {
  // A lazy frame ref (an opaque handle) or a tagged error passes through ANY socket
  // untouched.
  if (isFrameRef(v) || isSolError(v)) return v;
  // A `UnitCell` is shaped by rank without the numeric coercers, which would #SHAPE!.
  if (hasUnitCell(v)) return coerceUnitCellValue(dataType, v);
  switch (dataType) {
    case "table":
      // Preserve a homogeneous matrix unit (unitGranularity): toMatrix rebuilds the outer array
      // and would drop the non-enumerable tag. A no-op when v isn't tagged.
      return carryMatrixUnit(toMatrix(boolsToNums(v) as Numeric), v);
    case "list":
      return toList(boolsToNums(v) as Numeric);
    case "number":
      return toScalar(boolsToNums(v) as Numeric);
    case "numlist": {
      // numlist nodes broadcast number | number[]; only a 2-D table needs flattening.
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
    // `anycombo`/`anydata`: no element coercion and no rank widening — a scalar STAYS
    // a scalar (contrast `anylist` below, which widens one in); for `anydata` a matrix
    // flows whole, the formula evaluator owning the rank semantics (oneBroadcast).
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
      // A lone value widens to a 1-element array (the numeric `list` case uses toList).
      if (v == null) return v;
      return Array.isArray(v) ? v : [v];
    case "anylist":
      // Promote a lone value to a singleton — without this a number throws in the
      // node's for...of and a string iterates PER CHARACTER.
      if (v == null) return v;
      return Array.isArray(v) ? v : [v];
    case "frame":
      // A 1-D list widens into a frame as a single ROW (transpose for a column).
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

/** Element coercion WITHOUT rank widening (a `noWidenInputs` key): the value reaches
 *  data() at its natural rank, but the logical↔number bridge still applies so the
 *  node's arithmetic sees numbers. */
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
  /** Input keys the node wants UNCOERCED — it branches on the runtime shape itself. */
  rawInputs?: ReadonlySet<string>;
  /** Input keys that OPT OUT of rank widening — the value reaches data() at its
   *  natural rank, the SOCKET unchanged and element coercion still applied. Contrast
   *  `rawInputs`, which skips ALL coercion. */
  noWidenInputs?: ReadonlySet<string>;
  /** The node runs the dimension algebra itself — its inputs keep their `UnitCell`
   *  tags; every other node's are unwrapped here (the unit-blind boundary). */
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
  // A node with DYNAMIC keys (Expression) mutates the SAME Set in place, so this
  // captured reference stays live across rebuilds.
  const noWiden = node.noWidenInputs;
  // The unit-blind boundary is PER-INPUT: unitAware keeps tags on EVERY input, a
  // passthrough only on its spec-named ones; SIDE inputs unwrap.
  const keepAllUnits = node.unitAware === true;
  const isPass = !keepAllUnits && isPassthroughNode(node);

  // Runs once inputs are ref-free (none arrived, or they were materialized first).
  const coerceAll = (inputs: Record<string, unknown[]>) => {
    // Re-read the spec each pass — it can be op-dependent (Fill's coalesce rows).
    const passKeys = isPass ? new Set(getPassthrough(node).flatMap((s) => s.inputs)) : null;
    const coerced: Record<string, unknown[]> = {};
    for (const key of Object.keys(inputs)) {
      const raw = inputs[key];
      const keepUnits = keepAllUnits || (passKeys?.has(key) ?? false);
      const arr = keepUnits || !Array.isArray(raw) ? raw : (raw.map(stripUnitCells) as unknown[]);
      const socket = node.inputs?.[key]?.socket;
      // Coerce to the DECLARED base rung — data() was authored against it.
      const dt = coercionType(socket);
      if (!dt || !Array.isArray(arr)) { coerced[key] = arr; continue; }
      if (rawInputs?.has(key)) { coerced[key] = arr; continue; }
      if (noWiden?.has(key)) { coerced[key] = arr.map((v) => coerceValueNoWiden(dt, v)); continue; }
      // A narrowing failure throws ShapeError, rendered as #SHAPE! by the guard.
      coerced[key] = arr.map((v) => coerceValue(dt, v));
    }
    // An UNWIRED typeable list input gets its CSV text parsed + injected; a wired
    // cable always wins.
    const lits = node.stringLiterals;
    if (lits && node.inputs) {
      for (const key of Object.keys(node.inputs)) {
        if ((coerced[key]?.length ?? 0) > 0) continue;
        const socket = node.inputs[key]?.socket;
        const dt = socket instanceof SolenoidSocket ? socket.dataType : undefined;
        // A numlist is typeable only where the node opted in with a stringLiterals key.
        if (!dt || !(TYPEABLE_LIST.has(dt) || (dt === "numlist" && key in lits))) continue;
        const csv = lits[key];
        if (csv != null && csv.trim() !== "") coerced[key] = [parseListLiteral(csv, dt)];
      }
    }
    return orig(coerced);
  };

  node.data = (inputs: Record<string, unknown[]>) => {
    // A non-lazy node that received a FrameRef must collect it first — async, but
    // only when a ref is actually present.
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
