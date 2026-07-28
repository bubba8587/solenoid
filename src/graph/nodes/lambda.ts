import { ClassicPreset } from "rete";
import { anyListIn, lambdaOut, readInput } from "./shared";
import { extractVariables, compilePositional, formulaSyntaxHint } from "../excelFormula";
import { solError, type SolError } from "../errorValue";

// ─── LAMBDA: a first-class function value ───────────────────────────────────────
// Excel's =LAMBDA(param, ..., calculation) as a node. The node compiles its
// formula and emits a callable VALUE down a `lambda` cable; the lambda-family
// consumers (MAP / BYROW / MAKEARRAY / REDUCE / SCAN) call it, overriding their
// embedded formula text. MAP/BYROW/MAKEARRAY bind params by POSITION; SCAN/REDUCE
// bind by NAME (D18) — a param named `acc` gets the accumulator, order-free.
//
// Variables split two ways:
//   • declared PARAMETERS (the comma-separated `params` field) stay unbound and
//     define the call signature — bound by position (MAP…) or by name (SCAN/
//     REDUCE, D18) at the call site;
//   • every OTHER variable in the formula becomes an input socket and is
//     CAPTURED into the closure at compute time — the graph-shaped equivalent
//     of Excel's LET/closure bindings (`LAMBDA(x, x * rate)` with `rate` from
//     outside). Editing the captured wire re-emits a fresh closure, so
//     consumers recompute automatically.
//
// Deliberately not supported: recursion (a self-referencing lambda is a graph
// cycle, which the dataflow engine rejects) and lambdas returning lambdas.

export interface LambdaValue {
  __lambda: true;
  params: string[];
  // Value-polymorphic, like the underlying compiled formula: a lambda body can
  // return text or a date serial, not just a number (polyform).
  fn: (...args: unknown[]) => unknown;
  /** The source body expression — carried so a consumer can RENDER the formula
   *  (e.g. the Report shows a wired lambda as KaTeX). Empty for a bare lambda. */
  expr: string;
  /** The body variables that are NOT params (captured as closure constants). A
   *  by-name consumer uses this to warn when one collides with its own variable
   *  names — the user meant a live value but got a captured constant. */
  captured?: string[];
  /** Optional per-variable prose (var name → description), carried so a Report
   *  embed can show a "where:" legend under the formula. Kept out of `expr`. */
  descriptions?: Record<string, string>;
}

/** Duck-typed brand check — lambda values cross `any` sockets and React roots. */
export function isLambdaValue(v: unknown): v is LambdaValue {
  return (
    typeof v === "object" && v !== null &&
    (v as { __lambda?: unknown }).__lambda === true &&
    typeof (v as { fn?: unknown }).fn === "function"
  );
}

export function formatLambda(v: LambdaValue): string {
  return `λ(${v.params.join(", ")})`;
}

/** A lambda-family consumer's call signature: its fixed variable names (the first
 *  `required` are mandatory; trailing ones like REDUCE's `i` are optional). For a
 *  by-name consumer (SCAN/REDUCE, D18) a wired lambda's params must be drawn from
 *  these names — order-free — and must include the required ones. */
export interface LambdaSig { vars: string[]; required: number }

/** Human signature for the advisory, optional slots in brackets: `acc, x, [i]`. */
export function formatLambdaSig(sig: LambdaSig): string {
  return sig.vars.map((v, i) => (i < sig.required ? v : `[${v}]`)).join(", ");
}

/** The consumer's own variables that a wired lambda USED in its body but did NOT
 *  declare as params — so binding by name (D18) can't reach them and they silently
 *  became captured constants (0) instead of the live per-step/per-cell value. e.g.
 *  `λ(step) = acc + value` into REDUCE captures `acc` and `value`; `λ(row) = value +
 *  row` into MAP captures `value`. Non-empty → the card advises declaring them. (A
 *  param that ISN'T one of the node's variables is a separate hard compute error in
 *  `resolveFn`, not this advisory.) */
