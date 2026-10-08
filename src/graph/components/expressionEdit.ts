// [[C15]] matricesInFormulas
import type { ExpressionNode, LambdaNode, EquationNode, ScriptNode } from "../rete-nodes";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { dropInputCables } from "./cablePrune";
import { INPUT_ROW_PITCH } from "./inlineInput";

function computeExprHeight(varCount: number): number {
  return 188 + Math.max(varCount, 0) * INPUT_ROW_PITCH;
}

/** The one edit path for the on-card field and the formula popup; a no-op when locked. */
export async function applyExprChange(node: ExpressionNode, newExpr: string): Promise<void> {
  if (node.locked) return;
  node.expr = newExpr;
  const { removed } = node._rebuild();

  const view = getOwningView(node.id);

  if (removed.length > 0) await dropInputCables(node.id, removed);
  for (const v of removed) node.removeInput(v);

  node.height = computeExprHeight(node.varNames.length);
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

function computeScriptHeight(varCount: number): number {
  return 240 + Math.max(varCount, 0) * INPUT_ROW_PITCH;
}

export async function applyScriptChange(node: ScriptNode, src: string): Promise<void> {
  node.expr = src;
  const { removed } = node._rebuild();

  const view = getOwningView(node.id);

  if (removed.length > 0) await dropInputCables(node.id, removed);
  for (const v of removed) node.removeInput(v);

  node.height = computeScriptHeight(node.varNames.length);
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

function computeEquationHeight(varCount: number): number {
  return 110 + (Math.max(varCount, 0) + 1) * 46;
}

export async function applyEquationChange(node: EquationNode, newExpr: string): Promise<void> {
  if (node.locked) return;
  node.expr = newExpr;
  const { removed } = node._rebuild();

  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);

  // Not dropInputCables: an Equation variable owns an output socket too, so this is the one prune that covers both directions.
  if (editor && removed.length > 0) {
    const conns = editor.getConnections().filter(
      (c) =>
        (c.target === node.id && removed.includes(c.targetInput as string)) ||
        (c.source === node.id && removed.includes(c.sourceOutput as string)),
    );
    for (const c of conns) await editor.removeConnection(c.id);
  }
  for (const v of removed) { node.removeInput(v); node.removeOutput(v); }

  node.height = computeEquationHeight(node.varNames.length);
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

/** Sockets re-derive from both fields: captured = variables − params. */
export async function applyLambdaChange(
  node: LambdaNode,
  change: { expr?: string; params?: string },
): Promise<void> {
  if (change.expr !== undefined) node.expr = change.expr;
  if (change.params !== undefined) node.params = change.params;
  const { removed } = node._rebuild();

  const view = getOwningView(node.id);

  if (removed.length > 0) await dropInputCables(node.id, removed);
  for (const v of removed) node.removeInput(v);

  node.height = computeExprHeight(node.captured.length) + INPUT_ROW_PITCH;
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

