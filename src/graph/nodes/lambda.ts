import { ClassicPreset } from "rete";
import { anyListIn, lambdaOut, readInput } from "./shared";
import { extractVariables, atColNames, compilePositional, formulaSyntaxHint } from "../excelFormula";
export { isLambdaValue, type LambdaValue } from "../lambdaValue";
import { type LambdaValue } from "../lambdaValue";
import { solError, type SolError } from "../errorValue";

export function formatLambda(v: LambdaValue): string {
  return `λ(${v.params.join(", ")})`;
}

/** The first `required` vars are mandatory; a lambda's params are drawn from `vars` in any order ([[C50]] lambdaBindsByName). */
export interface LambdaSig { vars: string[]; required: number }

export function formatLambdaSig(sig: LambdaSig): string {
  return sig.vars.map((v, i) => (i < sig.required ? v : `[${v}]`)).join(", ");
}

export function undeclaredConsumerVars(captured: string[] | undefined, sig: LambdaSig): string[] {
  return (captured ?? []).filter((c) => sig.vars.includes(c));
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Compiled = (...args: unknown[]) => unknown;

export class LambdaNode extends ClassicPreset.Node {
  label: string;
  params: string;
  expr: string;
  literals: Record<string, number> = {};
  cachedValue: LambdaValue | null = null;
  cachedError: string | null = null;
  width = 220;
  height = 212;

  varDescriptions: Record<string, string> = {};

  captured: string[] = [];
  compiled: Compiled | null = null;

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

  _rebuild(): { added: string[]; removed: string[] } {
    const params = this.paramList();
    const prev = new Set(this.captured);
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
    const params = this.paramList();
    if (!params.every((p) => IDENT.test(p))) {
      this.cachedValue = null;
      this.cachedError = "Bad parameter name";
      return { result: solError("#NAME?", "A lambda parameter name isn't a valid identifier") };
    }
    if (new Set(params).size !== params.length) {
      this.cachedValue = null;
      this.cachedError = "A parameter appears twice";
      return { result: solError("#NAME?", "A lambda parameter name appears twice") };
    }
    if (!this.compiled) {
      this.cachedValue = null;
      const hint = this.expr.trim() ? formulaSyntaxHint(this.expr) : null;
      this.cachedError = this.expr.trim() ? (hint ?? "Syntax error") : null;
      if (!this.expr.trim()) return { result: null };
      return { result: solError("#SYNTAX!", hint ?? "The lambda body has a syntax error") };
    }
    const compiled = this.compiled;
    const capturedVals = this.captured.map((v) => readInput(inputs[v], this.literals[v] ?? 0));
    // An unchanged recompute must return the same LambdaValue object: consumers and the backend upload cache memo on identity.
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

  private _lastBuild: { expr: string; params: string; descJson: string; capturedVals: unknown[] } | null = null;
}
