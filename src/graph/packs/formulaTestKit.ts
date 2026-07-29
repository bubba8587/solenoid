// Test-only helpers for formula packs: instantiate a pack's pre-set Expression
// entry exactly the way the Add menu would, feed it inputs, and return the
// computed result. Each pack's vitest file asserts its formulas against
// hand-checked / published reference values, so a typo'd formula string can't
// ship silently — the whole point of a locked preset is that it's RIGHT.

import { ExpressionNode, EquationNode } from "../rete-nodes";
import { parseEquation } from "../equationSolve";
import { initPackFormulas } from "../formulaExtensions";
import { compileEvaluator } from "../excelFormula";
import type { FormulaPackEntry, Pack } from "./packShared";

/** Compile-and-evaluate an expression with every known pack's FORMULA FUNCTIONS
 *  registered (initPackFormulas is idempotent) — the pin path for a pack's
 *  custom-logic PackFormula entries, mirroring how a typed Expression resolves
 *  them on canvas. */
export function evalPackFormula(expr: string, env: Record<string, unknown> = {}): unknown {
  initPackFormulas();
  const f = compileEvaluator(expr);
  if (!f) throw new Error(`did not compile: ${expr}`);
  return f(env);
}

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

/** Run one EQUATION entry with the given knowns; returns the node's full output
 *  record (each variable + `holds`), so a test reads the solved unknown or the
 *  truth check directly. */
export function evalEquation(
  e: FormulaPackEntry,
  inputs: Record<string, number | number[]>,
): Record<string, unknown> {
  const node = new EquationNode({ expr: e.expr, locked: true });
  const env: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(inputs)) env[k] = [v];
  return node.data(env);
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
    if (e.equation) {
      const parsed = parseEquation(e.expr);
      if (parsed === null || typeof parsed === "string") {
        problems.push(`${e.type}: equation does not parse: ${e.expr}${typeof parsed === "string" ? ` (${parsed})` : ""}`);
      }
    } else {
      const node = new ExpressionNode({ expr: e.expr, locked: true, resultAs: e.resultAs });
      if (!node.evaluator) problems.push(`${e.type}: formula does not compile: ${e.expr}`);
    }
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
