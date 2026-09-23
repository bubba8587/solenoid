// [[D16]] retypeReconciles
import { ClassicPreset, type NodeEditor } from "rete";
import type { Schemes, SolenoidConnection } from "./schemes";
import type { View } from "./view";
import { canConnect, SolenoidSocket, type SocketDataType } from "./sockets";
import { cablePendingStore } from "./cableState";

type Editor = NodeEditor<Schemes>;

interface Endpoint { target: string; targetInput: string; label: string }

const socketType = (socket: unknown): SocketDataType | null =>
  socket instanceof SolenoidSocket ? socket.dataType : null;

const inputLabel = (node: { inputs: Record<string, { label?: string } | undefined> }, key: string): string =>
  node.inputs[key]?.label ?? key;

/** Capture before the retype, so the dropped cables can be diffed out afterward. */
export function snapshotOutgoing(editor: Editor, nodeId: string, outKey: string): Endpoint[] {
  return editor.getConnections()
    .filter((c) => c.source === nodeId && c.sourceOutput === outKey)
    .map((c) => {
      const tgt = editor.getNode(c.target);
      return { target: c.target, targetInput: c.targetInput, label: tgt ? inputLabel(tgt, c.targetInput) : c.targetInput };
    });
}

export async function reconcilePendingOnRetype(
  editor: Editor, view: View | null, nodeId: string, outKey: string, before: Endpoint[],
): Promise<void> {
  const live = new Set(
    editor.getConnections()
      .filter((c) => c.source === nodeId && c.sourceOutput === outKey)
      .map((c) => `${c.target}\u0000${c.targetInput}`),
  );
  for (const b of before) {
    if (live.has(`${b.target}\u0000${b.targetInput}`)) continue;
    if (!editor.getNode(b.target)) continue;
    cablePendingStore.mark({ source: nodeId, sourceOutput: outKey, target: b.target, targetInput: b.targetInput, label: b.label });
  }
  await reattachPending(editor, view, nodeId, outKey);
}

export async function reattachPending(editor: Editor, view: View | null, nodeId: string, outKey: string): Promise<void> {
  const src = editor.getNode(nodeId);
  const outType = socketType(src?.outputs[outKey]?.socket);
  if (!src || !outType) return;
  let changed = false;
  for (const p of cablePendingStore.forSource(nodeId)) {
    if (p.sourceOutput !== outKey) continue;
    const tgt = editor.getNode(p.target);
    if (!tgt) { cablePendingStore.drop(p.id); changed = true; continue; }
    const byLabel = Object.keys(tgt.inputs).filter((k) => inputLabel(tgt, k) === p.label);
    const key = tgt.inputs[p.targetInput] ? p.targetInput : byLabel.length === 1 ? byLabel[0] : undefined;
    const inType = key ? socketType(tgt.inputs[key]?.socket) : null;
    if (!key || !inType || !canConnect(outType, inType)) continue;
    const occupants = editor.getConnections().filter((c) => c.target === p.target && c.targetInput === key);
    const already = occupants.some((c) => c.source === nodeId && c.sourceOutput === outKey);
    const multi = (tgt.inputs[key] as { multipleConnections?: boolean } | undefined)?.multipleConnections;
    if (!already && occupants.length > 0 && !multi) { cablePendingStore.drop(p.id); changed = true; continue; }
    if (!already) {
      const conn = new ClassicPreset.Connection(src, outKey, tgt, key) as SolenoidConnection;
      await editor.addConnection(conn);
    }
    cablePendingStore.drop(p.id);
    changed = true;
  }
  if (changed) view?.rerenderCables?.();
}
