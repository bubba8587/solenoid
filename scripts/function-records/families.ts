// A function's family (tree/specs/computation/function-records.md § What a record holds).
import { readFileSync } from "node:fs";
import { buildFunctionReference } from "../../src/graph/functionReference";

/** The family of the functions no node covers. */
export const FORMULA_ONLY = "Formula only";

/** Every function the core answers: each name in its call table without a refusal. */
export function coreFunctions(): string[] {
  const traits = JSON.parse(readFileSync("crates/solenoid-core/data/call_traits.json", "utf8")) as Record<string, { refusal?: unknown }>;
  return Object.keys(traits).filter((n) => !traits[n].refusal).sort();
}

/** Each core function's family: the top-level Add menu group of the node its Function Reference row names, else
 *  Formula only. A name two groups claim keeps the first in the Function Reference's order. */
export function familyOf(): Map<string, string> {
  const core = new Set(coreFunctions());
  const out = new Map<string, string>();
  for (const r of buildFunctionReference()) {
    const name = r.excel?.toUpperCase();
    if (name && core.has(name) && r.location[0] && !out.has(name)) out.set(name, r.location[0]);
  }
  for (const n of core) if (!out.has(n)) out.set(n, FORMULA_ONLY);
  return out;
}

export function families(): string[] {
  return [...new Set(familyOf().values())].sort();
}

export function familyFunctions(family: string): string[] {
  return [...familyOf()].filter(([, f]) => f === family).map(([n]) => n).sort();
}
