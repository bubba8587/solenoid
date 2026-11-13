// [[B11]] maximalMerge
import type { View } from "./view";
import type { GraphEditor } from "./graphEditor";
import type { Schemes } from "./schemes";
import { FormatControllerNode, ConvertNode, ConduitNode } from "./nodeClasses";
import { SolenoidSocket, canConnect, declaredTypeOf, type SocketDataType } from "./sockets";
import { settleWildcardTypes } from "./trueAnyAdopt";
import { fcFacts } from "./fcFacts";
import { formatAnnotationStore } from "./formatAnnotationStore";

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
  settled: ReturnType<typeof settleWildcardTypes> = settleWildcardTypes(editor),
): Set<string> {
  let cablesStale = false;
  // A follower retyped in place keeps only the cables its new type still takes.
  for (const [id, key] of settled.followed) {
    const inType = declaredTypeOf(editor.getNode(id)?.inputs[key]?.socket);
    for (const c of [...editor.getConnections()]) {
      if (c.target !== id || c.targetInput !== key) continue;
      const outSock = editor.getNode(c.source)?.outputs?.[c.sourceOutput]?.socket;
      if (!inType || !(outSock instanceof SolenoidSocket) || !canConnect(outSock.dataType, inType)) void editor.removeConnection(c.id);
    }
  }
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
  return new Set([...settled.retyped, ...reconcileFcs(editor, view)]);
}

/** The Format Controller reconcile (`fc.rs`): every FC takes its type and its dictated from-unit, every Convert its
 *  arrows, and then every FC writes its annotation. Returns the cards it changed, for the pass after an edit to reach
 *  (`processEdited`): each FC retyped or whose annotation moved, the card it stamps that annotation on (whose other
 *  readers see it too), and each Convert whose arrows moved. */
export function reconcileFcs(editor: GraphEditor<Schemes>, view: View | null): Set<string> {
  const changed = new Set<string>();
  const answer = JSON.parse(editor.core().reconcileFcs(JSON.stringify(fcFacts(editor as never)))) as {
    fcs: [string, SocketDataType, string][];
    converts: [string, boolean, boolean][];
  };
  // Only a card the reconcile changed redraws: it runs after every cable change, on every FC and Convert.
  let anyRetyped = false;
  const retyped = new Set<string>();
  for (const [id, type, dictated] of answer.fcs) {
    const n = editor.getNode(id);
    if (n instanceof FormatControllerNode && n.settle(type, dictated)) { anyRetyped = true; retyped.add(id); }
  }
  for (const [id, up, down] of answer.converts) {
    const n = editor.getNode(id);
    if (!(n instanceof ConvertNode) || (n.imposesUp === up && n.imposesDown === down)) continue;
    changed.add(id);
    n.imposesUp = up;
    n.imposesDown = down;
    void view?.rerenderNode(id);
  }
  const conns = editor.getConnections();
  for (const n of editor.getNodes()) {
    if (!(n instanceof FormatControllerNode)) continue;
    const src = conns.find((c) => c.target === n.id && c.targetInput === "in");
    const stamped = () => (src ? JSON.stringify(formatAnnotationStore.get(src.source, src.sourceOutput as string)) : "");
    const inherited = JSON.stringify(n.inheritedAnnotation), before = stamped();
    n.refreshAnnotation(editor as never);
    const moved = JSON.stringify(n.inheritedAnnotation) !== inherited;
    if (retyped.has(n.id) || moved) void view?.rerenderNode(n.id);
    if (retyped.has(n.id) || moved) changed.add(n.id);
    if (src && stamped() !== before) { changed.add(n.id); changed.add(src.source); }
  }
  // A retyped socket's cables stay detached until their paths recompute next frame.
  if (anyRetyped && view) requestAnimationFrame(() => { void view.rerenderCables(); });
  return changed;
}

/** The cards whose sockets the settle moved, for the pass after the edit to reach (`processEdited`). */
export function reconcileTypesAfterEdit(
  editor: GraphEditor<Schemes>,
  view: View | null,
): Set<string> {
  const settled = settleWildcardTypes(editor);
  if (!settled.conduitChanged && settled.adopted.size === 0) return settled.retyped;
  // The cards this settle retyped redraw: settling again would find nothing moved and redraw none of them.
  reconcileFcTypes(editor, view, settled);
  return settled.retyped;
}
