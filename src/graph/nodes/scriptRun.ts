// [[C66]]
// This module is the sandbox worker's whole bundle, so it must import nothing from the app.

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

const HEAD_RE = /^\s*(?:async\s+)?(?:function\s*\*?\s*[\w$]*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>)/;

export function scriptParams(src: string): { params: string[] } | { error: string } {
  if (!src.trim()) return { params: [] };
  const m = HEAD_RE.exec(src.replace(/^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*/, ""));
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

const VOLATILE_RE =
  /\bMath\s*\.\s*random\b|\bDate\s*\.\s*now\b|\bnew\s+Date\s*\(\s*\)|\bcrypto\s*\.\s*(?:getRandomValues|randomUUID)\b|\bperformance\s*\.\s*now\b/;

export function scriptIsVolatile(src: string): boolean {
  return VOLATILE_RE.test(src);
}

export type SolDateTag = { __solDate: unknown };
export function isSolDateTag(v: unknown): v is SolDateTag {
  return typeof v === "object" && v !== null && "__solDate" in v;
}

const SolenoidGlobal = Object.freeze({
  date(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((c) => SolenoidGlobal.date(c));
    if (v == null || v instanceof Date) return v;
    return { __solDate: v } satisfies SolDateTag;
  },
});

type Fn = (...args: unknown[]) => unknown;
const compiled = new Map<string, Fn>();

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
