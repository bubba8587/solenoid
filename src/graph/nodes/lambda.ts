import { ClassicPreset } from "rete";
import { anyIn, lambdaOut } from "./shared";
import { extractVariables, compilePositional } from "../excelFormula";
import { solError, type SolError } from "../errorValue";

// ─── LAMBDA: a first-class function value ───────────────────────────────────────
// Excel's =LAMBDA(param, ..., calculation) as a node. The node compiles its
// formula and emits a callable VALUE down a `lambda` cable; the lambda-family
// consumers (MAP / BYROW / MAKEARRAY / REDUCE) call it positionally, overriding
// their embedded formula text.
//
// Variables split two ways:
//   • declared PARAMETERS (the comma-separated `params` field) stay unbound and
//     define the call signature — bound positionally at the call site, exactly
//     like Excel's LAMBDA params;
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

  // Derived — recomputed by _rebuild() whenever expr/params change.
  captured: string[] = [];
  compiled: Compiled | null = null;

  constructor(init?: { label?: string; expr?: string; params?: string; literals?: Record<string, number> }) {
    super("Lambda");
    this.label = init?.label ?? "LAMBDA";
    this.params = init?.params ?? "x";
    this.expr = init?.expr ?? "";
    if (init?.literals) this.literals = { ...init.literals };
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
      if (!prev.has(v)) { this.addInput(v, anyIn(v)); added.push(v); }
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
      this.cachedError = this.expr.trim() ? "Syntax error" : null;
      if (!this.expr.trim()) return { result: null };
      return { result: solError("#SYNTAX!", "The lambda body has a syntax error") };
    }
    const compiled = this.compiled;
    // Captured values resolve NOW — the closure carries them, so a consumer
    // never reaches back into the graph.
    const capturedVals = this.captured.map((v) => inputs[v]?.[0] ?? this.literals[v] ?? 0);
    const fn: Compiled = (...args) =>
      compiled(...args.slice(0, params.length), ...capturedVals);
    const value: LambdaValue = { __lambda: true, params, fn };
    this.cachedValue = value;
    this.cachedError = null;
    return { result: value };
  }
}
