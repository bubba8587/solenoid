// The Equation node — the first ACAUSAL node in the causal dataflow graph.
// Type a relation ("V = I * R"); every variable becomes an input AND an output.
// Leave exactly one variable unknown (unwired, empty literal) and the node
// solves for it — symbolically where the algebra inverts (equationSolve.ts),
// numerically otherwise. Wire every variable and the always-present Check
// output turns into a truth check with a relative tolerance. (Literals in a
// saved graph still count as known values; the card itself is wire-driven.)
// Numeric domain only (scalars + 1-D lists; symbolic solving broadcasts).

import { ClassicPreset } from "rete";
import { numListIn, numListOut, logicalComboOut } from "./shared";
import { extractVariables, compileEvaluator, type ExprEvaluator } from "../excelFormula";
import { parseEquation, compileSolver, solveNumeric, sniffQuadratic, solveQuadratic, equalsWithin, type ParsedEquation } from "../equationSolve";
import { isSolError, solError, type SolError } from "../errorValue";

type Val = number | (number | SolError | null)[] | SolError | null;

/** Per-cell truth check with relative tolerance; broadcasts a scalar against a
 *  list, pads ragged lengths with null (indeterminate). */
function checkEquals(l: Val, r: Val): boolean | (boolean | SolError | null)[] | SolError | null {
  if (isSolError(l)) return l;
  if (isSolError(r)) return r;
  if (l === null || r === null) return null;
  if (Array.isArray(l) || Array.isArray(r)) {
    const ll = Array.isArray(l) ? l : null;
    const rl = Array.isArray(r) ? r : null;
    const len = Math.max(ll?.length ?? 0, rl?.length ?? 0);
    const out: (boolean | SolError | null)[] = [];
    for (let i = 0; i < len; i++) {
      const a = ll ? ll[i] : (l as number);
      const b = rl ? rl[i] : (r as number);
      if (isSolError(a)) { out.push(a); continue; }
      if (isSolError(b)) { out.push(b); continue; }
      if (a == null || b == null || typeof a !== "number" || typeof b !== "number") { out.push(null); continue; }
      out.push(equalsWithin(a, b));
    }
    return out;
  }
  if (typeof l !== "number" || typeof r !== "number") return null;
  return equalsWithin(l, r);
}

/** Guard one evaluator result into the node-layer Val shape. */
function guardVal(raw: unknown): Val {
  if (isSolError(raw)) return raw;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (Array.isArray(raw)) {
    return raw.map((e) => {
      if (isSolError(e)) return e;
      if (typeof e === "number") return Number.isFinite(e) ? e : null;
      return null;
    });
  }
  return null;
}

export class EquationNode extends ClassicPreset.Node {
  label: string;
  expr: string;
  locked: boolean; // pack presets may lock the relation, like Expression
  literals: Record<string, number> = {};
  varNames: string[] = [];
  /** In-node message (underdetermined, syntax) — richer than a socket error. */
  cachedError: string | null = null;
  /** Per-variable displayed value (solved or passthrough), by var name. */
  cachedValues: Record<string, Val> = {};
  /** Optional prose explaining each variable (var name → description). Kept OUT
   *  of the formula string (KaTeX never renders it); a card tooltip + a popup
   *  legend. Display-only. */
  varDescriptions: Record<string, string> = {};
  cachedHolds: boolean | (boolean | SolError | null)[] | SolError | null = null;
  /** The variable currently being solved for (accent highlight), or null. */
  solvedFor: string | null = null;

  private equation: ParsedEquation | null = null;
  private shapeError: string | null = null;
  private lhsEval: ExprEvaluator | null = null;
  private rhsEval: ExprEvaluator | null = null;
  // Solver per unknown, built lazily; null = symbolic isolation unavailable.
  private solvers = new Map<string, ExprEvaluator | null>();

  width = 240;
  height = 220;

  constructor(init?: { label?: string; expr?: string; locked?: boolean; literals?: Record<string, number>; varDescriptions?: Record<string, string> }) {
    super("Equation");
    this.label = init?.label ?? "Equation";
    this.expr = init?.expr ?? "";
    this.locked = init?.locked ?? false;
    if (init?.literals) this.literals = { ...init.literals };
    if (init?.varDescriptions) this.varDescriptions = { ...init.varDescriptions };
    // Output key stays "holds" (existing cables reference it); the user-facing
    // name is "Check".
    this.addOutput("holds", logicalComboOut("Check"));
    this._rebuild();
  }

