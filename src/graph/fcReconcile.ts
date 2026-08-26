import type { Surface } from "./surface";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { FormatControllerNode, ConvertNode, ConduitNode } from "./rete-nodes";
import { SolenoidSocket, canConnect } from "./sockets";
import { settleWildcardTypes } from "./trueAnyAdopt";

/** Call after an OUTPUT socket's type changes IN PLACE; drops only the outgoing cables
 *  the new type can no longer feed. The caller owns the re-render + recompute. */
export async function retypeOutputCables(
  editor: NodeEditor<Schemes>,
  area: Surface,
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
  area: Surface,
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

/** Call after a LITERAL edit commits — no connection event fires there, yet a socket type
 *  can derive from static CONFIG; the full reconcile is paid only when a type moved. */
export function reconcileTypesAfterEdit(
  editor: NodeEditor<Schemes>,
  area: Surface,
): void {
  const settled = settleWildcardTypes(editor);
  if (!settled.conduitChanged && settled.adopted.size === 0) return;
  reconcileFcTypes(editor, area); // re-settles (a no-op fixpoint) and owns the renders
}
