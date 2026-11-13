// [[B11]] maximalMerge. Mechanics: [[input-cable-pruning]].
import { getOwningEditor, getOwningView } from "../activeGraph";
import { processEdited } from "../process";
import type { ShapeMode } from "../nodes/shared";

type Shaped<M extends string> = { id: string; mode: M; _rebuildSockets(): void; edited(): void };

/** Each shape carries its own socket set, so every cable goes first: removing a socket a cable still references is unsafe. */
export async function applyShapeMode<M extends string = ShapeMode>(node: Shaped<M>, mode: M): Promise<void> {
  if (node.mode === mode) return;
  const editor = getOwningEditor(node.id);
  if (editor) {
    const conns = editor.getConnections().filter((c) => c.target === node.id || c.source === node.id);
    for (const c of conns) await editor.removeConnection(c.id);
  }
  // No await between these two: a render in between would draw the old shape's answer in the new shape's display.
  node.mode = mode;
  node._rebuildSockets();
  await getOwningView(node.id)?.rerenderNode(node.id);
  await processEdited(node.id, [], { topology: true });
}
