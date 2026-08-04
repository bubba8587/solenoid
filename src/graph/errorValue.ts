// Tagged error values (`SolError`) + the per-node data() guard.
// `SolError` is a tagged plain object, not a class: it survives structuredClone
// and avoids cross-module instanceof pitfalls.
//
// The code set is deliberately MORE specific than Excel's seven, while keeping
// the #CODE! surface form Excel users recognize. Granularity follows two
// outside standards — SQLSTATE class 22 (ISO 9075 data exceptions) and
// OpenFormula / LibreOffice's Err:5xx set — mapped as:
//
//   #DIV/0!   division by zero                 (Excel; SQLSTATE 22012; Err:532)
//   #N/A      no data / lookup miss            (Excel; SQLSTATE 02000)
//   #DOMAIN!  input outside a function's domain, e.g. √−1   (splits Excel #NUM!;
//             SQLSTATE 2201E/2201F; Err:503 invalid FP operation)
//   #CONV!    iterative solver failed to converge, e.g. IRR (splits Excel #NUM!;
//             Err:523)
//   #OVERFLOW! result magnitude exceeds a ceiling — a finite computation whose true
//             answer is a really-big NUMBER the float type can't hold (2^5000), or a
//             generator asked for more elements than the cap.
//             (splits Excel #NUM!; SQLSTATE 22003; Err:512)
//   #SYNTAX!  formula text didn't parse        (splits Excel #VALUE!; Err:516)
//   #VALUE!   wrong type / operand misuse      (Excel; SQLSTATE 22018)
//   #TYPE!    wrong ELEMENT TYPE for the op     (Solenoid-specific; Excel folds
//             this into #VALUE!)
//   #SHAPE!   list/matrix dimension mismatch   (no Excel scalar equivalent;
//             nearest is #SPILL!)
//   #NAME?    unknown name                     (Excel; Err:525)
//   #REF!     dangling reference               (Excel; Err:524)
//   #CIRC!    circular dependency              (Err:522; Excel only warns)
//   #UNIT!    incommensurable units in an op     (Solenoid-specific — same element
//             type, wrong DIMENSION; see dimension.ts)
//   #ERROR!   unexpected internal failure      (Err:517) — the guard's catch-all
//
// IFERROR catches every code; IFNA / ISNA match only #N/A.
import { perfEnabled, recordNode } from "./perfProbe";

export type SolErrorCode =
  | "#DIV/0!" | "#N/A"
  | "#DOMAIN!" | "#CONV!" | "#OVERFLOW!"
  | "#SYNTAX!" | "#VALUE!" | "#TYPE!" | "#SHAPE!" | "#UNIT!"
  | "#NAME?" | "#REF!" | "#CIRC!"
  | "#SOLVE!" // the Equation node found no root (equationSolve.ts)
  | "#ERROR!";

const TAG = "__solError";

/** Where a SolError came from — set once, at mint or first relay, and never
 *  overwritten downstream (see installErrorGuards) so a chain of passthroughs
 *  still points at the original producer. */
export interface SolErrorOrigin {
  /** The minting node's id (stable name lands with bundle 01; id till then). */
  nodeId: string;
  /** The minting node's title, or its type name if untitled. */
  nodeName: string;
  /** Which input slot carried the error in, when tagged at a relay rather than
   *  at the true mint site (defensive — normally the origin is already set). */
  inputSlot?: string;
  /** Row index within a list/frame column, for a per-cell error. */
  rowIndex?: number;
}

export interface SolError {
  [TAG]: true;
  code: SolErrorCode;
  /** Structural explanation ("Division by zero") — safe for tooltips. */
  message: string;
  /** Populated by installErrorGuards — see SolErrorOrigin. */
  origin?: SolErrorOrigin;
}

/**
 * Longer plain-language explanation per code — what it means and the usual
 * fix. The badge + producer message stay terse; inspection surfaces (the
 * IS-check node's explanation panel, future error tracing UI) show these.
 */
