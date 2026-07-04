import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { SolenoidSocket, type SocketDataType } from "./sockets";
import { toMatrix, toList, toScalar } from "./nodes/coerce";
import { isFrameValue, frameFromRows, toCube } from "./frame";
import { parseDateToSerial } from "./nodes/date";
import { coerceLogical } from "./valueKinds";
import { parseCsvLine } from "./csv";
import { isFrameRef, readFrame } from "./frameBackend";
import { isSolError } from "./errorValue";

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
// element type and inject it as the list when the input is unwired).
const TYPEABLE_LIST: ReadonlySet<string> = new Set(["strlist", "datelist", "logicallist"]);

export function parseListLiteral(csv: string, dt: SocketDataType): unknown[] {
  // Real CSV parsing (RFC 4180 via parseCsvLine), so a value containing a comma
  // works when quoted — `"First, Last", qty` → ["First, Last", "qty"] — and a
  // literal double-quote is the doubled `""`. Trim the UNquoted whitespace and
  // drop empty fields (a trailing comma).
  const parts = parseCsvLine(csv).map((s) => s.trim()).filter((s) => s !== "");
  if (dt === "datelist") return parts.map((p) => parseDateToSerial(p));
  if (dt === "logicallist") return parts.map((p) => coerceLogical(p) ?? false);
  return parts; // strlist
}

// ─── Central input coercion ───────────────────────────────────────────────────
// The `table` socket is the supertype of the numeric lattice (see sockets.ts), so
// any numeric input may receive a scalar, a list, or a 2-D table on a cable. This
// module wraps every node's `data()` once, at creation, to normalize each incoming
// value to the shape the consuming socket declares — one shared place rather than
// coercion code duplicated across every node. Widening (scalar/list → table) is
// always safe; narrowing (table → list/number) throws a ShapeError when the data
// genuinely doesn't fit. CSV row-orientation lives in nodes/coerce.ts.
//
// A thrown ShapeError isn't caught here: it propagates out of data() to the
// error-value guard (errorValue.ts), which wraps every node OUTSIDE this one
// (Canvas installs coercion first, the guard second). The guard turns it into a
// tagged #SHAPE! value on every output, so a dimension mismatch propagates and
// renders the red badge through the same path as every other error — instead of
// the old per-node `cachedError` string only a handful of components displayed.

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

/** Normalize one incoming value to the shape the consuming socket declares. */
function coerceValue(dataType: SocketDataType, v: unknown): unknown {
  // A lazy frame ref or a tagged error passes through ANY socket untouched: a ref is
  // an opaque handle (materialized upstream in wrapNodeData for non-lazy nodes, or
  // left raw for the verb nodes), and an error propagates regardless of socket type.
  if (isFrameRef(v) || isSolError(v)) return v;
  switch (dataType) {
    case "table":
      return toMatrix(boolsToNums(v) as Numeric);
    case "list":
      return toList(boolsToNums(v) as Numeric);
    case "number":
      return toScalar(boolsToNums(v) as Numeric);
    case "numlist": {
      // numlist nodes already accept number | number[] and broadcast; only a 2-D
      // table needs flattening so their element-wise logic never sees rows. A
      // logical wired here coerces to 1/0 first.
      const n = boolsToNums(v);
      return Array.isArray(n) && Array.isArray((n as unknown[])[0]) ? toList(n as Numeric) : n;
    }
    case "logical":
    case "logicalcombo":
    case "logicaltable":
      // A 0/1 number wired into a logic input becomes a real boolean.
      return numsToBools(v);
    case "logicallist": {
      const b = numsToBools(v);
      return Array.isArray(b) ? b : [b]; // scalar widens to a singleton list
    }
    case "strlist":
    case "datelist":
    case "complexlist":
      // Non-numeric 1-D lists: a plain `list` input now accepts a scalar (it
      // widens to a singleton — see the lattice rule in sockets.ts), so promote a
      // lone value to a 1-element array; an incoming list passes through. (The
      // numeric `list` case above goes through toList, which already does this.
      // A complex value is itself a [re, im] array, so only wrap when the OUTER
      // value isn't already a list of complexes — detected by a nested array.)
      if (v == null) return v;
      if (dataType === "complexlist")
        return Array.isArray(v) && Array.isArray((v as unknown[])[0]) ? v : [v];
      return Array.isArray(v) ? v : [v];
    case "frame":
      // Any lower-rank value widens into a frame (dimensional flow): a 2-D matrix →
      // named columns (Col1, Col2…, types inferred); a 1-D list → a single ROW
      // (CSV-consistent — transpose for a column); a scalar → 1×1. A real frame
      // passes through.
      if (isFrameValue(v)) return v;
      if (v == null) return v;
      if (Array.isArray(v)) return Array.isArray((v as unknown[])[0]) ? frameFromRows(v as unknown[][]) : frameFromRows([v as unknown[]]);
      return frameFromRows([[v]]);
    case "cube":
      // The lattice supremum: EVERY value widens up into a cube (see sockets.ts).
      // A cube passes through; a frame re-brands as flat cells; a matrix → a grid
      // of cells; a list → one ROW; a scalar → 1×1. null (missing) passes through.
      if (v == null) return v;
      return toCube(v);
    default:
      return v; // scalars / combos / matrices / any — handled by the node
  }
}

type NodeLike = {
  data: (inputs: Record<string, unknown[]>) => unknown;
  inputs?: Record<string, { socket?: unknown } | undefined>;
  stringLiterals?: Record<string, string>;
  __coerced?: boolean;
};

export function wrapNodeData(node: NodeLike) {
  if (node.__coerced || typeof node.data !== "function") return;
  node.__coerced = true;
  const orig = node.data.bind(node);
  const lazy = LAZY_FRAME_NODES.has((node as { constructor: { name: string } }).constructor.name);

  // The synchronous coercion + literal-injection (the original body), run once
  // inputs are ref-free (either none arrived, or they were materialized first).
  const coerceAll = (inputs: Record<string, unknown[]>) => {
    const coerced: Record<string, unknown[]> = {};
    for (const key of Object.keys(inputs)) {
      const arr = inputs[key];
      const socket = node.inputs?.[key]?.socket;
      const dt = socket instanceof SolenoidSocket ? socket.dataType : undefined;
      if (!dt || !Array.isArray(arr)) { coerced[key] = arr; continue; }
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
        if ((coerced[key]?.length ?? 0) > 0) continue; // genuinely wired
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

/**
 * Install array-shape coercion for every node. Wraps each node's `data` as it's
 * created, so values are normalized to the consuming socket's declared shape
 * before the node runs. Call once, right after the editor is created and before
 * any nodes are added.
 */
export function installInputCoercion(editor: NodeEditor<Schemes>) {
  editor.addPipe((context) => {
    if (context.type === "nodecreated") {
      wrapNodeData(context.data as unknown as NodeLike);
    }
    return context;
  });
}
