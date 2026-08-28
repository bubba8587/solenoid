import { ClassicPreset } from "rete";
import { trueAnyIn, resultOut, readInput } from "./shared";
import { isSolError, solError, type SolError } from "../errorValue";
import { scriptParams, compileScript } from "./scriptRun";
import { coerceScriptResult, scriptArgToJs } from "./scriptCoerce";
import { executeScript } from "../scriptExecutor";
import { reconcileResultRank, type ProducedFamily } from "./expression";
// The Script node has NO declared result type (no toggle): the value types itself.
// JS values carry their family (a string is text, a `Date` a date), `{name: value}`
// rows build a FRAME (nested rows/lists, a CUBE), and the result socket reconciles to
// the computed value's family and rank; `Solenoid.date(serial)` says the one thing a
// JS value cannot (scriptRun.ts). Inputs are trueany: frames and cubes arrive as the
// same rows-of-objects (`scriptArgToJs`); lambdas/charts/documents error before the run.

export const DEFAULT_SCRIPT = "(x) => x";

/** A per-cell error anywhere in an input outranks running the script at all
 *  (errorInErrorOut at cell grain: the guard only sees whole-value errors). Walks
 *  lists, rows, and converted `{name: value}` rows. */
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

/**
 * A JavaScript function as a node: its parameters are the inputs, its return value
 * the result, folded onto the value model by `scriptCoerce.ts` at the declared
 * result type. The source is Expression's `expr` field (one persistence key, same
 * edit path shape: `applyScriptChange`), evaluated in the sandbox worker.
 */
export class ScriptNode extends ClassicPreset.Node {
  label: string;
  expr: string;
  cachedResult: unknown = null;
  /** The message shown under the field: a syntax problem or the script's own throw. */
  cachedError: string | null = null;
  // A parameter is a value slot, so an unwired one takes a typed number OR text
  // (autoLiterals); the reader passes whichever map holds it.
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = {};
  autoLiterals = true;
  width  = 240;
  height = 240;

  varNames: string[] = [];
  lastResultRank: 1 | 2 = 1;
  /** Runtime family the result socket last settled to; transient like the rank. */
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

  /** Re-derive the parameter sockets from the source. Returns the names added and
   *  the names the caller must prune cables from BEFORE `removeInput`. */
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
    // Unwired and untyped is JS `undefined`; a wired blank arrives as null. Exactly one
    // map holds a typed wildcard literal (InlineAutoField clears the other).
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
    // A vote-less result (empty list, all blanks/errors) keeps the settled family.
    reconcileResultRank(this, result, family ?? this.lastResultFamily);
    return { result };
  }
}
