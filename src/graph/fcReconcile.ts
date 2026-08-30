import type { View } from "./view";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { FormatControllerNode, ConvertNode, ConduitNode } from "./rete-nodes";
import { SolenoidSocket, AdoptiveSocket, canConnect } from "./sockets";
import { settleWildcardTypes } from "./trueAnyAdopt";

/** Call after an OUTPUT socket's type changes IN PLACE; drops only the outgoing cables
 *  the new type can no longer feed. The caller owns the re-render + recompute. */
export async function retypeOutputCables(
  editor: NodeEditor<Schemes>,
  view: View,
  nodeId: string,
  outKey: string,
): Promise<void> {
  const outSock = editor.getNode(nodeId)?.outputs[outKey]?.socket;
  const newType = outSock instanceof SolenoidSocket ? outSock.dataType : "trueany";
  for (const c of [...editor.getConnections()]) {
    if (c.source !== nodeId || c.sourceOutput !== outKey) continue;
    const inSock = editor.getNode(c.target)?.inputs?.[c.targetInput]?.socket;
    // An adoptive input is judged by its DECLARED rung, not the type it adopted from this
    // very cable: a rank-2 result reconciling onto a Display that adopted the rank-1 type
    // must keep the cable and re-adopt (adoptKeepsCables).
    const inType = inSock instanceof AdoptiveSocket ? inSock.base : inSock instanceof SolenoidSocket ? inSock.dataType : undefined;
    if (!inType || !canConnect(newType, inType)) await editor.removeConnection(c.id);
  }
  reconcileFcTypes(editor, view);
}

/** Does NOT call processGraph / bumpConnectionVersion — the caller owns the recompute. */
export function reconcileFcTypes(
  editor: NodeEditor<Schemes>,
  view: View,
): void {
  // Derived socket types FIRST, so the FCs below resolve against them.
  const settled = settleWildcardTypes(editor);
  // Cables re-derive as ONE edge-list rebuild, never once per connection.
  let cablesStale = false;
  if (settled.conduitChanged) {
    for (const n of editor.getNodes()) {
      if (!(n instanceof ConduitNode)) continue;
      void view.rerenderNode(n.id);
      cablesStale = true;
    }
  }
  for (const id of settled.adopted) {
    void view.rerenderNode(id);
    cablesStale = true;
  }
  if (cablesStale) void view.rerenderCables();
  // Convert's arrows refresh before the FCs so the chain settles in one pass.
  for (const n of editor.getNodes()) {
    if (n instanceof ConvertNode) {
      n.syncUnitArrows(editor);
      void view.rerenderNode(n.id);
    }
  }
  let anyRetyped = false;
  for (const n of editor.getNodes()) {
    if (!(n instanceof FormatControllerNode)) continue;
    const retyped = n.adaptTypeFromConnections(editor);
    n.refreshAnnotation(editor);
    void view.rerenderNode(n.id);
    anyRetyped ||= retyped;
  }
  // A socket retype/re-render detaches cables touching it until paths recompute.
  if (anyRetyped) requestAnimationFrame(() => { void view.rerenderCables(); });
}

/** Call after a LITERAL edit commits — no connection event fires there, yet a socket type
 *  can derive from static CONFIG; the full reconcile is paid only when a type moved. */
export function reconcileTypesAfterEdit(
  editor: NodeEditor<Schemes>,
  view: View,
): void {
  const settled = settleWildcardTypes(editor);
  if (!settled.conduitChanged && settled.adopted.size === 0) return;
  reconcileFcTypes(editor, view); // re-settles (a no-op fixpoint) and owns the renders
}
