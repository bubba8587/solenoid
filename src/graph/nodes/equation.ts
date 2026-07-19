// The Equation node — the first ACAUSAL node in the causal dataflow graph.
// Type a relation ("V = I * R"); every variable becomes an input AND an output.
// Leave exactly one variable unknown (unwired) and the node solves for it —
// symbolically where the algebra inverts (equationSolve.ts), numerically
// otherwise. Wire every variable and the always-present Check output turns
// into a truth check with a relative tolerance. The card is wire-driven: a
// variable is known ONLY through its cable — there is no inline-literal
// fallback, so a save/seed can't carry an invisible hardcoded known.
// Numeric domain only (scalars + 1-D lists; symbolic solving broadcasts).

import { ClassicPreset } from "rete";
import { numListIn, numListOut, logicalComboOut } from "./shared";
import { extractVariables, compileEvaluator, type ExprEvaluator } from "../excelFormula";
import { parseEquation, compileSolver, solveNumeric, sniffQuadratic, solveQuadratic, equalsWithin, isolate, countOccurrences, type ParsedEquation } from "../equationSolve";
import { isSolError, solError, type SolError } from "../errorValue";
import { dimEval, type DimEnv } from "../unitDimExpr";
import { isUnitCell, tagDim, unitError, type UnitCell } from "../unitValue";
import { type Dim, DIMENSIONLESS, dimEqual, isDimensionless } from "../dimension";

type Val = number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null;

// ── Units through the equation (FC A4 consistency) ──────────────────────────────
// A known wired in with a unit keeps it on its passthrough output, the numeric
// engine runs on BASE-SI magnitudes (the same convention as the arithmetic
// algebra), and the SOLVED unknown comes out in the unit the relation implies —
// dimEval over the isolated expression (V = I × R solved for R ⇒ dim(V)/dim(I)).
// A multi-occurrence unknown (a true quadratic) has no isolated form, so its unit
// stays underived (bare result — honest, not guessed).

/** The dimension a wired value carries (first tagged cell of a list). */
function dimOfVal(v: unknown): Dim {
  if (isUnitCell(v)) return v.dim;
  if (Array.isArray(v)) { for (const c of v) if (isUnitCell(c)) return c.dim; }
  return DIMENSIONLESS;
}

/** Strip a value to base-SI magnitudes for the numeric engine. */
function toBaseVal(v: unknown): unknown {
  if (isUnitCell(v)) return v.value;
  if (Array.isArray(v)) return v.map((c) => (isUnitCell(c) ? (c as UnitCell).value : c));
  return v;
}

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

/** Guard one evaluator result into the node-layer Val shape. A `UnitCell` counts
 *  as a number (its base magnitude is checked finite) so a tagged known passes
 *  through to its output with the unit intact. */
function guardVal(raw: unknown): Val {
  if (isSolError(raw)) return raw;
  if (isUnitCell(raw)) return Number.isFinite(raw.value) ? raw : null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (Array.isArray(raw)) {
    return raw.map((e) => {
      if (isSolError(e)) return e;
      if (isUnitCell(e)) return Number.isFinite(e.value) ? e : null;
      if (typeof e === "number") return Number.isFinite(e) ? e : null;
      return null;
    });
  }
  return null;
}

export class EquationNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimensional interpretation itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  expr: string;
  locked: boolean; // pack presets may lock the relation, like Expression
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

  constructor(init?: { label?: string; expr?: string; locked?: boolean; varDescriptions?: Record<string, string> }) {
    super("Equation");
    this.label = init?.label ?? "Equation";
    this.expr = init?.expr ?? "";
    this.locked = init?.locked ?? false;
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

    // Known = wired (even to a blank). Unknown = unwired.
    const env: Record<string, unknown> = {};
    const unknowns: string[] = [];
    for (const v of this.varNames) {
      if (inputs[v] !== undefined && inputs[v].length > 0) {
        env[v] = inputs[v][0];
      } else {
        unknowns.push(v);
      }
    }
    for (const v of this.varNames) if (!unknowns.includes(v)) values[v] = guardVal(env[v]);

    // Units: capture each known's dimension (for dimEval + the solved unknown's
    // derivation), then run the numeric engine on BASE-SI magnitudes — the same
    // convention as the arithmetic algebra.
    const dims: DimEnv = {};
    let anyDim = false;
    for (const v of this.varNames) {
      if (unknowns.includes(v)) continue;
      const d = dimOfVal(env[v]);
      dims[v] = d;
      if (!isDimensionless(d)) anyDim = true;
    }
    if (anyDim) for (const k of Object.keys(env)) env[k] = toBaseVal(env[k]);

    if (unknowns.length > 1) {
      return finish("Wire in all but one variable");
    }

    if (unknowns.length === 0) {
      // Fully determined → dimensional consistency FIRST (comparing a metre to a
      // second can't "hold"), then the numeric truth check on base magnitudes.
      if (anyDim) {
        const dl = dimEval(this.equation.lhs, dims);
        const dr = dimEval(this.equation.rhs, dims);
        if (isSolError(dl)) { this.cachedHolds = dl; return finish(null); }
        if (isSolError(dr)) { this.cachedHolds = dr; return finish(null); }
        if (dl !== null && dr !== null && !dimEqual(dl, dr)) {
          this.cachedHolds = unitError("The two sides carry different units.");
          return finish(null);
        }
      }
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
    // Derive the unknown's UNIT from the relation: dimEval over the isolated
    // expression with the knowns' dims (V = I × R solved for R ⇒ dim(V)/dim(I)).
    // No isolated form (a true quadratic — the unknown appears twice) ⇒ the unit
    // stays underived and the value is bare; inconsistent knowns ⇒ #UNIT!.
    const tagUnknown = () => {
      if (!anyDim || !this.equation) return;
      const raw = values[unknown];
      if (raw === null || isSolError(raw)) return;
      const eq = this.equation;
      const iso = countOccurrences(eq.lhs, unknown) === 1
        ? isolate(eq.lhs, eq.rhs, unknown)
        : countOccurrences(eq.rhs, unknown) === 1
          ? isolate(eq.rhs, eq.lhs, unknown)
          : null;
      if (!iso) return;
      const dr = dimEval(iso, dims);
      if (isSolError(dr)) { values[unknown] = dr; return; }
      if (dr === null || isDimensionless(dr)) return;
      const tag = (n: number | UnitCell | SolError | null) => (typeof n === "number" ? tagDim(n, dr) : n);
      values[unknown] = Array.isArray(raw) ? (raw.map(tag) as Val) : (tag(raw) as Val);
    };
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
          tagUnknown();
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
      tagUnknown();
      return finish(null);
    }

    // Numeric fallback — scalar knowns only.
    if (!scalarKnowns) {
      values[unknown] = solError("#SHAPE!", "Numeric solving works on single values — this equation only solves lists where the algebra can be inverted");
      return finish(null);
    }
    values[unknown] = solveNumeric(residual);
    tagUnknown();
    return finish(null);
  }
}
