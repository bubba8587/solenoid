import { ClassicPreset } from "rete";
import { anyDataIn, resultOut, resultSocket, readInput, type ResultType } from "./shared";
import { frameSocket, cubeSocket } from "../sockets";
import { getActiveEditor, getActiveView } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { extractVariables, compileEvaluator, parseFormula, type ExprEvaluator, type Ast, formulaSyntaxHint } from "../excelFormula";
import { fxErrorToSol } from "../excelFunctions";
import { isSolError, solError } from "../errorValue";
import { isCx } from "../cxValue";
import { isUnitCell, tagDim, type UnitCell } from "../unitValue";
import { dimEval, type DimEnv, type CodeEnv } from "../unitDimExpr";
import { type Dim, DIMENSIONLESS, isDimensionless, dimEqual } from "../dimension";

function guard(v: unknown, scalar: boolean): unknown {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (isCx(v)) return v;
  return scalar ? null : NaN;
}

function tagResult(v: unknown): unknown {
  if (isSolError(v)) return v;
  if (v instanceof Error) return fxErrorToSol(v);
  if (typeof v === "number" && Number.isNaN(v)) {
    return solError("#DOMAIN!", "The result is undefined: not a number");
  }
  return guard(v, true);
}

function stripUnits(v: unknown): unknown {
  if (isUnitCell(v)) return v.value;
  if (Array.isArray(v)) {
    return v.map((c) =>
      Array.isArray(c) ? c.map((e) => (isUnitCell(e) ? (e as UnitCell).value : e))
      : isUnitCell(c) ? (c as UnitCell).value : c);
  }
  return v;
}

function envCurrencyCode(v: unknown, dim: Dim): string | undefined {
  if (!dimEqual(dim, { currency: 1 })) return undefined;
  const cells = Array.isArray(v) ? v.flat() : [v];
  let code: string | undefined;
  for (const c of cells) {
    if (!isUnitCell(c) || c.display == null) continue;
    if (code === undefined) code = c.display;
    else if (code !== c.display) return undefined;
  }
  return code;
}

function envDim(v: unknown): Dim {
  if (isUnitCell(v)) return v.dim;
  if (Array.isArray(v)) {
    let dim: Dim | null = null;
    for (const c of v.flat()) {
      if (!isUnitCell(c)) continue;
      if (dim === null) dim = c.dim;
      else if (!dimEqual(dim, c.dim)) return DIMENSIONLESS;
    }
    return dim ?? DIMENSIONLESS;
  }
  return DIMENSIONLESS;
}

export type ProducedFamily = ResultType | "frame" | "cube";

type RankedProducer = ClassicPreset.Node & { resultAs?: ResultType; lastResultRank: 1 | 2; lastResultFamily?: ProducedFamily };

export function reconcileResultRank(node: RankedProducer, result: unknown, family?: ProducedFamily): void {
  if (isSolError(result)) return;
  const want: 1 | 2 = Array.isArray(result) && result.length > 0 && Array.isArray(result[0]) ? 2 : 1;
  const wantFamily: ProducedFamily = family ?? node.resultAs ?? "auto";
  const familyChanged = family !== undefined && node.lastResultFamily !== family;
  if (want === node.lastResultRank && !familyChanged) return;
  node.lastResultRank = want;
  if (family !== undefined) node.lastResultFamily = family;
  queueMicrotask(() => {
    void (async () => {
      const editor = getActiveEditor();
      const view = getActiveView();
      const out = node.outputs.result;
      if (!editor || !view || !out || !editor.getNode(node.id)) return;
      out.socket = wantFamily === "frame"
        ? frameSocket
        : wantFamily === "cube"
          ? cubeSocket
          : resultSocket(want === 2 ? "matrix" : "combo", wantFamily);
      await retypeOutputCables(editor, view, node.id, "result");
      await view.rerenderNode(node.id);
    })();
  });
}

export class ExpressionNode extends ClassicPreset.Node {
  unitAware = true;
  label: string;
  expr: string;
  locked: boolean;
  resultAs: ResultType;
  cachedResult: unknown = null;
  cachedError: string | null = null;
  literals: Record<string, number> = {};
  width  = 220;
  height = 210;

  varNames: string[]  = [];
  evaluator: ExprEvaluator | null = null;
  ast: Ast | null = null;
  varDescriptions: Record<string, string> = {};
  lastResultRank: 1 | 2 = 1;

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
        removed.push(v);
      }
    }

    this.varNames = next;
    this.evaluator = compileEvaluator(this.expr);
    this.ast = parseFormula(this.expr);
    return { added, removed };
  }

  data(inputs: Record<string, unknown[]>): { result: unknown } {
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
      const rawEnv: Record<string, unknown> = {};
      for (const v of this.varNames) rawEnv[v] = readInput(inputs[v], this.literals[v] ?? 0);
      const env: Record<string, unknown> = {};
      for (const v of this.varNames) env[v] = stripUnits(rawEnv[v]);

      const raw = this.evaluator(env);
      let result: unknown = Array.isArray(raw)
        ? raw.map((e) => (Array.isArray(e) ? e.map(tagResult) : tagResult(e)))
        : tagResult(raw);

      if (this.ast && this.varNames.some((v) => envDim(rawEnv[v]) !== DIMENSIONLESS && !isDimensionless(envDim(rawEnv[v])))) {
        const dimEnv: DimEnv = {};
        const codeEnv: CodeEnv = {};
        for (const v of this.varNames) {
          dimEnv[v] = envDim(rawEnv[v]);
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
      reconcileResultRank(this, result);
      return { result };
    } catch {
      this.cachedError = "Evaluation error";
      const err = solError("#VALUE!", "The formula failed to evaluate");
      this.cachedResult = err;
      return { result: err };
    }
  }
}
