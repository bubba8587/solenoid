import { ClassicPreset } from "rete";
import { anyListIn, lambdaOut, readInput } from "./shared";
import { extractVariables, atColNames } from "../excelFormula";
export { isLambdaValue, type LambdaValue } from "../lambdaValue";
import { type LambdaValue } from "../lambdaValue";
import { type SolError } from "../errorValue";
import { nodeOnCore } from "../nodeOnCore";

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

/** Parameters the body writes both bare and `@`: both read this row, so the bare one likely means the column ([[C22]] rowFormulaRefs). */
export function perRowParamClashes(params: string[], expr: string): string[] {
  const bare = new Set(extractVariables(expr));
  const at = new Set(atColNames(expr));
  return params.filter((p) => bare.has(p) && at.has(p));
}

export class LambdaNode extends ClassicPreset.Node {
  unitAware = true;
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
      .filter((v) => !params.includes(v));
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
    return { added, removed };
  }

  /** An unchanged recompute returns the same LambdaValue object: consumers and the backend upload cache memo on identity. */
  data(inputs: Record<string, unknown[] | undefined>): { result: LambdaValue | SolError | null } {
    const capturedVals = this.captured.map((v) => readInput(inputs[v], this.literals[v] ?? 0));
    const descJson = JSON.stringify(this.varDescriptions);
    const last = this._lastBuild;
    if (
      this.cachedValue && last && last.expr === this.expr && last.params === this.params &&
      last.descJson === descJson && last.capturedVals.length === capturedVals.length &&
      last.capturedVals.every((v, i) => Object.is(v, capturedVals[i]))
    ) {
      return { result: this.cachedValue };
    }
    const out = this.body(inputs);
    this._lastBuild = this.cachedValue ? { expr: this.expr, params: this.params, descJson, capturedVals } : null;
    return out;
  }

  body(inputs: Record<string, unknown[] | undefined>): { result: LambdaValue | SolError | null } {
    return nodeOnCore(this, inputs) as { result: LambdaValue | SolError | null };
  }

  private _lastBuild: { expr: string; params: string; descJson: string; capturedVals: unknown[] } | null = null;
}
