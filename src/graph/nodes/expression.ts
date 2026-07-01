import { ClassicPreset } from "rete";
import { anyIn, resultOut, type ResultType } from "./shared";
import { extractVariables, compileEvaluator, type ExprEvaluator } from "../excelFormula";
import { fxErrorToSol } from "../excelFunctions";
import { isSolError, solError } from "../errorValue";

// The formula grammar is real Excel syntax (^, UPPERCASE functions, & …),
// parsed and compiled by the shared excelFormula engine. Bare names become the
// node's input sockets. See excelFormula.ts. The formula is value-polymorphic:
// a result-type selector (Number / Text / Date / Auto) declares the output's
// element type and swaps the output socket; the inputs are `any` so arrays of
// any type connect (text / dates / numbers). See nodes/shared.ts (ResultType).

/**
 * Coerce one formula result for output. A finite number (a date serial is one)
 * passes through; a string passes through (text formulas). Everything else — a
 * non-finite number, a boolean comparison, undefined — collapses to the empty
 * sentinel (`null` for a scalar, `NaN` inside a list), preserving the original
 * numeric/boolean behaviour exactly while letting text and dates flow.
 */
function guard(v: unknown, scalar: boolean): unknown {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return scalar ? null : NaN;
}

/**
 * Tag a SCALAR formula result. An in-formula error becomes a tagged SolError so
 * it propagates + renders like Excel's #DIV/0! instead of collapsing to a blank:
 * our own SolError passes through, a Formula.js error maps to a code (via the shared
 * `fxErrorToSol` — the evaluator already normalizes top-level FX errors, this is the
 * belt-and-suspenders for any that reach here), and a bare non-finite number is
 * #DOMAIN! (NaN — a domain violation) / #RANGE! (overflow). Anything finite/text
 * falls through to `guard` (booleans still → null, P7).
 */
function tagResult(v: unknown): unknown {
  if (isSolError(v)) return v;
  if (v instanceof Error) return fxErrorToSol(v);
  if (typeof v === "number" && !Number.isFinite(v)) {
    return Number.isNaN(v)
      ? solError("#DOMAIN!", "The result is undefined (not a number)")
      : solError("#RANGE!", "The result is too large to represent");
  }
  return guard(v, true);
}

// ─── Expression node ──────────────────────────────────────────────────────────

export class ExpressionNode extends ClassicPreset.Node {
  label: string;
  expr: string;
  // A pack-supplied preset locks its formula: the formula box is read-only so the
  // node keeps computing what the pack promises. The header title stays editable
  // (it's just a label). Plain Expression nodes the user adds are never locked.
  locked: boolean;
  /** Declared element type of the result — swaps the output socket (combo level:
   *  numlist / strcombo / datecombo / any). `number` keeps the classic behaviour. */
  resultAs: ResultType;
  cachedResult: unknown = null;
  cachedError: string | null = null;
  literals: Record<string, number> = {};
  width  = 220;
  height = 210;

  // Derived state — recomputed whenever expr changes.
  // Public so the component can read varNames for rendering.
  varNames: string[]  = [];
  evaluator: ExprEvaluator | null = null;

  constructor(init?: { label?: string; expr?: string; locked?: boolean; resultAs?: ResultType; literals?: Record<string, number> }) {
    super("Expression");
    this.label = init?.label ?? "Expression";
    this.expr  = init?.expr  ?? "";
    this.locked = init?.locked ?? false;
    this.resultAs = init?.resultAs ?? "number";
    if (init?.literals) this.literals = { ...init.literals };

    this.addOutput("result", resultOut("Result", "combo", this.resultAs));
    this._rebuild();
  }

  /**
   * Reparse expr, add/remove input sockets, recompile.
   * Returns [added, removed] variable name sets so the caller can
   * remove cables for dropped sockets before calling `removeInput`.
   */
  _rebuild(): { added: string[]; removed: string[] } {
    const prev = new Set(this.varNames);
    const next = extractVariables(this.expr);
    const nextSet = new Set(next);

    const added:   string[] = [];
    const removed: string[] = [];

    for (const v of next) {
      if (!prev.has(v)) {
        this.addInput(v, anyIn(v));
        added.push(v);
      }
    }
    for (const v of prev) {
      if (!nextSet.has(v)) {
        removed.push(v); // caller removes cables first, then calls removeInput
      }
    }

    this.varNames = next;
    this.evaluator = compileEvaluator(this.expr);
    return { added, removed };
  }

  data(inputs: Record<string, unknown[]>): { result: unknown } {
    // Failures emit a tagged #VALUE! so DOWNSTREAM nodes show the error chain
    // (errorValue.ts); cachedError keeps the richer in-node message. An empty
    // formula is a blank, not an error.
    if (!this.evaluator) {
      this.cachedError = this.expr.trim() ? "Syntax error" : null;
      if (!this.cachedError) {
        this.cachedResult = null;
        return { result: null };
      }
      const err = solError("#SYNTAX!", "The formula has a syntax error");
      this.cachedResult = err;
      return { result: err };
    }
    try {
      const env: Record<string, unknown> = {};
      for (const v of this.varNames) env[v] = inputs[v]?.[0] ?? this.literals[v] ?? 0;

      // A 2-D matrix wired into an Expression is a #SHAPE! by DESIGN — the formula
      // scope is permanently capped at scalars + 1-D lists (CLAUDE.md / dev-notes).
      // To run a formula over a table, use the LAMBDA hosts (MAP / BYROW / BYCOL /
      // REDUCE / MAKEARRAY): they apply the formula per cell/row and own the 2-D
      // iteration. Fail LOUD rather than silently mis-broadcast a matrix row.
      for (const v of this.varNames) {
        const val = env[v];
        if (Array.isArray(val) && val.some((e) => Array.isArray(e))) {
          this.cachedError = "Matrix input not supported";
          const err = solError("#SHAPE!", "A formula works on values and 1-D lists, not a 2-D matrix — use MAP / BYROW / REDUCE to run it over a table.");
          this.cachedResult = err;
          return { result: err };
        }
      }

      // The evaluator decides broadcast-vs-aggregate per call site. Both a SCALAR
      // and each LIST element run through the SAME tagging (tagResult): an
      // in-formula error → tagged SolError (#DIV/0! / #DOMAIN! / mapped Formula.js
      // error) that PROPAGATES per-cell; a non-finite → #DOMAIN!/#RANGE!; a missing
      // / boolean → null (P7 logical type pending). Lists now carry per-cell errors
      // and `null` as distinct kinds (relaxed invariant — array-semantics build).
      const raw = this.evaluator(env);
      const result = Array.isArray(raw)
        ? raw.map((e) => tagResult(e))
        : tagResult(raw);
      this.cachedResult = result;
      this.cachedError  = null;
      return { result };
    } catch {
      this.cachedError = "Evaluation error";
      const err = solError("#VALUE!", "The formula failed to evaluate");
      this.cachedResult = err;
      return { result: err };
    }
  }
}
