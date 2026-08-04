import { getActiveEditor } from "../activeGraph";

// THE input-cable pruning SSOT (`sourceInvariants.test.ts` pins that components don't
// hand-roll it): prune BEFORE the socket is hidden or removed, go through the ACTIVE
// editor (a drill-in node edits its own graph), snapshot before removing, and await
// each removal (each is its own undo entry).

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
