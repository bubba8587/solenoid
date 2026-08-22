import { ClassicPreset } from "rete";
import { anyDataIn, resultOut, resultSocket, readInput, type ResultType } from "./shared";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { extractVariables, compileEvaluator, parseFormula, type ExprEvaluator, type Ast, formulaSyntaxHint } from "../excelFormula";
import { fxErrorToSol } from "../excelFunctions";
import { isSolError, solError } from "../errorValue";
import { isUnitCell, tagDim, type UnitCell } from "../unitValue";
import { dimEval, type DimEnv, type CodeEnv } from "../unitDimExpr";
import { type Dim, DIMENSIONLESS, isDimensionless, dimEqual } from "../dimension";

/** Numbers, strings and booleans pass through; anything else — non-finite, undefined —
 *  collapses to the empty sentinel (`null` for a scalar, `NaN` inside a list). */
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
 * belt-and-suspenders for any that reach here). Overflow is classified AT THE OP
 * (applyOp / broadcastCall, via the shared `guardFinite`, with input awareness), so a
 * ±Inf that survives to here is a DEFINABLE infinity (an ∞ input passed through — the
 * Constant node's ∞ is first-class) and passes; only a stray NaN is caught as a
 * #DOMAIN! safety net. Anything finite/text falls through to `guard`.
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
  if (Array.isArray(v)) {
    // A matrix carries ONE homogeneous unit (D20) but tags cells individually (D23).
    return v.map((c) =>
      Array.isArray(c) ? c.map((e) => (isUnitCell(e) ? (e as UnitCell).value : e))
      : isUnitCell(c) ? (c as UnitCell).value : c);
  }
  return v;
}

/** The shared display id of a pure-currency input's cells — the currency's real unit
 *  identity (noMixCurrencies) — or undefined when uncoded, mixed, or not currency. */
function envCurrencyCode(v: unknown, dim: Dim): string | undefined {
  if (!dimEqual(dim, { currency: 1 })) return undefined;
  const cells = Array.isArray(v) ? v.flat() : [v];
  let code: string | undefined;
  for (const c of cells) {
    if (!isUnitCell(c) || c.display == null) continue;
    if (code === undefined) code = c.display;
    else if (code !== c.display) return undefined; // mixed within ONE input → lenient
  }
  return code;
}

/** A scalar's dim, or a container's shared cell dim (dimensionless if none/mixed);
 *  rank 2 flattens, since a matrix carries ONE homogeneous unit (D20). */
function envDim(v: unknown): Dim {
  if (isUnitCell(v)) return v.dim;
  if (Array.isArray(v)) {
    let dim: Dim | null = null;
    for (const c of v.flat()) {
      if (!isUnitCell(c)) continue;
      if (dim === null) dim = c.dim;
      else if (!dimEqual(dim, c.dim)) return DIMENSIONLESS; // mixed → drop
    }
    return dim ?? DIMENSIONLESS;
  }
  return DIMENSIONLESS;
}

export class ExpressionNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  expr: string;
  // Set only by a pack preset — the formula box goes read-only so the node keeps
  // computing what the pack promises; the header title stays editable.
  locked: boolean;
  /** Declared element type of the result — swaps the output socket (combo level:
   *  numlist / strcombo / datecombo / any). `number` keeps the classic behavior. */
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
        this.addInput(v, anyDataIn(v));
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

  /** Reconciles the result socket's RANK to the computed VALUE (anydataWildcard). Value-driven,
   *  so it must run OUTSIDE data() via a microtask; headless runs skip the swap. */
  private lastResultRank: 1 | 2 = 1;
  private reconcileResultRank(result: unknown): void {
    // An error result says nothing about shape — leave the socket where the last value put it.
    if (isSolError(result)) return;
    const want: 1 | 2 = Array.isArray(result) && result.length > 0 && Array.isArray(result[0]) ? 2 : 1;
    if (want === this.lastResultRank) return;
    this.lastResultRank = want;
    queueMicrotask(() => {
      void (async () => {
        const editor = getActiveEditor();
        const area = getActiveArea();
        const out = this.outputs.result;
        if (!editor || !area || !out || !editor.getNode(this.id)) return;
        out.socket = resultSocket(want === 2 ? "matrix" : "combo", this.resultAs);
        await retypeOutputCables(editor, area, this.id, "result");
        await area.update("node", this.id);
      })();
    });
  }

  data(inputs: Record<string, unknown[]>): { result: unknown } {
    // Failures emit a tagged error for the downstream chain; cachedError keeps the richer
    // in-node message. An empty formula is a blank, not an error.
    if (!this.evaluator) {
      const hint = this.expr.trim() ? formulaSyntaxHint(this.expr) : null;
      this.cachedError = this.expr.trim() ? (hint ?? "Syntax error") : null;
      if (!this.cachedError) {
        this.cachedResult = null;
        return { result: null };
      }
      const err = solError("#SYNTAX!", hint ?? "The formula has a syntax error");
      this.cachedResult = err;
      return { result: err };
    }
    try {
      // The evaluator runs on stripped magnitudes; rawEnv keeps UnitCells for the dim pass.
      const rawEnv: Record<string, unknown> = {};
      // A wired blank stays blank through the formula (`=x+1` with x blank is blank, not 1).
      for (const v of this.varNames) rawEnv[v] = readInput(inputs[v], this.literals[v] ?? 0);
      const env: Record<string, unknown> = {};
      for (const v of this.varNames) env[v] = stripUnits(rawEnv[v]);

      // Scalars and every list element run through the SAME tagging, so an in-formula
      // error propagates per-cell.
      const raw = this.evaluator(env);
      let result: unknown = Array.isArray(raw)
        ? raw.map((e) => (Array.isArray(e) ? e.map(tagResult) : tagResult(e)))
        : tagResult(raw);

      // Only interpret dimensions when an input actually carries a unit; dimEval's null
      // means indeterminate — drop the unit rather than guess.
      if (this.ast && this.varNames.some((v) => envDim(rawEnv[v]) !== DIMENSIONLESS && !isDimensionless(envDim(rawEnv[v])))) {
        const dimEnv: DimEnv = {};
        const codeEnv: CodeEnv = {};
        for (const v of this.varNames) {
          dimEnv[v] = envDim(rawEnv[v]);
          // The currency code rides along so the dim pass can refuse `$a + €b` (noMixCurrencies).
          const code = envCurrencyCode(rawEnv[v], dimEnv[v]);
          if (code !== undefined) codeEnv[v] = code;
        }
        const dr = dimEval(this.ast, dimEnv, codeEnv);
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
      this.reconcileResultRank(result);
      return { result };
    } catch {
      this.cachedError = "Evaluation error";
      const err = solError("#VALUE!", "The formula failed to evaluate");
      this.cachedResult = err;
      return { result: err };
    }
  }
}
