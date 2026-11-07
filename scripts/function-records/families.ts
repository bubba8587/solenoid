// A function's family (tree/specs/computation/function-records.md § What a record holds).
import { buildFunctionReference } from "../../src/graph/functionReference";

/** A family's functions: those whose Function Reference row names a node in that top-level Add menu group. */
export function familyFunctions(family: string): string[] {
  const out = new Set<string>();
  for (const r of buildFunctionReference()) if (r.excel && r.location[0] === family) out.add(r.excel.toUpperCase());
  return [...out].sort();
}
