import type { GetColumnNode, AddColumnNode, SplitFrameNode } from "../rete-nodes";
import { getColumnOutput, addColumnInput, splitMatrixOutput, type GetColumnReadAs, type AddColumnAddAs, type SplitColType } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { dropInputCables } from "./cablePrune";
import { retypeOutputCables, reconcileFcTypes } from "../fcReconcile";

/**
 * Switch a Get Column node's "read as" type. The output socket type changes with
 * it (number → list, text → strlist, date → datelist). We mutate the existing
 * port's socket in place rather than remove+add the port: tearing a port out and
 * re-adding it churns the node's whole socket set and the old socket DOM elements
 * don't unmount cleanly ("Found more than one element for socket…"). The socket is
 * swapped, then each outgoing cable the new type can still feed is kept (an `any`
 * input survives) and downstream FCs re-adapt so the type change propagates.
 */
export async function applyGetColumnReadAs(node: GetColumnNode, readAs: GetColumnReadAs): Promise<void> {
  if (node.readAs === readAs) return;
  node.readAs = readAs;

  const editor = getActiveEditor(); // active graph: frame-node retype inside a drill-in
  const area = getActiveArea();
  const out = node.outputs.values;
  if (out) out.socket = getColumnOutput(readAs).socket;
  if (editor && area) await retypeOutputCables(editor, area, node.id, "values");

  if (area) await area.update("node", node.id);
  await processGraph();
}

/**
 * Switch an Add Column node's "add as" type — the write-side mirror. Swaps the
 * Values *input* socket in place (number → list, text → strlist, date → datelist)
 * and the stored column type follows; same in-place reasoning as above.
 */
export async function applyAddColumnAddAs(node: AddColumnNode, addAs: AddColumnAddAs): Promise<void> {
  if (node.addAs === addAs) return;
  node.addAs = addAs;

  const editor = getActiveEditor(); // active graph: frame-node retype inside a drill-in
  const area = getActiveArea();
  await dropInputCables(node.id, ["values"]);
  const inp = node.inputs.values;
  if (inp) inp.socket = addColumnInput(addAs).socket;

  if (area) await area.update("node", node.id);
  // An FC docked to this input (or one downstream) must re-resolve against the new
  // input type — no connection event fires on an in-place socket swap.
  if (editor && area) reconcileFcTypes(editor, area);
  await processGraph();
}

/**
 * Switch a Split Frame node's column-type filter. The Matrix *output* socket type
 * changes with it (number → table, date → datetable, logical → logicaltable, text →
 * strtable) so downstream type-gated inputs accept the right matrix. Same in-place
 * swap + retype-cables reasoning as Get Column above.
 */
export async function applySplitColType(node: SplitFrameNode, colType: SplitColType): Promise<void> {
  if (node.colType === colType) return;
  node.colType = colType;

  const editor = getActiveEditor(); // active graph: frame-node retype inside a drill-in
  const area = getActiveArea();
  const out = node.outputs.matrix;
  if (out) out.socket = splitMatrixOutput(colType).socket;
  if (editor && area) await retypeOutputCables(editor, area, node.id, "matrix");

  if (area) await area.update("node", node.id);
  await processGraph();
}
