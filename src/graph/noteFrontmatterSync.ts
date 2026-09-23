// [[B1]] obsidianBet, [[D16]] retypeReconciles

import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { getOwningEditor } from "./activeGraph";
import { canConnect, declaredTypeOf, type SocketDataType } from "./sockets";

/** `dropStrandedFrontmatterCables` against an explicit editor. */
export async function pruneFrontmatterCables(
  editor: NodeEditor<Schemes>,
  nodeId: string,
  removed: string[],
  retyped: { key: string; type: SocketDataType }[],
): Promise<boolean> {
  if (removed.length === 0 && retyped.length === 0) return false;
  const retypedMap = new Map(retyped.map((r) => [r.key, r.type]));
  let strandedByRemoval = false;
  for (const c of [...editor.getConnections()]) {
    if (c.source !== nodeId) continue;
    if (removed.includes(c.sourceOutput)) {
      await editor.removeConnection(c.id);
      strandedByRemoval = true;
      continue;
    }
    const newType = retypedMap.get(c.sourceOutput);
    if (newType === undefined) continue;
    const inType = declaredTypeOf(editor.getNode(c.target)?.inputs?.[c.targetInput]?.socket);
    if (!inType || !canConnect(newType, inType)) await editor.removeConnection(c.id);
  }
  return strandedByRemoval;
}

/** True when a cable was dropped for a removed output key, which callers fold into an undo entry. */
export async function dropStrandedFrontmatterCables(
  nodeId: string,
  removed: string[],
  retyped: { key: string; type: SocketDataType }[],
): Promise<boolean> {
  const editor = getOwningEditor(nodeId);
  return editor ? pruneFrontmatterCables(editor, nodeId, removed, retyped) : false;
}
