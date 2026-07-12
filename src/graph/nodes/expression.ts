import { ClassicPreset } from "rete";
import { anyListIn, resultOut, type ResultType } from "./shared";
import { extractVariables, compileEvaluator, parseFormula, type ExprEvaluator, type Ast } from "../excelFormula";
import { fxErrorToSol } from "../excelFunctions";
import { isSolError, solError } from "../errorValue";
import { isUnitCell, tagDim, type UnitCell } from "../unitValue";
import { dimEval, type DimEnv } from "../unitDimExpr";
import { type Dim, DIMENSIONLESS, isDimensionless, dimEqual } from "../dimension";

// The formula grammar is real Excel syntax (^, UPPERCASE functions, & …),
// parsed and compiled by the shared excelFormula engine. Bare names become the
// node's input sockets. See excelFormula.ts. The formula is value-polymorphic:
// a result-type selector (Number / Text / Date / Auto) declares the output's
// element type and swaps the output socket; the inputs are `any` so arrays of
// any type connect (text / dates / numbers). See nodes/shared.ts (ResultType).

/**
 * Coerce one formula result for output. A finite number (a date serial is one)
 * passes through; a string passes through (text formulas); a BOOLEAN passes
 * through (P7 logical shipped for nodes but this guard still collapsed a
 * formula's `a > b` to blank — audit finding 27; display already renders
 * TRUE/FALSE, and the logical↔number bridge covers numeric consumers).
 * Everything else — a non-finite number, undefined — collapses to the empty
 * sentinel (`null` for a scalar, `NaN` inside a list).
 */
function guard(v: unknown, scalar: boolean): unknown {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return scalar ? null : NaN;
}

/**
 * Tag a SCALAR formula result. An in-formula error becomes a tagged SolError so
 * it propagates + renders like Excel's #DIV/0! instead of collapsing to a blank:
 * our own SolError passes through, a Formula.js error maps to a code (via the shared
 * `fxErrorToSol` — the evaluator already normalizes top-level FX errors, this is the
 * belt-and-suspenders for any that reach here). Overflow is now classified AT THE OP
 * (applyOp / broadcastCall, via the shared `guardFinite`, with input awareness), so a
 * ±Inf that survives to here is a DEFINABLE infinity (an ∞ input passed through — the
 * Constant node's ∞ is first-class) and passes; only a stray NaN is caught as a
 * #DOMAIN! safety net. Anything finite/text falls through to `guard` (booleans → null, P7).
 */
function tagResult(v: unknown): unknown {
  if (isSolError(v)) return v;
  if (v instanceof Error) return fxErrorToSol(v);
  if (typeof v === "number" && Number.isNaN(v)) {
    return solError("#DOMAIN!", "The result is undefined: not a number");
  }
  return guard(v, true);
}

/** Replace any `UnitCell` with its base-SI magnitude (scalar or per list cell), so
 *  the numeric formula evaluator never sees a dimensioned object. */
function stripUnits(v: unknown): unknown {
  if (isUnitCell(v)) return v.value;
  if (Array.isArray(v)) return v.map((c) => (isUnitCell(c) ? (c as UnitCell).value : c));
  return v;
}

/** The dimension a formula input carries: a scalar UnitCell's dim, or the shared dim
 *  of a list's tagged cells (dimensionless if none / mixed). */
