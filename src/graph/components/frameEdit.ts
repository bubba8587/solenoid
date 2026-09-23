// [[D16]] retypeReconciles
import type { GetColumnNode, AddColumnNode, SplitFrameNode } from "../rete-nodes";
import { getColumnOutput, addColumnInput, splitMatrixOutput, type GetColumnReadAs, type AddColumnAddAs, type SplitColType } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveView } from "../activeGraph";
import { dropInputCables } from "./cablePrune";
import { retypeOutputCables, reconcileFcTypes } from "../fcReconcile";

/** The socket is swapped in place: remove and add churns the socket set and leaves duplicate DOM ("Found more than one"). */
export async function applyGetColumnReadAs(node: GetColumnNode, readAs: GetColumnReadAs): Promise<void> {
  if (node.readAs === readAs) return;
  node.readAs = readAs;

  const editor = getActiveEditor();
  const view = getActiveView();
  const out = node.outputs.values;
  if (out) out.socket = getColumnOutput(readAs).socket;
  if (editor && view) await retypeOutputCables(editor, view, node.id, "values");

  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

export async function applyAddColumnAddAs(node: AddColumnNode, addAs: AddColumnAddAs): Promise<void> {
  if (node.addAs === addAs) return;
  node.addAs = addAs;

  const editor = getActiveEditor();
  const view = getActiveView();
  await dropInputCables(node.id, ["values"]);
  const inp = node.inputs.values;
  if (inp) inp.socket = addColumnInput(addAs).socket;

  if (view) await view.rerenderNode(node.id);
  // No connection event fires on an in-place socket swap, so docked FCs re-resolve by hand.
  if (editor && view) reconcileFcTypes(editor, view);
  await processGraph();
}

export async function applySplitColType(node: SplitFrameNode, colType: SplitColType): Promise<void> {
  if (node.colType === colType) return;
  node.colType = colType;

  const editor = getActiveEditor();
  const view = getActiveView();
  const out = node.outputs.matrix;
  if (out) out.socket = splitMatrixOutput(colType).socket;
  if (editor && view) await retypeOutputCables(editor, view, node.id, "matrix");

  if (view) await view.rerenderNode(node.id);
  await processGraph();
}
