// [[C8]] declareOnce. Mechanics: tree/specs/canvas/input-cable-pruning.md.
import { getOwningEditor } from "../activeGraph";

/** `gone` is the set of departing keys, or a predicate over the target-input key for the complement case. */
export async function dropInputCables(
  nodeId: string,
  gone: Iterable<string> | ((targetInput: string) => boolean),
): Promise<void> {
  const editor = getOwningEditor(nodeId);
  if (!editor) return;
  const test = typeof gone === "function"
    ? gone
    : ((s) => (k: string) => s.has(k))(new Set(gone));
  const stale = editor.getConnections().filter(
    (c) => c.target === nodeId && typeof c.targetInput === "string" && test(c.targetInput),
  );
  for (const c of stale) await editor.removeConnection(c.id);
}

/** For an op switch that removes an output socket. */
export async function dropOutputCables(
  nodeId: string,
  gone: Iterable<string> | ((sourceOutput: string) => boolean),
): Promise<void> {
  const editor = getOwningEditor(nodeId);
  if (!editor) return;
  const test = typeof gone === "function"
    ? gone
    : ((s) => (k: string) => s.has(k))(new Set(gone));
  const stale = editor.getConnections().filter(
    (c) => c.source === nodeId && typeof c.sourceOutput === "string" && test(c.sourceOutput),
  );
  for (const c of stale) await editor.removeConnection(c.id);
}
