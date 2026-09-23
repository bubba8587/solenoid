// [[D16]] retypeReconciles
import type { View } from "./view";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { FormatControllerNode, ConvertNode, ConduitNode } from "./rete-nodes";
import { SolenoidSocket, canConnect, declaredTypeOf } from "./sockets";
import { settleWildcardTypes } from "./trueAnyAdopt";

export async function retypeOutputCables(
  editor: NodeEditor<Schemes>,
  view: View | null,
  nodeId: string,
  outKey: string,
): Promise<void> {
  const outSock = editor.getNode(nodeId)?.outputs[outKey]?.socket;
  const newType = outSock instanceof SolenoidSocket ? outSock.dataType : "trueany";
  for (const c of [...editor.getConnections()]) {
    if (c.source !== nodeId || c.sourceOutput !== outKey) continue;
    const inSock = editor.getNode(c.target)?.inputs?.[c.targetInput]?.socket;
    // Judge an adoptive input by its base, not the type it adopted from this very cable.
    const inType = declaredTypeOf(inSock);
    if (!inType || !canConnect(newType, inType)) await editor.removeConnection(c.id);
  }
  reconcileFcTypes(editor, view);
}

/** `view` is null for a graph nobody is looking at (a closed composite): the model still settles, nothing re-renders. */
export function reconcileFcTypes(
  editor: NodeEditor<Schemes>,
  view: View | null,
): void {
  const settled = settleWildcardTypes(editor);
  let cablesStale = false;
  if (settled.conduitChanged) {
    for (const n of editor.getNodes()) {
      if (!(n instanceof ConduitNode)) continue;
      void view?.rerenderNode(n.id);
      cablesStale = true;
    }
  }
  for (const id of settled.adopted) {
    void view?.rerenderNode(id);
    cablesStale = true;
  }
  if (cablesStale) void view?.rerenderCables();
  for (const n of editor.getNodes()) {
    if (n instanceof ConvertNode) {
      n.syncUnitArrows(editor);
      void view?.rerenderNode(n.id);
    }
  }
  let anyRetyped = false;
  for (const n of editor.getNodes()) {
    if (!(n instanceof FormatControllerNode)) continue;
    const retyped = n.adaptTypeFromConnections(editor);
    n.refreshAnnotation(editor);
    void view?.rerenderNode(n.id);
    anyRetyped ||= retyped;
  }
  // A retyped socket's cables stay detached until their paths recompute next frame.
  if (anyRetyped && view) requestAnimationFrame(() => { void view.rerenderCables(); });
}

export function reconcileTypesAfterEdit(
  editor: NodeEditor<Schemes>,
  view: View | null,
): void {
  const settled = settleWildcardTypes(editor);
  if (!settled.conduitChanged && settled.adopted.size === 0) return;
  reconcileFcTypes(editor, view);
}
