// ─── Tagged error values — Solenoid's #DIV/0! ─────────────────────────────────
// Excel's most load-bearing UX feature is arguably that #DIV/0! / #NUM! /
// #VALUE! are VISIBLE and PROPAGATE, so a failure is traceable to its source.
// Solenoid nodes historically signalled every failure with `null`, which
// renders identically to "not wired yet" — the answer just went blank
// somewhere upstream. This module is the error-value story:
//
//  • `SolError` — a tagged plain object (tag property, not a class: survives
//    structuredClone and avoids cross-module instanceof pitfalls) carrying an
//    Excel-style code plus a structural message.
//  • `installErrorGuards(node)` — wraps a node's `data()` once, at nodecreated:
//      1. error in → error out: if any input value is an error, every output
//         is that error and the node's own logic never runs (first error wins),
//      2. a THROWING data() yields a local #ERROR! on its outputs instead of
//         killing the whole recompute pass (review §4.3),
//      3. `cachedResult` mirrors the error so the value box shows it.
//    Pass-through nodes (Conduit/Cable Switch — lane i must carry
//    lane i's error, not poison every lane) and error CONSUMERS (IFERROR,
//    IS checks) skip the input guard and see raw error values.
//  • Producers return `solError(code, msg)` instead of null where the failure
//    is a real error (not merely "blank"): division by zero, lookup miss,
//    formula eval failure, … Convert sites incrementally — null remains the
//    legitimate "no value" (empty cell) signal.
//
// Value model (array-semantics build, 2026-06-22): a list/matrix/frame CARRIES
// per-cell SolErrors (and first-class nulls) — the old "lists never contain
// errors" invariant is RELAXED. Aggregators propagate the first per-cell error
// (forAggregate); element-wise ops carry an error cell through unmorphed.
// See valueKinds.ts + subsystem-invariants "Error values".

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
//   #RANGE!   result outside representable range / overflow (splits Excel #NUM!;
//             SQLSTATE 22003; Err:512)
//   #SYNTAX!  formula text didn't parse        (splits Excel #VALUE!; Err:516)
//   #VALUE!   wrong type / operand misuse      (Excel; SQLSTATE 22018)
//   #TYPE!    wrong ELEMENT TYPE for the op     (Solenoid-specific — no Excel
//             equivalent; Excel folds this into #VALUE!). Solenoid's sockets track
//             element FAMILIES (number / text / date / complex), so feeding text
//             into a numeric op — or numbers that merely resemble date serials into
//             a date op — is a distinct, more informative failure than #VALUE!.
//   #SHAPE!   list/matrix dimension mismatch   (no Excel scalar equivalent;
//             nearest is #SPILL!)
//   #NAME?    unknown name                     (Excel; Err:525)
//   #REF!     dangling reference               (Excel; Err:524)
//   #CIRC!    circular dependency              (Err:522; Excel only warns)
//   #ERROR!   unexpected internal failure      (Err:517) — the guard's catch-all
//
// IFERROR catches every code; IFNA / ISNA match only #N/A.
import { perfEnabled, recordNode } from "./perfProbe";

export type SolErrorCode =
  | "#DIV/0!" | "#N/A"
  | "#DOMAIN!" | "#CONV!" | "#RANGE!"
  | "#SYNTAX!" | "#VALUE!" | "#TYPE!" | "#SHAPE!"
  | "#NAME?" | "#REF!" | "#CIRC!"
  | "#ERROR!";

const TAG = "__solError";

export interface SolError {
  [TAG]: true;
  code: SolErrorCode;
  /** Structural explanation ("Division by zero") — safe for tooltips. */
  message: string;
}

/**
 * Longer plain-language explanation per code — what it means and the usual
 * fix. The badge + producer message stay terse; inspection surfaces (the
 * IS-check node's explanation panel, future error tracing UI) show these.
 */
