import type { GetColumnNode, AddColumnNode, SplitFrameNode } from "../rete-nodes";
import { getColumnOutput, addColumnInput, splitMatrixOutput, type GetColumnReadAs, type AddColumnAddAs, type SplitColType } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { dropInputCables } from "./cablePrune";
import { retypeOutputCables, reconcileFcTypes } from "../fcReconcile";

/** Switch a Get Column node's "read as" type. The port's socket is mutated IN PLACE —
 *  remove+add churns the socket set and leaves DOM elements ("Found more than one"). */
export async function applyGetColumnReadAs(node: GetColumnNode, readAs: GetColumnReadAs): Promise<void> {
  if (node.readAs === readAs) return;
  node.readAs = readAs;

  const editor = getActiveEditor(); // active graph: frame-node retype inside a drill-in
  const area = getActiveArea();
  const out = node.outputs.values;
  if (out) out.socket = getColumnOutput(readAs).socket;
  if (editor && area) await retypeOutputCables(editor, area, node.id, "values");

  if (area) await area.rerenderNode(node.id);
  await processGraph();
}

/** The write-side mirror: swaps the Values *input* socket, same in-place reasoning. */
export async function applyAddColumnAddAs(node: AddColumnNode, addAs: AddColumnAddAs): Promise<void> {
  if (node.addAs === addAs) return;
  node.addAs = addAs;

  const editor = getActiveEditor();
  const area = getActiveArea();
  await dropInputCables(node.id, ["values"]);
  const inp = node.inputs.values;
  if (inp) inp.socket = addColumnInput(addAs).socket;

  if (area) await area.rerenderNode(node.id);
  // An FC docked to this input (or one downstream) must re-resolve against the new
  // input type — no connection event fires on an in-place socket swap.
  if (editor && area) reconcileFcTypes(editor, area);
  await processGraph();
}

/** Switch a Split Frame node's column-type filter, retyping the Matrix output so
 *  downstream type-gated inputs accept it. Same in-place reasoning. */
export async function applySplitColType(node: SplitFrameNode, colType: SplitColType): Promise<void> {
  if (node.colType === colType) return;
  node.colType = colType;

  const editor = getActiveEditor();
  const area = getActiveArea();
  const out = node.outputs.matrix;
  if (out) out.socket = splitMatrixOutput(colType).socket;
  if (editor && area) await retypeOutputCables(editor, area, node.id, "matrix");

  if (area) await area.rerenderNode(node.id);
  await processGraph();
}
