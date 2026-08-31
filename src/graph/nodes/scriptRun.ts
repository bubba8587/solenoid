// The Script node's evaluator. Self-contained on purpose: this module runs inside the
// sandbox worker (`scriptWorker.ts`) as well as on the main thread (tests, and any
// host without Workers), so it may import NOTHING from the app. Values leave here as
// plain clonable data; `scriptCoerce.ts` folds them onto the value model afterwards.

/** Wall-clock budget for one call. A runaway loop is terminated at this point rather
 *  than freezing the app, and with it every reload that autosave would replay. */
export const SCRIPT_TIMEOUT_MS = 1000;

export type ScriptOutcome =
  | { ok: true; value: unknown }
  | { ok: false; code: "#SYNTAX!" | "#VALUE!"; message: string };

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function",
  "if", "import", "in", "instanceof", "let", "new", "null", "return", "static", "super",
  "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);

// The head of a function expression: `function name(a, b)`, `(a, b) =>`, or `a =>`.
const HEAD_RE = /^\s*(?:async\s+)?(?:function\s*\*?\s*[\w$]*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>)/;

/** The parameter names of the function the source declares, or a plain-English reason
 *  it declares none. Parameters must be bare names: they become the node's inputs, and
 *  a destructured or defaulted parameter has no single name to show. */
export function scriptParams(src: string): { params: string[] } | { error: string } {
  if (!src.trim()) return { params: [] };
  const m = HEAD_RE.exec(src);
  if (!m) return { error: "Write a function: (x) => x * 2" };
  const list = m[3] !== undefined ? m[3] : (m[1] ?? m[2] ?? "");
  const params = list.split(",").map((s) => s.trim()).filter((s, i, a) => s !== "" || i < a.length - 1);
  const seen = new Set<string>();
  for (const p of params) {
    if (!IDENT_RE.test(p) || RESERVED.has(p)) return { error: `Parameters must be plain names, not "${p}"` };
    if (seen.has(p)) return { error: `Parameter "${p}" appears twice` };
    seen.add(p);
  }
  return { params };
}

// Source scan, not semantics: a renamed alias escapes it and a string literal can
// false-positive, and either way the cost is only a Recalculate button.
const VOLATILE_RE =
  /\bMath\s*\.\s*random\b|\bDate\s*\.\s*now\b|\bnew\s+Date\s*\(\s*\)|\bcrypto\s*\.\s*(?:getRandomValues|randomUUID)\b|\bperformance\s*\.\s*now\b/;

/** Whether the source draws on randomness or the clock, so each run can differ. */
export function scriptIsVolatile(src: string): boolean {
  return VOLATILE_RE.test(src);
}

/** A date cell the script asked for by serial (`Solenoid.date`); the coercer folds
 *  it to the serial and votes the date family. */
export type SolDateTag = { __solDate: unknown };
export function isSolDateTag(v: unknown): v is SolDateTag {
  return typeof v === "object" && v !== null && "__solDate" in v;
}

// The one in-script global. JS values type themselves (a number is a number, a string
// text, a `Date` a date); the single thing JS cannot say is "this NUMBER is a date
// serial", so `Solenoid.date(serial)` says it. Maps over lists and rows.
const SolenoidGlobal = Object.freeze({
  date(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((c) => SolenoidGlobal.date(c));
    if (v == null || v instanceof Date) return v;
    return { __solDate: v } satisfies SolDateTag; // validated by the coercer
  },
});

type Fn = (...args: unknown[]) => unknown;
const compiled = new Map<string, Fn>();

/** Compile the source to a callable, or a syntax message. Cached by source text.
 *  The returned function closes over the `Solenoid` in-script global. */
export function compileScript(src: string): { fn: Fn } | { error: string } {
  const hit = compiled.get(src);
  if (hit) return { fn: hit };
  const head = scriptParams(src);
  if ("error" in head) return head;
  let fn: unknown;
  try {
    fn = new Function("Solenoid", `"use strict"; return (\n${src}\n);`)(SolenoidGlobal);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (typeof fn !== "function") return { error: "Write a function: (x) => x * 2" };
  if (compiled.size > 64) compiled.clear();
  compiled.set(src, fn as Fn);
  return { fn: fn as Fn };
}

/** Replace anything structured clone cannot carry (functions, symbols) with a marker
 *  the coercer reports as #TYPE!, so a bad return never kills the reply channel.
 *  The depth cap must clear the deepest legal shape — cube rows nesting frame rows
 *  nesting lists — with room for a level of cube-in-cube. */
export function toClonable(v: unknown, depth = 0): unknown {
  if (typeof v === "function" || typeof v === "symbol") return { __unclonable: typeof v };
  if (v === null || typeof v !== "object" || v instanceof Date) return v;
  if (depth > 7) return { __unclonable: "nested" };
  if (Array.isArray(v)) return v.map((c) => toClonable(c, depth + 1));
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<unknown>);
  if (v instanceof Map || v instanceof Set) return { __unclonable: v instanceof Map ? "Map" : "Set" };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = toClonable((v as Record<string, unknown>)[k], depth + 1);
  return out;
}

/** Compile and call. A throw inside the function is the function's own failure
 *  (#VALUE! with its message); a source that will not compile is #SYNTAX!. */
export async function invokeScript(src: string, args: unknown[]): Promise<ScriptOutcome> {
  const c = compileScript(src);
  if ("error" in c) return { ok: false, code: "#SYNTAX!", message: c.error };
  try {
    const value = await c.fn(...args);
    return { ok: true, value: toClonable(value) };
  } catch (e) {
    return { ok: false, code: "#VALUE!", message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}