export const ERROR_EXPLANATIONS: Record<SolErrorCode, string> = {
  "#DIV/0!": "Divided by zero. Check the divisor — often an empty or zeroed field upstream.",
  "#N/A":    "A lookup or match found nothing. Check the search value, or wire an If-not-found fallback.",
  "#DOMAIN!": "An input was outside the function's domain — e.g. √ or log of a negative, or ASIN beyond ±1.",
  "#CONV!":  "An iterative solver didn't converge. Try a different starting guess, or check the inputs are solvable.",
  "#RANGE!": "The result is too large or small to represent. Reduce the input magnitudes.",
  "#SYNTAX!": "A formula couldn't be parsed. Check for unbalanced parentheses, doubled operators, or a missing argument.",
  "#VALUE!": "A value had the wrong type, or a formula failed while evaluating. Check each input is the kind of data the node expects.",
  "#TYPE!":  "The element type is wrong — e.g. a text matrix into a numeric op, or a number where a date is expected. Solenoid keeps element families (number / text / date / complex) separate, so this is more specific than #VALUE!. Cast or reshape the input.",
  "#SHAPE!": "List or matrix dimensions don't line up. Check the connected lists/tables have compatible lengths.",
  "#NAME?":  "A name wasn't recognized as a function or variable. Check the spelling in the formula.",
  "#REF!":   "A reference points at something that no longer exists — usually a deleted node or column.",
  "#CIRC!":  "A circular dependency — the calculation feeds back into itself. Remove one cable in the cycle to break it.",
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
const SEES_ERRORS = new Set([
  "IFErrorNode", "IsTestNode",
  "ConduitNode", "CableSwitchNode",
  "DisplayNode",
]);

const WRAPPED = Symbol("solErrorGuard");

type DataFn = (inputs: Record<string, unknown[] | undefined>) =>
  Record<string, unknown> | Promise<Record<string, unknown>>;

// ─── Error sinks (Problems panel hook) ────────────────────────────────────────
// A decoupling seam, same shape as nodeStoreRegistry's registerNodeForget: this
// foundational module stays store-free, but anything that wants to know "a
// node's output just became an error" (the Problems panel) can subscribe here.
// Fired at most once per node per data() call — the first error found on its
// OWN output, whether it came from a throw, the input-propagation short-circuit,
// or the node's own producer logic returning a SolError with no throw at all
// (e.g. Divide's #DIV/0!) — every one of those funnels through this module.
type ErrorSink = (nodeId: string, err: SolError) => void;
const _errorSinks: ErrorSink[] = [];
export function registerErrorSink(fn: ErrorSink): () => void {
  _errorSinks.push(fn);
  return () => {
    const i = _errorSinks.indexOf(fn);
    if (i >= 0) _errorSinks.splice(i, 1);
  };
}
function reportError(nodeId: string, err: SolError): void {
  for (const sink of _errorSinks) sink(nodeId, err);
}
function reportOut(nodeId: string, out: Record<string, unknown> | undefined): void {
  if (!out || _errorSinks.length === 0) return;
  for (const v of Object.values(out)) {
    if (isSolError(v)) { reportError(nodeId, v); return; } // first error wins, like the guard itself
  }
}

/** Idempotent. Call once per node (Canvas does, on `nodecreated`). */
export function installErrorGuards(node: object): void {
  const n = node as {
    [WRAPPED]?: boolean;
    id?: string;
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

  const errorOut = (err: SolError): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(n.outputs ?? {})) out[key] = err;
    if ("cachedResult" in n) n.cachedResult = err;
    reportError(nodeId, err);
    return out;
  };

  n.data = (inputs) => {
    if (!passRaw) {
      const err = firstInputError(inputs);
      if (err) return errorOut(err);
    }
    // Time the real data() when the probe is on — sync return or promise settle,
    // so an async frame node's IPC round-trip is included in its own row.
    const probe = perfEnabled();
    const t0 = probe ? performance.now() : 0;
    try {
      const out = orig(inputs);
      if (out instanceof Promise) {
        const guarded = out
          .then((o) => { reportOut(nodeId, o); return o; })
          .catch((e) => errorOut(fromThrown(e)));
        return probe ? guarded.finally(() => recordNode(nodeId, typeName, performance.now() - t0)) : guarded;
      }
      reportOut(nodeId, out);
      if (probe) recordNode(nodeId, typeName, performance.now() - t0);
      return out;
    } catch (e) {
      if (probe) recordNode(nodeId, typeName, performance.now() - t0);
      return errorOut(fromThrown(e));
    }
  };
}
