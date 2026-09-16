// Option B — pending-reconnect ghosts for the Input Switch. When the One↔Many toggle
// retypes the `out` socket, `retypeOutputCables` DROPS the downstream cables the new type
// can't feed (there is then no real rete connection to ghost, unlike Option A's in-place
// retype which keeps the connection and marks it — see archive/dev-notes-history.md
// 2026-09-08d). We record each dropped cable in `cablePendingStore`, draw it as a ghost,
// and re-materialise the real connection when the output type fits that socket again — the
// same key if it is back, else the same label. Persist nothing.
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

/** The cables currently leaving `nodeId`'s `outKey`, captured BEFORE a retype so the drops
 *  can be diffed out afterward. */
export function snapshotOutgoing(editor: Editor, nodeId: string, outKey: string): Endpoint[] {
  return editor.getConnections()
    .filter((c) => c.source === nodeId && c.sourceOutput === outKey)
    .map((c) => {
      const tgt = editor.getNode(c.target);
      return { target: c.target, targetInput: c.targetInput, label: tgt ? inputLabel(tgt, c.targetInput) : c.targetInput };
    });
}

/** After a retype: mark the cables the retype dropped as pending ghosts, then re-materialise
 *  any pending ghost whose target socket now accepts the output type. Both run each retype,
 *  so a flip that drops one cable and reattaches another does both in one pass. */
export async function reconcilePendingOnRetype(
  editor: Editor, view: View | null, nodeId: string, outKey: string, before: Endpoint[],
): Promise<void> {
  const live = new Set(
    editor.getConnections()
      .filter((c) => c.source === nodeId && c.sourceOutput === outKey)
      .map((c) => `${c.target}\u0000${c.targetInput}`),
  );
  // A cable in the snapshot that's gone now was dropped by the retype → ghost it (only when
  // its target node still exists; a deleted target has nothing to reconnect to).
  for (const b of before) {
    if (live.has(`${b.target}\u0000${b.targetInput}`)) continue;
    if (!editor.getNode(b.target)) continue;
    cablePendingStore.mark({ source: nodeId, sourceOutput: outKey, target: b.target, targetInput: b.targetInput, label: b.label });
  }
  await reattachPending(editor, view, nodeId, outKey);
}

/** Re-materialise the real cable for every pending ghost of this source whose target socket
 *  is back and compatible (same key first, else the same label). */
export async function reattachPending(editor: Editor, view: View | null, nodeId: string, outKey: string): Promise<void> {
  const src = editor.getNode(nodeId);
  const outType = socketType(src?.outputs[outKey]?.socket);
  if (!src || !outType) return;
  let changed = false;
  for (const p of cablePendingStore.forSource(nodeId)) {
    if (p.sourceOutput !== outKey) continue;
    const tgt = editor.getNode(p.target);
    if (!tgt) { cablePendingStore.drop(p.id); changed = true; continue; } // target node gone
    // Same key if it's back; else the ONE input whose label matches the drop-time label
    // (two inputs sharing a label is ambiguous — the ghost waits).
    const byLabel = Object.keys(tgt.inputs).filter((k) => inputLabel(tgt, k) === p.label);
    const key = tgt.inputs[p.targetInput] ? p.targetInput : byLabel.length === 1 ? byLabel[0] : undefined;
    const inType = key ? socketType(tgt.inputs[key]?.socket) : null;
    if (!key || !inType || !canConnect(outType, inType)) continue; // socket not back / still incompatible
    const occupants = editor.getConnections().filter((c) => c.target === p.target && c.targetInput === key);
    const already = occupants.some((c) => c.source === nodeId && c.sourceOutput === outKey);
    // The user rewired that single-cable input from elsewhere while the ghost waited: theirs
    // wins and the ghost dies, never a second cable on the input (flowModel's connect() evicts
    // the same way).
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
