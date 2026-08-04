import { getActiveEditor } from "../activeGraph";

// THE input-cable pruning loop (SSOT). Every "this input socket is going away"
// moment must drop the cables wired into it first; `sourceInvariants.test.ts`
// pins that components don't hand-roll it again. The rules:
//  • prune BEFORE the socket is hidden or removed — removeInput while a cable
//    still references the socket is unsafe, and a hidden socket with a live
//    cable is an invisible wire;
//  • go through the ACTIVE editor — a node inside a composite drill-in edits
//    its own graph, not the main one;
//  • snapshot, then remove — removals mutate the connection list;
//  • await each removal — every removeConnection is its own undo entry.

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
