import type { ExpressionNode, LambdaNode, EquationNode, ScriptNode } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { dropInputCables } from "./cablePrune";
import { INPUT_ROW_PITCH } from "./inlineInput";

// Shared so the inline component and the popup grow the node identically.
export function computeExprHeight(varCount: number): number {
  return 188 + Math.max(varCount, 0) * INPUT_ROW_PITCH;
}

/** THE edit path for both the on-card field and the formula popup; no-op when locked. */
export async function applyExprChange(node: ExpressionNode, newExpr: string): Promise<void> {
  if (node.locked) return;
  node.expr = newExpr;
  const { removed } = node._rebuild();

  const area = getActiveArea();

  if (removed.length > 0) await dropInputCables(node.id, removed);
  for (const v of removed) node.removeInput(v);

  node.height = computeExprHeight(node.varNames.length);
  if (area) {
    // A pinned inline height would keep the new input row from growing the card.
    clearPinnedHeight(area, node.id);
    await area.rerenderNode(node.id);
  }
  await processGraph();
}

export function computeScriptHeight(varCount: number): number {
  return 240 + Math.max(varCount, 0) * INPUT_ROW_PITCH;
}

/** Mirrors applyExprChange: the parameter sockets re-derive from the source on commit. */
export async function applyScriptChange(node: ScriptNode, src: string): Promise<void> {
  node.expr = src;
  const { removed } = node._rebuild();

  const area = getActiveArea();

  if (removed.length > 0) await dropInputCables(node.id, removed);
  for (const v of removed) node.removeInput(v);

  node.height = computeScriptHeight(node.varNames.length);
  if (area) {
    clearPinnedHeight(area, node.id);
    await area.rerenderNode(node.id);
  }
  await processGraph();
}

/** Seeds a sane size after a formula edit; the rendered card is content-driven. */
export function computeEquationHeight(varCount: number): number {
  return 110 + (Math.max(varCount, 0) + 1) * 46;
}

/** Mirrors applyExprChange, plus the paired OUTPUT socket each variable owns. */
export async function applyEquationChange(node: EquationNode, newExpr: string): Promise<void> {
  if (node.locked) return;
  node.expr = newExpr;
  const { removed } = node._rebuild();

  const editor = getActiveEditor();
  const area = getActiveArea();

  // NOT dropInputCables: an Equation variable owns an OUTPUT socket too, so this is
  // the one prune that covers both directions.
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
  if (area) {
    clearPinnedHeight(area, node.id);
    await area.rerenderNode(node.id);
  }
  await processGraph();
}

/** LAMBDA re-derives sockets from BOTH fields: captured = variables − params. */
export async function applyLambdaChange(
  node: LambdaNode,
  change: { expr?: string; params?: string },
): Promise<void> {
  if (change.expr !== undefined) node.expr = change.expr;
  if (change.params !== undefined) node.params = change.params;
  const { removed } = node._rebuild();

  const area = getActiveArea();

  if (removed.length > 0) await dropInputCables(node.id, removed);
  for (const v of removed) node.removeInput(v);

  node.height = computeExprHeight(node.captured.length) + INPUT_ROW_PITCH;
  if (area) {
    clearPinnedHeight(area, node.id);
    await area.rerenderNode(node.id);
  }
  await processGraph();
}

/** Targets the same element rete-area's `resize()` writes to (the view's first
 *  non-span child); width is left alone — only the vertical pin overflows. */
function clearPinnedHeight(area: NonNullable<ReturnType<typeof getActiveArea>>, nodeId: string): void {
  const card = area.nodeViews
    .get(nodeId)
    ?.element.querySelector<HTMLElement>("*:not(span):not([fragment])");
  if (card) card.style.height = "";
}