export const ERROR_EXPLANATIONS: Record<SolErrorCode, string> = {
  "#DIV/0!": "Divided by zero. Check the divisor; the usual cause is an empty or zeroed field upstream.",
  "#N/A":    "A lookup or match found nothing. Check the search value, or wire an If-not-found fallback.",
  "#DOMAIN!": "An input was outside the function's domain, e.g. √ or log of a negative, or ASIN beyond ±1.",
  "#CONV!":  "An iterative solver didn't converge. Try a different starting guess, or check the inputs are solvable.",
  "#OVERFLOW!": "The result is too large or small to represent. Reduce the input magnitudes.",
  "#SYNTAX!": "A formula couldn't be parsed. Check for unbalanced parentheses, doubled operators, or a missing argument.",
  "#VALUE!": "A value had the wrong type, or a formula failed while evaluating. Check each input is the kind of data the node expects.",
  "#TYPE!":  "The element type is wrong, e.g. a text matrix into a numeric op, or a number where a date is expected. Solenoid keeps element families (number / text / date / complex) separate, so this is more specific than #VALUE!. Cast or reshape the input.",
  "#SHAPE!": "List or matrix dimensions don't line up. Check the connected lists/tables have compatible lengths.",
  "#UNIT!":  "The units don't match dimensionally, e.g. adding meters to seconds, or converting between quantities that measure different things. Convert one side first, or check the unit an upstream Format Controller assigned.",
  "#NAME?":  "A name wasn't recognized as a function or variable. Check the spelling in the formula.",
  "#REF!":   "A reference points at something that no longer exists, usually a deleted node or column.",
  "#CIRC!":  "A circular dependency: the calculation feeds back into itself. Remove one cable in the cycle to break it.",
  "#SOLVE!": "The Equation node found no value that satisfies the equation. Check the known values, or rearrange the equation.",
  "#ERROR!": "The node failed unexpectedly. If it persists, it's likely a Solenoid bug worth reporting.",
};

export function solError(code: SolErrorCode, message: string): SolError {
  return { [TAG]: true, code, message };
}

export function isSolError(v: unknown): v is SolError {
  return typeof v === "object" && v !== null && (v as Record<string, unknown>)[TAG] === true;
}

/** A `#N/A` (no data / lookup miss) error specifically — the one code that ISNA /
 *  IFNA match (vs ISERROR / IFERROR, which match every code). Single source of
 *  truth so the "is this not-available?" test can't drift between those nodes. */
export function isNaError(v: unknown): v is SolError {
  return isSolError(v) && v.code === "#N/A";
}

