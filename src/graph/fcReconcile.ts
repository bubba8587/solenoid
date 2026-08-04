import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import { FormatControllerNode, ConvertNode, ConduitNode } from "./rete-nodes";
import { SolenoidSocket, canConnect } from "./sockets";
import { settleWildcardTypes } from "./trueAnyAdopt";

/** Call after an OUTPUT socket's type is changed IN PLACE. Drops only the outgoing
 *  cables the new type can no longer feed. The caller swaps the socket first and owns
 *  the node re-render + recompute. */
export async function retypeOutputCables(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  nodeId: string,
  outKey: string,
): Promise<void> {
  const outSock = editor.getNode(nodeId)?.outputs[outKey]?.socket;
  const newType = outSock instanceof SolenoidSocket ? outSock.dataType : "trueany";
  for (const c of [...editor.getConnections()]) {
    if (c.source !== nodeId || c.sourceOutput !== outKey) continue;
    const inSock = editor.getNode(c.target)?.inputs?.[c.targetInput]?.socket;
    const inType = inSock instanceof SolenoidSocket ? inSock.dataType : undefined;
    if (!inType || !canConnect(newType, inType)) await editor.removeConnection(c.id);
  }
  reconcileFcTypes(editor, area);
}

/** Does NOT call processGraph / bumpConnectionVersion — the caller owns the recompute. */
export function reconcileFcTypes(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
): void {
  // Derived socket types FIRST, so the FCs below resolve against them.
  const settled = settleWildcardTypes(editor);
  if (settled.conduitChanged) {
    for (const n of editor.getNodes()) {
      if (!(n instanceof ConduitNode)) continue;
      void area.update("node", n.id);
      for (const c of editor.getConnections()) {
        if (c.source === n.id || c.target === n.id) void area.update("connection", c.id);
      }
    }
  }
  for (const id of settled.adopted) {
    void area.update("node", id);
    for (const c of editor.getConnections()) {
      if (c.source === id || c.target === id) void area.update("connection", c.id);
    }
  }
  // Convert's arrows refresh before the FCs so the chain settles in one pass.
  for (const n of editor.getNodes()) {
    if (n instanceof ConvertNode) {
      n.syncUnitArrows(editor);
      void area.update("node", n.id);
    }
  }
  for (const n of editor.getNodes()) {
    if (!(n instanceof FormatControllerNode)) continue;
    const retyped = n.adaptTypeFromConnections(editor);
    n.refreshAnnotation(editor);
    const fcId = n.id;
    void area.update("node", fcId);
    if (retyped) {
      // A socket retype/re-render detaches cables touching it until paths recompute.
      requestAnimationFrame(() => {
        for (const conn of editor.getConnections()) {
          if (conn.source === fcId || conn.target === fcId) void area.update("connection", conn.id);
        }
      });
    }
  }
}

/** Call after a LITERAL edit commits — no connection event fires there, yet a socket
 *  type can be derived from static CONFIG as well as from wiring. Cheap: the full
 *  reconcile is paid only when a type actually moved. */
export function reconcileTypesAfterEdit(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
): void {
  const settled = settleWildcardTypes(editor);
  if (!settled.conduitChanged && settled.adopted.size === 0) return;
  reconcileFcTypes(editor, area); // re-settles (a no-op fixpoint) and owns the renders
}
