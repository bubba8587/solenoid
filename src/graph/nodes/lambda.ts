import { ClassicPreset } from "rete";
import { anyListIn, lambdaOut, readInput } from "./shared";
import { extractVariables, atColNames, compilePositional, formulaSyntaxHint } from "../excelFormula";
export { isLambdaValue, type LambdaValue } from "../lambdaValue";
import { type LambdaValue } from "../lambdaValue";
import { solError, type SolError } from "../errorValue";

// Declared PARAMETERS stay unbound; every OTHER variable becomes an input socket and is
// CAPTURED into the closure at compute time. No recursion, no lambdas returning lambdas.

export function formatLambda(v: LambdaValue): string {
  return `λ(${v.params.join(", ")})`;
}

/** A consumer's call signature; the first `required` vars are mandatory. A by-name
 *  consumer's params must be drawn from these names, order-free (lambdaBindsByName). */
export interface LambdaSig { vars: string[]; required: number }

/** Human signature for the advisory, optional slots in brackets: `acc, x, [i]`. */
export function formatLambdaSig(sig: LambdaSig): string {
  return sig.vars.map((v, i) => (i < sig.required ? v : `[${v}]`)).join(", ");
}

/** Consumer variables the lambda USED but did not DECLARE — by-name binding can't reach
 *  them, so they silently became captured constants (0); non-empty → the card advises. */
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

  /** Prose per variable, kept OUT of the formula so KaTeX never renders it. */
  varDescriptions: Record<string, string> = {};

  // Derived — recomputed by _rebuild() whenever expr/params change.
  captured: string[] = [];
  compiled: Compiled | null = null;

  /** Params + captured, deduped — extractInit filters varDescriptions against it. */
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

  /** Returns { added, removed } so the caller drops cables for removed sockets BEFORE
   *  removeInput (same contract as ExpressionNode._rebuild). */
  _rebuild(): { added: string[]; removed: string[] } {
    const params = this.paramList();
    const prev = new Set(this.captured);
    // Free variables AND @names both grow a socket; at row-eval, columns/builtins win
    // over the capture, and `row`/`rows` are builtins so they capture nothing.
    const next = [...new Set([...extractVariables(this.expr), ...atColNames(this.expr)])]
      .filter((v) => !params.includes(v) && v !== "row" && v !== "rows");
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
    // A broken lambda emits a tagged error down its cable so the consumer's guard chains
    // it; a blank lambda would silently no-op instead.
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
    // Captured values resolve NOW, so a consumer never reaches back into the graph.
    const capturedVals = this.captured.map((v) => readInput(inputs[v], this.literals[v] ?? 0));
    // IDENTITY-STABLE output: consumers and the backend upload cache key memos on value
    // identity, so an unchanged recompute must return the SAME LambdaValue object.
    const descJson = JSON.stringify(this.varDescriptions);
    const last = this._lastBuild;
    if (
      this.cachedValue && last && last.expr === this.expr && last.params === this.params &&
      last.descJson === descJson && last.capturedVals.length === capturedVals.length &&
      last.capturedVals.every((v, i) => Object.is(v, capturedVals[i]))
    ) {
      return { result: this.cachedValue };
    }
    const fn: Compiled = (...args) =>
      compiled(...args.slice(0, params.length), ...capturedVals);
    const descriptions = Object.keys(this.varDescriptions).length ? { ...this.varDescriptions } : undefined;
    const value: LambdaValue = { __lambda: true, params, fn, expr: this.expr, captured: [...this.captured], descriptions };
    this._lastBuild = { expr: this.expr, params: this.params, descJson, capturedVals };
    this.cachedValue = value;
    this.cachedError = null;
    return { result: value };
  }

  /** What the last emitted LambdaValue was built from (identity memo). */
  private _lastBuild: { expr: string; params: string; descJson: string; capturedVals: unknown[] } | null = null;
}
