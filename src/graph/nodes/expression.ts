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

// The formula grammar is real Excel syntax (^, UPPERCASE functions, & …),
// parsed and compiled by the shared excelFormula engine. Bare names become the
// node's input sockets. See excelFormula.ts. The formula is value-polymorphic:
// a result-type selector (Number / Text / Date / Auto) declares the output's
// element type and swaps the output socket; the inputs are `any` so arrays of
// any type connect (text / dates / numbers). See nodes/shared.ts (ResultType).

/**
 * Coerce one formula result for output. A finite number (a date serial is one)
 * passes through; a string passes through (text formulas); a BOOLEAN passes
 * through (display renders TRUE/FALSE, and the logical↔number bridge covers
 * numeric consumers). Everything else — a non-finite number, undefined — collapses to the empty
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
    // Rank 2 (D23): strip per row. A matrix carries ONE homogeneous unit (D20),
    // but the cells are tagged individually like a list's.
    return v.map((c) =>
      Array.isArray(c) ? c.map((e) => (isUnitCell(e) ? (e as UnitCell).value : e))
      : isUnitCell(c) ? (c as UnitCell).value : c);
  }
  return v;
}

/** The currency CODE a pure-currency formula input carries: the shared display id
 *  of its tagged cell(s), or undefined when uncoded / mixed (lenient — a computed
 *  currency has no code) / not currency at all. The code is the currency's real
 *  unit identity (VAL-19), so it rides the dim pass beside the dim. */
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

/** The dimension a formula input carries: a scalar UnitCell's dim, or the shared dim
 *  of a container's tagged cells (dimensionless if none / mixed). Rank 2 flattens —
 *  a matrix carries ONE homogeneous unit (D20), so the shared-dim walk is the same. */
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

// ─── Expression node ──────────────────────────────────────────────────────────

export class ExpressionNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  expr: string;
  // A pack-supplied preset locks its formula: the formula box is read-only so the
  // node keeps computing what the pack promises. The header title stays editable
  // (it's just a label). Plain Expression nodes the user adds are never locked.
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

  /** The result socket's RANK, reconciled to the computed VALUE (SOCK-9): the
   *  resultAs combo covers rank ≤ 1; a matrix result swaps to the same family's
   *  matrix rung, through the standard in-place-retype machinery (SOCK-7 — cables
   *  the new type can't feed drop, downstream FCs re-resolve). Value-driven, so it
   *  runs OUTSIDE data() via a microtask; headless runs (no editor) skip the swap
   *  and just flow the value. An error result leaves the socket alone. */
  private lastResultRank: 1 | 2 = 1;
  private reconcileResultRank(result: unknown): void {
    // An error RESULT (it flows through the normal return, as a value) says nothing
    // about the formula's shape — leave the socket where the last real value put it.
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
    // Failures emit a tagged #VALUE! so DOWNSTREAM nodes show the error chain
    // (errorValue.ts); cachedError keeps the richer in-node message. An empty
    // formula is a blank, not an error.
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
      // Raw env keeps any UnitCell (for the dimensional interpretation); the numeric
      // evaluator runs on magnitudes (rawEnv stripped), so a dimensioned input never
      // reaches the arithmetic as an object.
      const rawEnv: Record<string, unknown> = {};
      // A wired blank VARIABLE stays blank through the formula (`=x+1` with x blank
      // is blank, not 1) — the evaluator already carries the missing contract.
      for (const v of this.varNames) rawEnv[v] = readInput(inputs[v], this.literals[v] ?? 0);
      const env: Record<string, unknown> = {};
      for (const v of this.varNames) env[v] = stripUnits(rawEnv[v]);

      // The evaluator decides broadcast-vs-aggregate per call site. Both a SCALAR
      // and each LIST element run through the SAME tagging (tagResult): an
      // in-formula error → tagged SolError (#DIV/0! / #DOMAIN! / mapped Formula.js
      // error) that PROPAGATES per-cell; overflow/NaN is already classified at the
      // producing op (guardFinite), so tagResult just passes a definable ∞ and nets
      // a stray NaN.
      const raw = this.evaluator(env);
      let result: unknown = Array.isArray(raw)
        ? raw.map((e) => (Array.isArray(e) ? e.map(tagResult) : tagResult(e)))
        : tagResult(raw);

      // Dimensional interpretation: only when an input actually carries a unit and
      // the result is numeric. dimEval returns the
      // result dim, a #UNIT! conflict (surface it), or null (indeterminate — drop
      // the unit). Tag the numeric result cells with a determined dimension.
      if (this.ast && this.varNames.some((v) => envDim(rawEnv[v]) !== DIMENSIONLESS && !isDimensionless(envDim(rawEnv[v])))) {
        const dimEnv: DimEnv = {};
        const codeEnv: CodeEnv = {};
        for (const v of this.varNames) {
          dimEnv[v] = envDim(rawEnv[v]);
          // A pure-CURRENCY input also carries its display code — the currency's
          // real identity (VAL-19) — so the dim pass can refuse `$a + €b` the way
          // the node-side arithmeticCell does. Other dims never set a code.
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
