// Test-only helpers for formula packs: instantiate a pack's pre-set Expression
// entry exactly the way the Add menu would, feed it inputs, and return the
// computed result. Each pack's vitest file asserts its formulas against
// hand-checked / published reference values, so a typo'd formula string can't
// ship silently — the whole point of a locked preset is that it's RIGHT.

import { ExpressionNode } from "../rete-nodes";
import type { FormulaPackEntry, Pack } from "./packShared";

/** Evaluate one formula entry with the given variable values. */
export function evalFormula(
  e: FormulaPackEntry,
  inputs: Record<string, number | string | (number | string)[]>,
): unknown {
  const node = new ExpressionNode({ expr: e.expr, locked: true, resultAs: e.resultAs });
  // Unknown/missing variables default to 0 via node.literals — same as on canvas.
  const env: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(inputs)) env[k] = [v];
  return (node.data(env) as { result: unknown }).result;
}

/** Find a formula entry by catalog type; throws if absent (test misspelling). */
export function entryByType(entries: FormulaPackEntry[], type: string): FormulaPackEntry {
  const e = entries.find((x) => x.type === type);
  if (!e) throw new Error(`no formula entry "${type}"`);
  return e;
}

/** Every variable in every formula compiles and the entry set has unique types.
 *  Returns the list of {type, problem} findings (empty = pack is well-formed). */
export function auditFormulaPack(entries: FormulaPackEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.type)) problems.push(`${e.type}: duplicate type id`);
    seen.add(e.type);
    const node = new ExpressionNode({ expr: e.expr, locked: true, resultAs: e.resultAs });
    if (!node.evaluator) problems.push(`${e.type}: formula does not compile: ${e.expr}`);
    if (!e.description) problems.push(`${e.type}: missing description`);
  }
  return problems;
}

/** All placements of a pack resolve to constructible nodes with unique types. */
export function auditPackNodes(pack: Pack): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { entry } of pack.nodes ?? []) {
    if (seen.has(entry.type)) problems.push(`${entry.type}: duplicate type id in pack "${pack.id}"`);
    seen.add(entry.type);
    try { entry.create(); } catch (err) {
      problems.push(`${entry.type}: create() threw: ${String(err)}`);
    }
  }
  return problems;
}
