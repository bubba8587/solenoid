// [[B15]] leanCore, [[C79]] packActivationIsPresentation, [[C76]] formulaPackDefault
// Test-only.

import { ExpressionNode, EquationNode } from "../nodeClasses";
import { initPackFormulas } from "../formulaExtensions";
import { compileEvaluator, parseFormula } from "../excelFormula";
import type { FormulaPackEntry, Pack } from "./packShared";

/** Evaluates with every pack's FORMULA FUNCTIONS registered, mirroring how a typed
 *  Expression resolves them on canvas. */
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
  // Seed literals as the Add menu does, or an unprovided config variable reads 0 instead of its preset default.
  const node = new ExpressionNode({ expr: e.expr, locked: true, resultAs: e.resultAs, literals: e.literals });
  const env: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(inputs)) env[k] = [v];
  return (node.data(env) as { result: unknown }).result;
}

/** Returns the node's full output record (each variable + `holds`). */
export function evalEquation(
  e: FormulaPackEntry,
  inputs: Record<string, number | number[]>,
): Record<string, unknown> {
  const node = new EquationNode({ expr: e.expr, locked: true });
  const env: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(inputs)) env[k] = [v];
  return node.data(env);
}

/** Throws if absent — a test misspelling. */
export function entryByType(entries: FormulaPackEntry[], type: string): FormulaPackEntry {
  const e = entries.find((x) => x.type === type);
  if (!e) throw new Error(`no formula entry "${type}"`);
  return e;
}

/** Returns {type, problem} findings; empty = the pack is well-formed. */
export function auditFormulaPack(entries: FormulaPackEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.type)) problems.push(`${e.type}: duplicate type id`);
    seen.add(e.type);
    if (e.equation) {
      // Every variable wired, so the core only checks the equation and any error it leaves is the parse's.
      const node = new EquationNode({ expr: e.expr, locked: true });
      node.data(Object.fromEntries(node.varNames.map((v) => [v, [1]])));
      if (node.cachedError) problems.push(`${e.type}: equation does not parse: ${e.expr} (${node.cachedError})`);
    } else {
      if (!parseFormula(e.expr)) problems.push(`${e.type}: formula does not compile: ${e.expr}`);
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
