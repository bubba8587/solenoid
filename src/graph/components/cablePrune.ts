// [[B11]] maximalMerge. Mechanics: tree/specs/canvas/input-cable-pruning.md.
import { getOwningEditor } from "../activeGraph";

type Gone = Iterable<string> | ((key: string) => boolean);

/** `gone` is the set of departing keys, or a predicate over the socket key for the complement case. */
async function dropCables(nodeId: string, side: "input" | "output", gone: Gone): Promise<void> {
  const editor = getOwningEditor(nodeId);
  if (!editor) return;
  const test = typeof gone === "function"
    ? gone
    : ((s) => (k: string) => s.has(k))(new Set(gone));
  const stale = editor.getConnections().filter((c) => {
    const [end, key] = side === "input" ? [c.target, c.targetInput] : [c.source, c.sourceOutput];
    return end === nodeId && typeof key === "string" && test(key);
  });
  for (const c of stale) await editor.removeConnection(c.id);
}

export function dropInputCables(nodeId: string, gone: Gone): Promise<void> {
  return dropCables(nodeId, "input", gone);
}

/** For an op switch that removes an output socket. */
export function dropOutputCables(nodeId: string, gone: Gone): Promise<void> {
  return dropCables(nodeId, "output", gone);
}
