// The edge grid (tree/specs/computation/function-records.md § The edge grid): every probe at every argument position
// of a hand-written baseline call, one argument changed at a time.
import { readFileSync } from "node:fs";
import { FUNCTION_ARITY } from "../../src/graph/excelFunctions";
import { FORMULA_SIGNATURES } from "../../src/graph/formulaSignatureTable";

const TRAITS: Record<string, { maxArgs?: number }> = JSON.parse(readFileSync("crates/solenoid-core/data/call_traits.json", "utf8"));
import { isFormula, namesRead, type Harvested } from "./harvest.ts";

interface Probe { kind: string; src: string; env?: string }

export const PROBES: readonly Probe[] = [
  ...["0", "-1", "0.5", "1E+307", "1E-307"].map((src) => ({ kind: "number", src })),
  ...['""', '"abc"', '"5"', '" 5 "', '"TRUE"', '"😀"'].map((src) => ({ kind: "text", src })),
  ...["TRUE", "FALSE"].map((src) => ({ kind: "logical", src })),
  ...["DATE(2024, 3, 5)", "DATE(1900, 1, 1)", "DATE(2024, 3, 5) + TIME(12, 0, 0)"].map((src) => ({ kind: "date", src })),
  { kind: "blank value", src: "p_blank", env: "p_blank=blank:" },
  { kind: "empty slot", src: "" },
  ...["NA()", "1 / 0"].map((src) => ({ kind: "error", src })),
  { kind: "list", src: "p_nums", env: "p_nums=list:num:[1, 2, 3]" },
  { kind: "list", src: "p_texts", env: 'p_texts=list:text:["a", "b"]' },
  { kind: "list", src: "p_bools", env: "p_bools=list:bool:[TRUE, FALSE]" },
  { kind: "matrix", src: "p_table", env: "p_table=table:num:[[1, 2], [3, 4]]" },
  { kind: "complex", src: "COMPLEX(1, 2)" },
  { kind: "a value with a unit", src: "p_unit", env: "p_unit=unit:5000 m as km" },
];

/** A call's arguments as written, split at its top-level commas; null when the formula isn't one call to `fn`. */
export function callArgs(formula: string, fn: string): string[] | null {
  const m = new RegExp(`^\\s*${fn.replaceAll(".", "\\.")}\\s*\\(`, "i").exec(formula);
  if (!m) return null;
  const args: string[] = [];
  let depth = 0, start = m[0].length, i = start;
  for (; i < formula.length; i++) {
    const c = formula[i];
    if (c === '"') { i = formula.indexOf('"', i + 1); if (i < 0) return null; continue; }
    if (c === "(") depth++;
    else if (c === ")") { if (depth === 0) break; depth--; }
    else if (c === "," && depth === 0) { args.push(formula.slice(start, i).trim()); start = i + 1; }
  }
  if (i >= formula.length || formula.slice(i + 1).trim() !== "") return null;
  args.push(formula.slice(start, i).trim());
  return args.length === 1 && args[0] === "" ? [] : args;
}

/** A function's argument bounds: its most from the core's call table (`maxArgs`, absent for a variadic one), its fewest
 *  from the signature's arguments not in brackets, checked against `FUNCTION_ARITY` where that has the function. */
export function bounds(fn: string): { min: number; max: number; params: string[]; repeat: number } | string {
  const sig = FORMULA_SIGNATURES[fn];
  if (sig === undefined) return `${fn} has no signature`;
  const raw = sig.split(",").map((s) => s.trim()).filter(Boolean);
  const params = raw.map((s) => s.replace(/^\[|\]$/g, ""));
  const repeat = params.indexOf("…");
  const min = raw.filter((s, i) => !s.startsWith("[") && s !== "…" && (repeat < 0 || i < repeat)).length;
  const max = TRAITS[fn]?.maxArgs ?? (repeat >= 0 ? 255 : NaN);
  if (Number.isNaN(max)) return `${fn} has neither a maxArgs nor a repeated argument`;
  const declared = FUNCTION_ARITY[fn];
  if (declared && (declared[0] !== min || (repeat < 0 && declared[1] !== max))) return `${fn}: FUNCTION_ARITY says ${declared[0]} to ${declared[1]}, the signature and call table ${min} to ${max}`;
  return { min, max, params, repeat };
}

/** The positions the grid probes, each with the argument's name from the function's signature. */
export function positions(fn: string): Array<{ at: number; name: string }> | string {
  const b = bounds(fn);
  if (typeof b === "string") return b;
  const fixed = b.repeat >= 0 ? b.repeat - 1 : b.max;
  const out: Array<{ at: number; name: string }> = [];
  for (let i = 0; i < fixed; i++) out.push({ at: i, name: b.params[i] });
  if (b.repeat >= 0) {
    const base = b.params[fixed];
    out.push({ at: fixed, name: base }, { at: fixed + 1, name: `${base}, repeated` });
  }
  return out;
}

export function grid(fn: string, baseline: string, baselineEnv: readonly string[], errors: string[]): Harvested[] {
  const args = callArgs(baseline, fn);
  if (!args) { errors.push(`${fn}: the baseline ${baseline} isn't one call to ${fn}`); return []; }
  const pos = positions(fn);
  if (typeof pos === "string") { errors.push(pos); return []; }
  const { min, max } = bounds(fn) as { min: number; max: number };
  if (args.length < min || args.length > max || args.length < pos.length) {
    errors.push(`${fn}: the baseline has ${args.length} arguments; the grid probes ${pos.length} (arity ${min} to ${max})`);
    return [];
  }
  if (!isFormula(baseline)) { errors.push(`${fn}: the baseline isn't a formula in the shared syntax`); return []; }
  const out: Harvested[] = [];
  for (const { at, name } of pos) {
    for (const p of PROBES) {
      const next = args.map((a, i) => (i === at ? p.src : a));
      if (next.length === 1 && next[0] === "") continue; // FN() with no argument, which Excel won't enter
      const formula = `${fn}(${next.join(", ")})`;
      const bound = new Set(namesRead(formula));
      const env = [...baselineEnv, ...(p.env ? [p.env] : [])].filter((e) => bound.has(e.slice(0, e.indexOf("="))));
      out.push({ fn, formula, env, group: `${at + 1}. ${name}`, source: `grid:${fn}:${at + 1}:${p.kind}` });
    }
  }
  return out;
}
