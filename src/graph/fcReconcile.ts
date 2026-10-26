// [[B11]] maximalMerge
import type { View } from "./view";
import type { GraphEditor } from "./graphEditor";
import type { Schemes } from "./schemes";
import { FormatControllerNode, ConvertNode, ConduitNode } from "./nodeClasses";
import { SolenoidSocket, canConnect, declaredTypeOf, type SocketDataType } from "./sockets";
import { settleWildcardTypes } from "./trueAnyAdopt";
import { fcFacts } from "./fcFacts";

export async function retypeOutputCables(
  editor: GraphEditor<Schemes>,
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

/** The input-side twin of `retypeOutputCables`: after an in-place input retype, drop only the cables the new type refuses. */
export async function retypeInputCables(
  editor: GraphEditor<Schemes>,
  view: View | null,
  nodeId: string,
  inKey: string,
): Promise<void> {
  const inType = declaredTypeOf(editor.getNode(nodeId)?.inputs[inKey]?.socket);
  for (const c of [...editor.getConnections()]) {
    if (c.target !== nodeId || c.targetInput !== inKey) continue;
    const outSock = editor.getNode(c.source)?.outputs?.[c.sourceOutput]?.socket;
    if (!inType || !(outSock instanceof SolenoidSocket) || !canConnect(outSock.dataType, inType)) await editor.removeConnection(c.id);
  }
  reconcileFcTypes(editor, view);
}

/** `view` is null for a graph nobody is looking at (a closed composite): the model still settles, nothing re-renders. */
export function reconcileFcTypes(
  editor: GraphEditor<Schemes>,
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
  reconcileFcs(editor, view);
}

/** The Format Controller reconcile (`fc.rs`): every FC takes its type and its dictated from-unit, every Convert its
 *  arrows, and then every FC writes its annotation. */
export function reconcileFcs(editor: GraphEditor<Schemes>, view: View | null): void {
  const answer = JSON.parse(editor.core().reconcileFcs(JSON.stringify(fcFacts(editor as never)))) as {
    fcs: [string, SocketDataType, string][];
    converts: [string, boolean, boolean][];
  };
  let anyRetyped = false;
  for (const [id, type, dictated] of answer.fcs) {
    const n = editor.getNode(id);
    if (n instanceof FormatControllerNode) anyRetyped = n.settle(type, dictated) || anyRetyped;
  }
  for (const [id, up, down] of answer.converts) {
    const n = editor.getNode(id);
    if (!(n instanceof ConvertNode)) continue;
    n.imposesUp = up;
    n.imposesDown = down;
    void view?.rerenderNode(id);
  }
  for (const n of editor.getNodes()) {
    if (!(n instanceof FormatControllerNode)) continue;
    n.refreshAnnotation(editor as never);
    void view?.rerenderNode(n.id);
  }
  // A retyped socket's cables stay detached until their paths recompute next frame.
  if (anyRetyped && view) requestAnimationFrame(() => { void view.rerenderCables(); });
}

export function reconcileTypesAfterEdit(
  editor: GraphEditor<Schemes>,
  view: View | null,
): void {
  const settled = settleWildcardTypes(editor);
  if (!settled.conduitChanged && settled.adopted.size === 0) return;
  reconcileFcTypes(editor, view);
}
