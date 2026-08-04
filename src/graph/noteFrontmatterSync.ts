// After a frontmatter SOURCE node (a Note, or an Imported Obsidian note) re-derives
// its output sockets from its body (syncFields → { removed, retyped }), any cable
// whose output key VANISHED or changed to an incompatible TYPE is now dangling. This
// is the one place that cleanup lives, shared by NoteComponent's on-blur commit and
// the Import node's file-load.

import { getActiveEditor } from "./activeGraph";
import { SolenoidSocket, canConnect, type SocketDataType } from "./sockets";

/** Drop cables stranded by a frontmatter re-sync. Returns true if a cable was
 *  dropped because its output key was REMOVED (the caller may fold that into an undo
 *  entry). A retyped output keeps its cable when the downstream input still accepts
 *  the new type (`any`, or a same-family widening); else it's dropped. */
export async function dropStrandedFrontmatterCables(
  nodeId: string,
  removed: string[],
  retyped: { key: string; type: SocketDataType }[],
): Promise<boolean> {
  const editor = getActiveEditor();
  if (!editor || (removed.length === 0 && retyped.length === 0)) return false;
  const retypedMap = new Map(retyped.map((r) => [r.key, r.type]));
  let strandedByRemoval = false;
  for (const c of editor.getConnections()) {
    if (c.source !== nodeId) continue;
    if (removed.includes(c.sourceOutput)) {
      await editor.removeConnection(c.id);
      strandedByRemoval = true;
      continue;
    }
    const newType = retypedMap.get(c.sourceOutput);
    if (newType === undefined) continue;
    const inSock = editor.getNode(c.target)?.inputs?.[c.targetInput]?.socket;
    const inType = inSock instanceof SolenoidSocket ? inSock.dataType : undefined;
    if (!inType || !canConnect(newType, inType)) await editor.removeConnection(c.id);
  }
  return strandedByRemoval;
}
