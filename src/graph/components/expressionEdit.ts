import type { ExpressionNode, LambdaNode, EquationNode } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { INPUT_ROW_PITCH } from "./inlineInput";

// Default card height for an Expression node: header + the (now taller) formula
// box + value display, plus one row per input variable. Shared so the inline
// component and the popup grow the node identically.
export function computeExprHeight(varCount: number): number {
  // +26 for the polyform result-type toggle row.
  return 188 + Math.max(varCount, 0) * INPUT_ROW_PITCH;
}

/**
 * Apply a new formula to an Expression node: reparse, add/remove input sockets
 * (dropping cables for removed ones), resize, and recompute the graph. The single
 * edit path used by both the on-card field (LAMBDA-style) and the formula popup.
 * No-op on a locked preset.
 */
export async function applyExprChange(node: ExpressionNode, newExpr: string): Promise<void> {
  if (node.locked) return;
  node.expr = newExpr;
  const { removed } = node._rebuild();

  const editor = getActiveEditor(); // active graph: Expression/LAMBDA edited inside a drill-in
  const area = getActiveArea();

  if (editor && removed.length > 0) {
    const conns = editor.getConnections().filter(
      (c) => c.target === node.id && removed.includes(c.targetInput as string),
    );
    for (const c of conns) await editor.removeConnection(c.id);
  }
  for (const v of removed) node.removeInput(v);

  node.height = computeExprHeight(node.varNames.length);
  if (area) {
    // The card height is normally content-driven (NodeCard's ResizeObserver
    // reports the rendered size back into node.height). But auto-arrange ("tidy")
    // pins a *fixed* inline height on the card element via area.resize — once
    // tidied, the card can no longer grow, so adding an input row (a+b → a+b+c)
    // makes the value box overflow the frozen height. Clear that pin so the card
    // reflows to its new content; the ResizeObserver then re-syncs node.height.
    clearPinnedHeight(area, node.id);
    await area.update("node", node.id);
  }
  await processGraph();
}

/** Card height for an Equation node: header + formula box + one HERO row per
 *  variable (in+out sockets share the row) + the Check row. The rendered card
 *  is content-driven; this just seeds a sane size after a formula edit. */
export function computeEquationHeight(varCount: number): number {
  return 110 + (Math.max(varCount, 0) + 1) * 46;
}

/**
 * Apply a new equation to an Equation node: reparse, add/remove the
 * per-variable INPUT and OUTPUT sockets (dropping cables on both sides for
 * removed variables), resize, recompute. Mirrors applyExprChange; the extra
 * work is the paired output socket per variable.
 */
export async function applyEquationChange(node: EquationNode, newExpr: string): Promise<void> {
  if (node.locked) return;
  node.expr = newExpr;
  const { removed } = node._rebuild();

  const editor = getActiveEditor();
  const area = getActiveArea();

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
    await area.update("node", node.id);
  }
  await processGraph();
}

/**
 * Same edit path for a LAMBDA node, which re-derives sockets from BOTH its
 * formula and its declared-parameters field (captured = variables − params).
 * Used by the on-card fields and the formula popup.
 */
export async function applyLambdaChange(
  node: LambdaNode,
  change: { expr?: string; params?: string },
): Promise<void> {
  if (change.expr !== undefined) node.expr = change.expr;
  if (change.params !== undefined) node.params = change.params;
  const { removed } = node._rebuild();

  const editor = getActiveEditor(); // active graph: Expression/LAMBDA edited inside a drill-in
  const area = getActiveArea();

  if (editor && removed.length > 0) {
    const conns = editor.getConnections().filter(
      (c) => c.target === node.id && removed.includes(c.targetInput as string),
    );
    for (const c of conns) await editor.removeConnection(c.id);
  }
  for (const v of removed) node.removeInput(v);

  // One extra row vs Expression: the λ(params) field above the formula box.
  node.height = computeExprHeight(node.captured.length) + INPUT_ROW_PITCH;
  if (area) {
    clearPinnedHeight(area, node.id);
    await area.update("node", node.id);
  }
  await processGraph();
}

/**
 * Remove the fixed inline `height` auto-arrange stamped on a node's card, so the
 * card returns to content-driven sizing. Targets the same element rete-area's
 * `resize()` writes to (the node view's first non-span child = the `.solenoid-node`
 * card). Width is left alone — only the vertical pin causes the overflow.
 */
function clearPinnedHeight(area: NonNullable<ReturnType<typeof getActiveArea>>, nodeId: string): void {
  const card = area.nodeViews
    .get(nodeId)
    ?.element.querySelector<HTMLElement>("*:not(span):not([fragment])");
  if (card) card.style.height = "";
}
