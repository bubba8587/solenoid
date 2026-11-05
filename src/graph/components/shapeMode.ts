// [[B11]] maximalMerge. Mechanics: [[input-cable-pruning]].
import { getOwningEditor, getOwningView } from "../activeGraph";
import { processGraph } from "../process";
import type { ShapeMode } from "../nodes/shared";

type Shaped<M extends string> = { id: string; mode: M; _rebuildSockets(): void; edited(): void };

/** Each shape carries its own socket set, so every cable goes first: removing a socket a cable still references is unsafe. */
export async function applyShapeMode<M extends string = ShapeMode>(node: Shaped<M>, mode: M): Promise<void> {
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