function envDim(v: unknown): Dim {
  if (isUnitCell(v)) return v.dim;
  if (Array.isArray(v)) {
    let dim: Dim | null = null;
    for (const c of v) {
      if (!isUnitCell(c)) continue;
      if (dim === null) dim = c.dim;
      else if (!dimEqual(dim, c.dim)) return DIMENSIONLESS; // mixed → drop
    }
    return dim ?? DIMENSIONLESS;
  }
  return DIMENSIONLESS;
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
  /** The parsed AST — kept alongside the evaluator for the DIMENSIONAL interpretation
   *  (unitDimExpr.ts `dimEval`): when inputs carry units, the formula's result unit
   *  is computed by the algebra + per-function signatures, in parallel with the
   *  numeric evaluator. Null on a syntax error (evaluator is null too). */
  ast: Ast | null = null;
  /** Optional prose explaining each variable (var name → description). Kept OUT
   *  of the formula string, so KaTeX never renders it; shown as a hover tooltip
   *  on the card and as an editable legend in the formula popup. Display-only. */
  varDescriptions: Record<string, string> = {};

  constructor(init?: { label?: string; expr?: string; locked?: boolean; resultAs?: ResultType; literals?: Record<string, number>; varDescriptions?: Record<string, string> }) {
    super("Expression");
    this.label = init?.label ?? "Expression";
    this.expr  = init?.expr  ?? "";
    this.locked = init?.locked ?? false;
    this.resultAs = init?.resultAs ?? "number";
    if (init?.literals) this.literals = { ...init.literals };
    if (init?.varDescriptions) this.varDescriptions = { ...init.varDescriptions };

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
        this.addInput(v, anyListIn(v));
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
    this.ast = parseFormula(this.expr);
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
      // Raw env keeps any UnitCell (for the dimensional interpretation); the numeric
      // evaluator runs on magnitudes (rawEnv stripped), so a dimensioned input never
      // reaches the arithmetic as an object.
      const rawEnv: Record<string, unknown> = {};
      for (const v of this.varNames) rawEnv[v] = inputs[v]?.[0] ?? this.literals[v] ?? 0;
      const env: Record<string, unknown> = {};
      for (const v of this.varNames) env[v] = stripUnits(rawEnv[v]);

      // A 2-D matrix wired into an Expression is a #SHAPE! by DESIGN — the formula
      // scope is permanently capped at scalars + 1-D lists (CLAUDE.md / dev-notes).
      // To run a formula over a table, use the LAMBDA hosts (MAP / BYROW / BYCOL /
      // REDUCE / MAKEARRAY): they apply the formula per cell/row and own the 2-D
      // iteration. Fail LOUD rather than silently mis-broadcast a matrix row.
      for (const v of this.varNames) {
        const val = rawEnv[v];
        if (Array.isArray(val) && val.some((e) => Array.isArray(e))) {
          this.cachedError = "Matrix input not supported";
          const err = solError("#SHAPE!", "A formula works on values and 1-D lists, not a 2-D matrix. Use MAP / BYROW / REDUCE to run it over a table.");
          this.cachedResult = err;
          return { result: err };
        }
      }

      // The evaluator decides broadcast-vs-aggregate per call site. Both a SCALAR
      // and each LIST element run through the SAME tagging (tagResult): an
      // in-formula error → tagged SolError (#DIV/0! / #DOMAIN! / mapped Formula.js
      // error) that PROPAGATES per-cell; overflow/NaN is already classified at the
      // producing op (guardFinite), so tagResult just passes a definable ∞ and nets
      // a stray NaN; a missing / boolean → null (P7 logical type pending). Lists now
      // carry per-cell errors and `null` as distinct kinds (array-semantics build).
      const raw = this.evaluator(env);
      let result: unknown = Array.isArray(raw)
        ? raw.map((e) => tagResult(e))
        : tagResult(raw);

      // Dimensional interpretation (Bundle 05: FC A4, step 3): only when an input
      // actually carries a unit and the result is numeric. dimEval returns the
      // result dim, a #UNIT! conflict (surface it), or null (indeterminate — drop
      // the unit). Tag the numeric result cells with a determined dimension.
      if (this.ast && this.varNames.some((v) => envDim(rawEnv[v]) !== DIMENSIONLESS && !isDimensionless(envDim(rawEnv[v])))) {
        const dimEnv: DimEnv = {};
        for (const v of this.varNames) dimEnv[v] = envDim(rawEnv[v]);
        const dr = dimEval(this.ast, dimEnv);
        if (isSolError(dr)) {
          this.cachedResult = dr; this.cachedError = null;
          return { result: dr };
        }
        if (dr !== null && !isDimensionless(dr)) {
          result = Array.isArray(result)
            ? result.map((c) => (typeof c === "number" ? tagDim(c, dr) : c))
            : (typeof result === "number" ? tagDim(result, dr) : result);
        }
      }
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