  /** Reparse; add/remove the per-variable input AND output sockets. Returns the
   *  removed variable names so the caller can drop their cables first. */
  _rebuild(): { added: string[]; removed: string[] } {
    const prev = new Set(this.varNames);
    const next = this.expr.trim() ? extractVariables(this.expr) : [];
    const nextSet = new Set(next);

    const added: string[] = [];
    const removed: string[] = [];
    for (const v of next) {
      if (!prev.has(v)) {
        this.addInput(v, numListIn(v));
        this.addOutput(v, numListOut(v));
        added.push(v);
      }
    }
    for (const v of prev) {
      if (!nextSet.has(v)) removed.push(v); // caller removes cables, then sockets
    }

    this.varNames = next;
    this.solvers.clear();
    this.equation = null;
    this.shapeError = null;
    this.lhsEval = null;
    this.rhsEval = null;
    if (this.expr.trim()) {
      const parsed = parseEquation(this.expr);
      if (parsed === null) this.shapeError = "Syntax error";
      else if (typeof parsed === "string") this.shapeError = parsed;
      else {
        this.equation = parsed;
        this.lhsEval = compileEvaluator(parsed.lhsText);
        this.rhsEval = compileEvaluator(parsed.rhsText);
      }
    }
    return { added, removed };
  }

  private solverFor(unknown: string): ExprEvaluator | null {
    if (!this.equation) return null;
    if (!this.solvers.has(unknown)) {
      this.solvers.set(unknown, compileSolver(this.equation, unknown));
    }
    return this.solvers.get(unknown) ?? null;
  }

  data(inputs: Record<string, unknown[]>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const values: Record<string, Val> = {};
    this.cachedHolds = null;
    this.solvedFor = null;

    const finish = (error: string | null) => {
      this.cachedError = error;
      this.cachedValues = values;
      for (const v of this.varNames) out[v] = values[v] ?? null;
      out.holds = this.cachedHolds;
      return out;
    };

    if (!this.expr.trim()) return finish(null);
    if (this.shapeError || !this.equation || !this.lhsEval || !this.rhsEval) {
      return finish(this.shapeError ?? "Syntax error");
    }

    // Known = wired (even to a blank), or a typed literal. Unknown = neither.
    const env: Record<string, unknown> = {};
    const unknowns: string[] = [];
    for (const v of this.varNames) {
      if (inputs[v] !== undefined && inputs[v].length > 0) {
        env[v] = inputs[v][0];
      } else if (this.literals[v] !== undefined) {
        env[v] = this.literals[v];
      } else {
        unknowns.push(v);
      }
    }
    for (const v of this.varNames) if (!unknowns.includes(v)) values[v] = guardVal(env[v]);

    if (unknowns.length > 1) {
      return finish("Wire in all but one variable");
    }

    if (unknowns.length === 0) {
      // Fully determined → truth check.
      try {
        const l = guardVal(this.lhsEval(env));
        const r = guardVal(this.rhsEval(env));
        this.cachedHolds = checkEquals(l, r);
      } catch {
        this.cachedHolds = solError("#VALUE!", "The equation failed to evaluate");
      }
      return finish(null);
    }

    // Exactly one unknown → solve.
    const unknown = unknowns[0];
    this.solvedFor = unknown;
    // A missing/errored KNOWN makes the solve indeterminate per the usual rules.
    const knownVals = Object.values(env);
    const errIn = knownVals.find(isSolError);
    if (errIn) { values[unknown] = errIn as SolError; return finish(null); }
    if (knownVals.some((k) => k === null)) { values[unknown] = null; return finish(null); }

    // With scalar knowns, check for a QUADRATIC in the unknown before anything
    // else — symbolic isolation would keep only the principal root (x² = 36
    // must yield [−6, 6], not 6). Degree ≤ 1 returns null and falls through.
    const lhs = this.lhsEval, rhs = this.rhsEval;
    const scalarKnowns = !knownVals.some(Array.isArray);
    const residual = (x: number): number | null => {
      try {
        const e2 = { ...env, [unknown]: x };
        const l = lhs(e2), r = rhs(e2);
        if (typeof l !== "number" || typeof r !== "number") return null;
        const d = l - r;
        return Number.isFinite(d) ? d : null;
      } catch {
        return null;
      }
    };
    if (scalarKnowns) {
      const quad = sniffQuadratic(residual);
      if (quad) {
        const roots = solveQuadratic(quad);
        if (roots !== null) {
          values[unknown] = roots;
          return finish(null);
        }
      }
    }

    const solver = this.solverFor(unknown);
    if (solver) {
      try {
        values[unknown] = guardVal(solver(env));
      } catch {
        values[unknown] = solError("#VALUE!", "Solving failed to evaluate");
      }
      return finish(null);
    }

    // Numeric fallback — scalar knowns only.
    if (!scalarKnowns) {
      values[unknown] = solError("#SHAPE!", "Numeric solving works on single values — this equation only solves lists where the algebra can be inverted");
      return finish(null);
    }
    values[unknown] = solveNumeric(residual);
    return finish(null);
  }
}
