// [[D10]] onePrunePath. Mechanics: specs/input-cable-pruning.md.
import { getActiveEditor } from "../activeGraph";

/** Remove every cable wired INTO the given input keys of `nodeId`. `gone` is the
 *  set of departing keys, or a predicate over the target-input key for the
 *  complement case ("everything the next mode does NOT show"). */
export async function dropInputCables(
  nodeId: string,
  gone: Iterable<string> | ((targetInput: string) => boolean),
): Promise<void> {
  const editor = getActiveEditor();
  if (!editor) return;
  const test = typeof gone === "function"
    ? gone
    : ((s) => (k: string) => s.has(k))(new Set(gone));
  const stale = editor.getConnections().filter(
    (c) => c.target === nodeId && typeof c.targetInput === "string" && test(c.targetInput),
  );
  for (const c of stale) await editor.removeConnection(c.id);
}

/** Remove every cable wired OUT of the given output keys of `nodeId` — the output-side
 *  sibling of `dropInputCables`, for an op switch that REMOVES an output socket (a
 *  removed socket left with a live cable is the [[D10]] onePrunePath trap). */
export async function dropOutputCables(
  nodeId: string,
  gone: Iterable<string> | ((sourceOutput: string) => boolean),
): Promise<void> {
  const editor = getActiveEditor();
  if (!editor) return;
  const test = typeof gone === "function"
    ? gone
    : ((s) => (k: string) => s.has(k))(new Set(gone));
  const stale = editor.getConnections().filter(
    (c) => c.source === nodeId && typeof c.sourceOutput === "string" && test(c.sourceOutput),
  );
  for (const c of stale) await editor.removeConnection(c.id);
}
