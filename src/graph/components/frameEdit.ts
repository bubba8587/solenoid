// [[B11]] maximalMerge
import type { GetColumnNode, AddColumnNode, SplitFrameNode } from "../rete-nodes";
import type { GetColumnReadAs, AddColumnAddAs, SplitColType } from "../rete-nodes";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { retypeOutputCables, retypeInputCables } from "../fcReconcile";

/** The socket is swapped in place: remove and add churns the socket set and leaves duplicate DOM ("Found more than one"). */
export async function applyGetColumnReadAs(node: GetColumnNode, readAs: GetColumnReadAs): Promise<void> {
  if (node.readAs === readAs) return;
  node.setReadAs(readAs);
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  if (editor && view) await retypeOutputCables(editor, view, node.id, "values");
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

export async function applyAddColumnAddAs(node: AddColumnNode, addAs: AddColumnAddAs): Promise<void> {
  if (node.addAs === addAs) return;
  node.setAddAs(addAs);
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  if (editor) await retypeInputCables(editor, view, node.id, "values");
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

export async function applySplitColType(node: SplitFrameNode, colType: SplitColType): Promise<void> {
  if (node.colType === colType) return;
  node.setColType(colType);
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  if (editor && view) await retypeOutputCables(editor, view, node.id, "matrix");
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}
