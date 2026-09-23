// [[B1]] obsidianBet

import { getActiveEditor } from "./activeGraph";
import { SolenoidSocket, canConnect, type SocketDataType } from "./sockets";

/** True when a cable was dropped for a removed output key, which callers fold into an undo entry. */
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
