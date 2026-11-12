// [[script-sandbox#Script runs your own code, and only typed values come out]], [[C24]] arraySemantics, [[C23]] calcModes
import { GraphNode } from "../graphModel";
import { keyedKindOf, readKeyed, type KeyedKind } from "../literalFields";
import { trueAnyIn, resultOut, readInput } from "./shared";
import { isSolError, solError, type SolError } from "../errorValue";
import { scriptParams, checkScript, scriptIsVolatile } from "./scriptRun";
import { coerceScriptResult, scriptArgToJs } from "./scriptCoerce";
import { executeScript } from "../scriptExecutor";
import { requestScript } from "../scriptGate";
import { getRecalcGen } from "../process";

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

function sameArg(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameArg(a[i], bb[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!(k in rb) || !sameArg(ra[k], rb[k])) return false;
  return true;
}

type Held = { gen: number; expr: string; args: unknown[]; result: unknown; error: string | null };

export class ScriptNode extends GraphNode {
  label: string;
  expr: string;
  cachedResult: unknown = null;
  cachedError: string | null = null;
  stringLiterals: Record<string, string> = {};
  literalKinds: Record<string, KeyedKind> = {};
  width  = 240;
  height = 240;

  varNames: string[] = [];
  private syntaxError: string | null = null;
  private held: Held | null = null;

  constructor(init?: { label?: string; expr?: string; stringLiterals?: Record<string, string>; literalKinds?: Record<string, KeyedKind> }) {
    super("Script");
    this.label = init?.label ?? "Script";
    this.expr = init?.expr ?? DEFAULT_SCRIPT;
    if (init?.stringLiterals) this.stringLiterals = { ...init.stringLiterals };
    if (init?.literalKinds) this.literalKinds = { ...init.literalKinds };
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
    else this.syntaxError = checkScript(this.expr)?.error ?? null;
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
    // [[B18]] safeToShare: a foreign document's script waits for the user to let it run.
    if (!requestScript(this.id, this)) {
      this.cachedError = null;
      this.cachedResult = null;
      return { result: null };
    }
    const typed = (v: string): unknown => readKeyed(keyedKindOf(this, v), this.stringLiterals[v]);
    const args = await Promise.all(
      this.varNames.map((v) => scriptArgToJs(readInput<unknown>(inputs[v], typed(v)))),
    );
    for (const a of args) {
      const e = firstCellError(a);
      if (e) { this.cachedError = null; this.cachedResult = e; return { result: e }; }
    }
    const volatile = scriptIsVolatile(this.expr);
    const gen = getRecalcGen();
    const h = this.held;
    if (volatile && h && h.gen === gen && h.expr === this.expr && sameArg(h.args, args)) {
      this.cachedError = h.error;
      this.cachedResult = h.result;
      return { result: h.result };
    }
    const expr = this.expr;
    const out = await executeScript(expr, args);
    let result: unknown;
    if (out.ok) result = coerceScriptResult(out.value);
    else result = solError(out.code, out.message);
    this.cachedError = out.ok ? null : out.message;
    this.cachedResult = result;
    this.held = volatile ? { gen, expr, args, result, error: this.cachedError } : null;
    return { result };
  }
}