function fromThrown(e: unknown): SolError {
  // A ShapeError (nodes/coerce.ts) is a genuine dimension mismatch, not an
  // internal bug — surface it as #SHAPE! with its own descriptive message. Matched
  // by name (not instanceof) so this foundational module stays decoupled from the
  // coercion layer, consistent with the tag-not-class philosophy above.
  if (e instanceof Error && e.name === "ShapeError") {
    return solError("#SHAPE!", e.message);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return solError("#ERROR!", `This node failed to compute: ${msg}`);
}

/** First error among the (top-level) input values, if any. */
export function firstInputError(
  inputs: Record<string, unknown[] | undefined>,
): SolError | null {
  for (const arr of Object.values(inputs)) {
    if (!arr) continue;
    for (const v of arr) if (isSolError(v)) return v;
  }
  return null;
}

// Nodes whose data() must SEE error values rather than auto-propagate.
// Matched by constructor name, not instanceof (the FormulaPopup precedent).
//  - IFError / IsTest consume errors (that's their whole job),
//  - Conduit / CableSwitch route lanes independently: the generic
//    any-error → all-outputs rule would poison sibling lanes,
//  - Display is a pass-through whose value box reads `cachedValue` (not the
//    `cachedResult` the generic short-circuit mirrors to). Letting its data()
//    run on the raw error lets it both SHOW the badge and forward the error.
//  - ReportNode's inline refs are independent lanes too (one per `` `=name` ``
//    span); a bad ref must show its own error badge in place, not blank every
//    other ref in the same report. NoteNode is output-only (frontmatter fields,
//    never inputs) — kept here only so its bare data() read path stays uniform.
//  - ChartNode is a figure SINK: it must render an errored Data input as an empty
//    figure and never emit a SolError out its `chart` output, so its data() needs
//    to SEE the raw error to drop it.
const SEES_ERRORS = new Set([
  "IFErrorNode", "IsTestNode",
  "ConduitNode", "CableSwitchNode",
  "DisplayNode", "NoteNode", "ReportNode",
  "ChartNode",
]);

const WRAPPED = Symbol("solErrorGuard");

type DataFn = (inputs: Record<string, unknown[] | undefined>) =>
  Record<string, unknown> | Promise<Record<string, unknown>>;

// Duck-typed frame shape (columns of cell arrays) — NOT imported from frame.ts,
// which itself imports isSolError from this module; a real import would cycle.
interface FrameLikeColumn { values: unknown[] }
interface FrameLike { __frame: true; columns: FrameLikeColumn[] }
export function isFrameLike(v: unknown): v is FrameLike {
  return typeof v === "object" && v !== null &&
    (v as { __frame?: unknown }).__frame === true &&
    Array.isArray((v as { columns?: unknown }).columns);
}

export const CELL_SCAN_HEAD = 64;
export const CELL_SCAN_STRIDE_SAMPLES = 32;

/** The bounded set of indices to examine in a container of length `len`: the
 *  head (0..HEAD-1) plus a stride sample of the tail. Shared by errorValue's
 *  scan and the model fuzzer so both cap the same way. */
export function sampledCellIndices(len: number): number[] {
  if (len <= CELL_SCAN_HEAD) return Array.from({ length: len }, (_, i) => i);
  const idx: number[] = [];
  for (let i = 0; i < CELL_SCAN_HEAD; i++) idx.push(i);
  const step = Math.ceil((len - CELL_SCAN_HEAD) / CELL_SCAN_STRIDE_SAMPLES);
  for (let i = CELL_SCAN_HEAD; i < len; i += step) idx.push(i);
  return idx;
}

/** First SolError reachable in `v` (scalar, list, matrix, or frame) under the
 *  bounded per-cell scan. Returns null when the sampled cells are all clean.
 *  Matrix rows recurse with the SAME per-row bound, so a wide matrix stays
 *  O(constant²) worst-case, not O(rows×cols). */
export function findCellError(v: unknown): SolError | null {
  if (isSolError(v)) return v;
  if (Array.isArray(v)) {
    for (const i of sampledCellIndices(v.length)) {
      const cell = v[i];
      if (isSolError(cell)) return cell;
      if (Array.isArray(cell)) { const e = findCellError(cell); if (e) return e; }
    }
    return null;
  }
  if (isFrameLike(v)) {
    for (const col of v.columns) {
      for (const i of sampledCellIndices(col.values.length)) {
        if (isSolError(col.values[i])) return col.values[i] as SolError;
      }
    }
    return null;
  }
  return null;
}

// Same title-or-type-name derivation as nodeNames.ts's baseName — duplicated
// (rather than imported) because nodeNames.ts pulls in process.ts/rete-nodes.ts,
// which would cycle back into this foundational module.
function nodeDisplayName(n: { label?: string; constructor: { name: string } }): string {
  const label = n.label?.trim();
  return label || n.constructor.name.replace(/Node$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Tag every untagged SolError reachable at the top level of `v` (scalar, list,
 *  or frame column) with `origin`, tracking row index for list/frame cells.
 *  Already-tagged errors (an upstream mint, or a passthrough relay) are left
 *  alone — origin always points at the FIRST place an error was seen, never
 *  the last hop it passed through. No-op (returns `v` unchanged, no copy) when
 *  there's nothing untagged, so this costs nothing on the (overwhelmingly
 *  common) error-free path. */
function withOrigin(v: unknown, nodeId: string, nodeName: string): unknown {
  if (isSolError(v)) return v.origin ? v : { ...v, origin: { nodeId, nodeName } };
  if (Array.isArray(v)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < v.length; i++) {
      const cell = v[i];
      if (isSolError(cell) && !cell.origin) {
        if (!out) out = v.slice();
        out[i] = { ...cell, origin: { nodeId, nodeName, rowIndex: i } };
      }
    }
    return out ?? v;
  }
  if (isFrameLike(v)) {
    let out: FrameLike | null = null;
    v.columns.forEach((col, ci) => {
      let values: unknown[] | null = null;
      for (let i = 0; i < col.values.length; i++) {
        const cell = col.values[i];
        if (isSolError(cell) && !cell.origin) {
          if (!values) values = col.values.slice();
          values[i] = { ...cell, origin: { nodeId, nodeName, rowIndex: i } };
        }
      }
      if (values) {
        if (!out) out = { ...v, columns: v.columns.slice() };
        out.columns[ci] = { ...col, values };
      }
    });
    return out ?? v;
  }
  return v;
}

/** Which input slot (top-level key of `inputs`) carries `err` — for tagging an
 *  origin at a relay when the error somehow reached here untagged. */
function findInputSlot(inputs: Record<string, unknown[] | undefined>, err: SolError): string | undefined {
  for (const [key, arr] of Object.entries(inputs)) {
    if (arr?.includes(err)) return key;
  }
  return undefined;
}

// ─── Error sinks (Problems panel hook) ────────────────────────────────────────
// A decoupling seam, same shape as nodeStoreRegistry's registerNodeForget: this
// foundational module stays store-free, but anything that wants to know "a
// node's output just became an error" (the Problems panel) can subscribe here.
// Fired at most once per node per data() call — the first error found on its
// OWN output, whether it came from a throw, the input-propagation short-circuit,
// or the node's own producer logic returning a SolError with no throw at all
// (e.g. Divide's #DIV/0!) — every one of those funnels through this module.
// `err === null` means the node's output is CLEAN this pass — a sink uses it to
// reset its per-node edge-detect, so a failure that clears and later RECURS is
// logged as new instead of suppressed forever by last-code equality.
type ErrorSink = (nodeId: string, err: SolError | null) => void;
const _errorSinks: ErrorSink[] = [];
export function registerErrorSink(fn: ErrorSink): () => void {
  _errorSinks.push(fn);
  return () => {
    const i = _errorSinks.indexOf(fn);
    if (i >= 0) _errorSinks.splice(i, 1);
  };
}
function reportError(nodeId: string, err: SolError | null): void {
  for (const sink of _errorSinks) sink(nodeId, err);
}
function reportOut(nodeId: string, out: Record<string, unknown> | undefined): void {
  if (!out || _errorSinks.length === 0) return;
  for (const v of Object.values(out)) {
    // Reports the (already origin-tagged, by the time this runs) error — first
    // error wins, like the guard itself. findCellError also catches a per-cell
    // error inside a list/matrix/frame (bounded scan), so a bad column surfaces
    // in the Problems panel, not just a top-level scalar failure.
    const err = findCellError(v);
    if (err) { reportError(nodeId, err); return; }
  }
  reportError(nodeId, null); // clean pass — reset the sinks' edge-detect
}

/** Idempotent. Call once per node (Canvas does, on `nodecreated`). */
export function installErrorGuards(node: object): void {
  const n = node as {
    [WRAPPED]?: boolean;
    id?: string;
    label?: string;
    data?: DataFn;
    outputs?: Record<string, unknown>;
    cachedResult?: unknown;
    constructor: { name: string };
  };
  if (typeof n.data !== "function" || n[WRAPPED]) return;
  n[WRAPPED] = true;

  const orig = n.data.bind(n);
  const passRaw = SEES_ERRORS.has(n.constructor.name);
  // Stable identity for the perf probe (only read when the probe is on).
  const typeName = n.constructor.name;
  const nodeId = n.id ?? "?";

  // errorOut() runs at BOTH the input-error short-circuit and the throw catch,
  // so it's also the one place that tags an origin that arrived untagged
  // (defensive — a fully-tagged graph never hits this): `inputs`, when passed,
  // lets it name the input slot the error entered on.
  const errorOut = (err: SolError, inputs?: Record<string, unknown[] | undefined>): Record<string, unknown> => {
    const tagged: SolError = err.origin ? err : {
      ...err,
      origin: { nodeId, nodeName: nodeDisplayName(n), inputSlot: inputs && findInputSlot(inputs, err) },
    };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(n.outputs ?? {})) out[key] = tagged;
    if ("cachedResult" in n) n.cachedResult = tagged;
    reportError(nodeId, tagged);
    return out;
  };

  // Tags a node's OWN result (the common mint site — a producer returning
  // solError(...) directly, not via a thrown exception or an errored input).
  const tagOutputs = (out: Record<string, unknown>): Record<string, unknown> => {
    let changed = false;
    const tagged: Record<string, unknown> = {};
    const nodeName = nodeDisplayName(n);
    for (const [k, v] of Object.entries(out)) {
      const t = withOrigin(v, nodeId, nodeName);
      tagged[k] = t;
      if (t !== v) changed = true;
    }
    const result = changed ? tagged : out;
    reportOut(nodeId, result); // reports the origin-tagged value, not the raw one
    return result;
  };

  n.data = (inputs) => {
    if (!passRaw) {
      const err = firstInputError(inputs);
      if (err) return errorOut(err, inputs);
    }
    // Time the real data() when the probe is on — sync return or promise settle,
    // so an async frame node's IPC round-trip is included in its own row.
    const probe = perfEnabled();
    const t0 = probe ? performance.now() : 0;
    try {
      const out = orig(inputs);
      if (out instanceof Promise) {
        const guarded = out.then(tagOutputs, (e) => errorOut(fromThrown(e)));
        return probe ? guarded.finally(() => recordNode(nodeId, typeName, performance.now() - t0)) : guarded;
      }
      const tagged = tagOutputs(out);
      if (probe) recordNode(nodeId, typeName, performance.now() - t0);
      return tagged;
    } catch (e) {
      if (probe) recordNode(nodeId, typeName, performance.now() - t0);
      return errorOut(fromThrown(e));
    }
  };
}
