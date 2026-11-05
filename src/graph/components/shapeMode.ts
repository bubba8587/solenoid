// [[B11]] maximalMerge. Mechanics: [[input-cable-pruning]].
import { getOwningEditor, getOwningView } from "../activeGraph";
import { processGraph } from "../process";
import type { ShapeMode } from "../nodes/shared";

type Shaped = { id: string; mode: ShapeMode; _rebuildSockets(): void; edited(): void };

/** List and Grid carry different socket sets, so every cable goes first: removing a socket a cable still references is unsafe. */
export async function applyShapeMode(node: Shaped, mode: ShapeMode): Promise<void> {
  if (node.mode === mode) return;
  node.mode = mode;
  const editor = getOwningEditor(node.id);
  if (editor) {
    const conns = editor.getConnections().filter((c) => c.target === node.id || c.source === node.id);
    for (const c of conns) await editor.removeConnection(c.id);
  }
  node._rebuildSockets();
  await getOwningView(node.id)?.rerenderNode(node.id);
  node.edited(); await processGraph();
}
