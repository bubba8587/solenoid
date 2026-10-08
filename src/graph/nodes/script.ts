// [[C66]] scriptNode, [[D35]] errorInErrorOut
import { ClassicPreset } from "rete";
import { trueAnyIn, resultOut, readInput } from "./shared";
import { isSolError, solError, type SolError } from "../errorValue";
import { scriptParams, compileScript } from "./scriptRun";
import { coerceScriptResult, scriptArgToJs } from "./scriptCoerce";
import { executeScript } from "../scriptExecutor";
import { reconcileResultRank, type ProducedFamily } from "./expression";

export const DEFAULT_SCRIPT = "(x) => x";

function firstCellError(v: unknown): SolError | null {
  if (isSolError(v)) return v;
  if (Array.isArray(v)) {
    for (const c of v) {
      const e = firstCellError(c);
      if (e) return e;
    }
  } else if (typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype) {
    for (const c of Object.values(v)) {
      const e = firstCellError(c);
      if (e) return e;
    }
  }
  return null;
}

export class ScriptNode extends ClassicPreset.Node {
  label: string;
  expr: string;
  cachedResult: unknown = null;
  cachedError: string | null = null;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = {};
  autoLiterals = true;
  width  = 240;
  height = 240;

  varNames: string[] = [];
  lastResultRank: 1 | 2 = 1;
  lastResultFamily: ProducedFamily = "auto";
  private syntaxError: string | null = null;

  constructor(init?: { label?: string; expr?: string; literals?: Record<string, number>; stringLiterals?: Record<string, string> }) {
    super("Script");
    this.label = init?.label ?? "Script";
    this.expr = init?.expr ?? DEFAULT_SCRIPT;
    if (init?.literals) this.literals = { ...init.literals };
    if (init?.stringLiterals) this.stringLiterals = { ...init.stringLiterals };
    this.addOutput("result", resultOut("Result", "combo", "auto"));
    this._rebuild();
  }

  _rebuild(): { added: string[]; removed: string[] } {
    const head = scriptParams(this.expr);
    const next = "params" in head ? head.params : [];
    const prev = new Set(this.varNames);
    const nextSet = new Set(next);
    const added: string[] = [];
    const removed: string[] = [];
    for (const v of next) {
      if (!prev.has(v)) { this.addInput(v, trueAnyIn(v)); added.push(v); }
    }
    for (const v of prev) if (!nextSet.has(v)) removed.push(v);
    this.varNames = next;
    if ("error" in head) this.syntaxError = head.error;
    else {
      const c = compileScript(this.expr);
      this.syntaxError = "error" in c ? c.error : null;
    }
    return { added, removed };
  }

  async data(inputs: Record<string, unknown[]>): Promise<{ result: unknown }> {
    if (!this.expr.trim()) {
      this.cachedError = null;
      this.cachedResult = null;
      return { result: null };
    }
    if (this.syntaxError) {
      const err = solError("#SYNTAX!", this.syntaxError);
      this.cachedError = this.syntaxError;
      this.cachedResult = err;
      return { result: err };
    }
    // Exactly one map holds a typed literal, because InlineAutoField clears the other.
    const typed = (v: string): unknown => (v in this.literals ? this.literals[v] : this.stringLiterals[v]);
    const args = await Promise.all(
      this.varNames.map((v) => scriptArgToJs(readInput<unknown>(inputs[v], typed(v)))),
    );
    for (const a of args) {
      const e = firstCellError(a);
      if (e) { this.cachedError = null; this.cachedResult = e; return { result: e }; }
    }
    const out = await executeScript(this.expr, args);
    let result: unknown;
    let family: ProducedFamily | null = null;
    if (out.ok) ({ value: result, family } = coerceScriptResult(out.value));
    else result = solError(out.code, out.message);
    this.cachedError = out.ok ? null : out.message;
    this.cachedResult = result;
    reconcileResultRank(this, result, family ?? this.lastResultFamily);
    return { result };
  }
}