export function undeclaredConsumerVars(captured: string[] | undefined, sig: LambdaSig): string[] {
  return (captured ?? []).filter((c) => sig.vars.includes(c));
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Compiled = (...args: unknown[]) => unknown;

export class LambdaNode extends ClassicPreset.Node {
  label: string;
  /** Comma-separated parameter names, e.g. "x" or "acc, x". */
  params: string;
  expr: string;
  literals: Record<string, number> = {};
  cachedValue: LambdaValue | null = null;
  cachedError: string | null = null;
  width = 220;
  height = 212;

  /** Optional prose explaining each variable (params + captured), kept OUT of the
   *  formula so KaTeX never renders it — a card tooltip, a popup legend, and a
   *  Report "where:" legend under the wired formula. */
  varDescriptions: Record<string, string> = {};

  // Derived — recomputed by _rebuild() whenever expr/params change.
  captured: string[] = [];
  compiled: Compiled | null = null;

  /** All the lambda's variables (params + captured, deduped) — lets extractInit
   *  filter varDescriptions to live vars uniformly with Expression/Equation. */
  get varNames(): string[] {
    const params = this.paramList();
    return [...params, ...this.captured.filter((v) => !params.includes(v))];
  }

  constructor(init?: { label?: string; expr?: string; params?: string; literals?: Record<string, number>; varDescriptions?: Record<string, string> }) {
    super("Lambda");
    this.label = init?.label ?? "LAMBDA";
    this.params = init?.params ?? "x";
    this.expr = init?.expr ?? "";
    if (init?.literals) this.literals = { ...init.literals };
    if (init?.varDescriptions) this.varDescriptions = { ...init.varDescriptions };
    this.addOutput("result", lambdaOut("λ"));
    this._rebuild();
  }

  paramList(): string[] {
    return this.params.split(",").map((s) => s.trim()).filter(Boolean);
  }

  /**
   * Reparse, re-derive captured-variable sockets, recompile. Same contract as
   * ExpressionNode._rebuild: returns { added, removed } so the caller drops
   * cables for removed sockets before removeInput (see applyLambdaChange).
   */
  _rebuild(): { added: string[]; removed: string[] } {
    const params = this.paramList();
    const prev = new Set(this.captured);
    const next = extractVariables(this.expr).filter((v) => !params.includes(v));
    const nextSet = new Set(next);

    const added: string[] = [];
    const removed: string[] = [];
    for (const v of next) {
      if (!prev.has(v)) { this.addInput(v, anyListIn(v)); added.push(v); }
    }
    for (const v of prev) {
      if (!nextSet.has(v)) removed.push(v);
    }

    this.captured = next;
    this.compiled = params.every((p) => IDENT.test(p))
      ? (compilePositional(this.expr, [...params, ...next]) as Compiled | null)
      : null;
    return { added, removed };
  }

  data(inputs: Record<string, unknown[]>): { result: LambdaValue | SolError | null } {
    // A broken lambda emits a tagged error down its cable; the consumer's guard
    // turns it into the error chain (a blank lambda would silently no-op instead).
    // The richer inline message stays in cachedError for the node's own box.
    const params = this.paramList();
    if (!params.every((p) => IDENT.test(p))) {
      this.cachedValue = null;
      this.cachedError = "Bad parameter name";
      return { result: solError("#NAME?", "A lambda parameter name isn't a valid identifier") };
    }
    if (!this.compiled) {
      this.cachedValue = null;
      const hint = this.expr.trim() ? formulaSyntaxHint(this.expr) : null;
      this.cachedError = this.expr.trim() ? (hint ?? "Syntax error") : null;
      if (!this.expr.trim()) return { result: null };
      return { result: solError("#SYNTAX!", hint ?? "The lambda body has a syntax error") };
    }
    const compiled = this.compiled;
    // Captured values resolve NOW — the closure carries them, so a consumer
    // never reaches back into the graph.
    const capturedVals = this.captured.map((v) => readInput(inputs[v], this.literals[v] ?? 0));
    const fn: Compiled = (...args) =>
      compiled(...args.slice(0, params.length), ...capturedVals);
    const descriptions = Object.keys(this.varDescriptions).length ? { ...this.varDescriptions } : undefined;
    const value: LambdaValue = { __lambda: true, params, fn, expr: this.expr, captured: [...this.captured], descriptions };
    this.cachedValue = value;
    this.cachedError = null;
    return { result: value };
  }
}
