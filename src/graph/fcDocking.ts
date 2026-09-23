// [[D41]] formatFlowsDownstream, [[C25]] firstClassUnits
import type { View } from "./view";
import { ClassicPreset, type NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { FormatControllerNode } from "./rete-nodes";
import { getSocketScreenCenter, screenToCanvas } from "./canvasGeometry";
import { dockedNodeStore } from "./dockedNodeStore";

type SolenoidConnection = import("./schemes").SolenoidConnection;

export function computeDockedCanvasPos(
  view: View,
  container: HTMLElement,
  hostNodeId: string,
  socketKey: string,
  side: "input" | "output",
  dockedWidth: number,
  dockedHeight: number,
): { x: number; y: number } | null {
  // Anchor on the host's model position plus the socket's offset in the wrapper, because the post-Tidy snap runs before the wrapper re-commits.
  const hostEl = view.nodeElement(hostNodeId);
  const hostPos = view.position(hostNodeId);
  const sockEl = hostEl?.querySelector<HTMLElement>(`[data-socket-key="${socketKey}"][data-socket-side="${side}"]`);
  let cx: number, cy: number;
  if (hostEl && hostPos && sockEl) {
    const k = view.transform.k || 1;
    const host = hostEl.getBoundingClientRect();
    const r = sockEl.getBoundingClientRect();
    // Snap the offset to the half-px grid first, or an odd FC height makes the rounding below a coin flip that re-docks 1px off on load.
    cx = hostPos.x + Math.round(((r.left + r.width / 2 - host.left) / k) * 2) / 2;
    cy = hostPos.y + Math.round(((r.top + r.height / 2 - host.top) / k) * 2) / 2;
  } else {
    const sc = getSocketScreenCenter(view, hostNodeId, socketKey, side);
    if (!sc) return null;
    ({ x: cx, y: cy } = screenToCanvas(view, container, sc.x, sc.y));
  }
  // Round to whole canvas px, or a fractional dock edge shifts on every re-dock and group autofit creeps after it.
  return {
    x: Math.round(side === "input" ? cx - dockedWidth : cx),
    y: Math.round(cy - dockedHeight / 2),
  };
}

export function dockedRenderedDims(
  view: View,
  nodeId: string,
  fallbackW: number,
  fallbackH: number,
): { w: number; h: number } {
  const el = view.nodeElement(nodeId);
  // [[D64]] exception: the caller supplies the fallback (the FC's declared size).
  return { w: el?.offsetWidth || fallbackW, h: el?.offsetHeight || fallbackH };
}

export function repositionDockedFor(
  editor: NodeEditor<Schemes>,
  view: View,
  container: HTMLElement | null,
  hostId: string,
): void {
  if (!container) return;
  for (const rel of dockedNodeStore.getDockedTo(hostId)) {
    const dockedNode = editor.getNode(rel.id);
    if (!dockedNode) continue;
    if ((dockedNode as { selected?: boolean }).selected) continue;
    const { w, h } = dockedRenderedDims(view, rel.id, dockedNode.width, dockedNode.height);
    const pos = computeDockedCanvasPos(view, container, rel.hostNodeId, rel.socketKey, rel.side, w, h);
    if (pos) void view.moveNode(rel.id, pos);
  }
}

const DOCK_SNAP_CANVAS_PX = 34;

export function findDockTarget(
  view: View,
  editor: NodeEditor<Schemes>,
  fc: FormatControllerNode,
): { hostNodeId: string; socketKey: string; side: "input" | "output" } | null {
  const fcIn  = getSocketScreenCenter(view, fc.id, "in",  "input");
  const fcOut = getSocketScreenCenter(view, fc.id, "out", "output");
  if (!fcIn && !fcOut) return null;
  const zoom = view.transform.k || 1;

  let best: { hostNodeId: string; socketKey: string; side: "input" | "output"; dist: number } | null = null;
  for (const host of editor.getNodes()) {
    if (host.id === fc.id || host instanceof FormatControllerNode) continue;
    const sides: Array<"input" | "output"> = ["input", "output"];
    for (const side of sides) {
      const ports = side === "input" ? host.inputs : host.outputs;
      for (const socketKey of Object.keys(ports)) {
        const fcPt = side === "output" ? fcIn : fcOut;
        if (!fcPt) continue;
        const hostPt = getSocketScreenCenter(view, host.id, socketKey, side);
        if (!hostPt) continue;
        const dist = Math.hypot(hostPt.x - fcPt.x, hostPt.y - fcPt.y) / zoom;
        if (dist <= DOCK_SNAP_CANVAS_PX && (!best || dist < best.dist)) {
          best = { hostNodeId: host.id, socketKey, side, dist };
        }
      }
    }
  }
  return best ? { hostNodeId: best.hostNodeId, socketKey: best.socketKey, side: best.side } : null;
}



export async function insertFcInline(editor: NodeEditor<Schemes>, fc: FormatControllerNode): Promise<void> {
  if (!fc.hostNodeId) return;
  const host = editor.getNode(fc.hostNodeId);
  if (!host) return;

  if (fc.side === "output") {
    const downstream = editor.getConnections().filter(
      (c) => c.source === fc.hostNodeId && c.sourceOutput === fc.socketKey && c.target !== fc.id,
    );
    for (const c of downstream) {
      const tgt = editor.getNode(c.target);
      if (!tgt) continue;
      const targetInput = c.targetInput;
      await editor.removeConnection(c.id);
      try {
        await editor.addConnection(new ClassicPreset.Connection(fc, "out", tgt, targetInput) as SolenoidConnection);
      } catch { /* incompatible — leave disconnected */ }
    }
    if (!editor.getConnections().some((c) => c.target === fc.id && c.targetInput === "in")) {
      try {
        await editor.addConnection(new ClassicPreset.Connection(host, fc.socketKey, fc, "in") as SolenoidConnection);
      } catch { /* incompatible — skip */ }
    }
  } else {
    const incoming = editor.getConnections().filter(
      (c) => c.target === fc.hostNodeId && c.targetInput === fc.socketKey && c.source !== fc.id,
    );
    if (incoming.length === 0) return;
    for (const c of incoming) {
      const src = editor.getNode(c.source);
      if (!src) continue;
      const sourceOutput = c.sourceOutput;
      await editor.removeConnection(c.id);
      try {
        await editor.addConnection(new ClassicPreset.Connection(src, sourceOutput, fc, "in") as SolenoidConnection);
      } catch { /* incompatible — leave disconnected */ }
    }
    if (!editor.getConnections().some((c) => c.source === fc.id && c.sourceOutput === "out" && c.target === fc.hostNodeId)) {
      try {
        await editor.addConnection(new ClassicPreset.Connection(fc, "out", host, fc.socketKey) as SolenoidConnection);
      } catch { /* incompatible — skip */ }
    }
  }
}

// Call before undock() or any change to fc.hostNodeId: it reads hostNodeId, socketKey and side.
export async function removeFcInline(editor: NodeEditor<Schemes>, fc: FormatControllerNode): Promise<void> {
  const host = fc.hostNodeId ? editor.getNode(fc.hostNodeId) : undefined;
  const hostKey = fc.socketKey;
  const hostSocket = fc.side === "output" ? host?.outputs[hostKey] : host?.inputs[hostKey];

  if (!host || !hostSocket) {
    const inConn = editor.getConnections().find((c) => c.target === fc.id && c.targetInput === "in");
    const src = inConn ? editor.getNode(inConn.source) : undefined;
    for (const c of editor.getConnections().filter((c) => c.source === fc.id && c.sourceOutput === "out")) {
      const tgt = editor.getNode(c.target);
      const targetInput = c.targetInput;
      await editor.removeConnection(c.id);
      if (src && tgt && inConn) {
        try { await editor.addConnection(new ClassicPreset.Connection(src, inConn.sourceOutput, tgt, targetInput) as SolenoidConnection); } catch { /* incompatible — leave disconnected */ }
      }
    }
    if (inConn) { try { await editor.removeConnection(inConn.id); } catch { /* already gone */ } }
    return;
  }

  if (fc.side === "output") {
    for (const c of editor.getConnections().filter((c) => c.source === fc.id && c.sourceOutput === "out")) {
      const tgt = editor.getNode(c.target);
      const targetInput = c.targetInput;
      await editor.removeConnection(c.id);
      if (tgt) {
        try { await editor.addConnection(new ClassicPreset.Connection(host, hostKey, tgt, targetInput) as SolenoidConnection); } catch { /* ignore */ }
      }
    }
    for (const c of editor.getConnections()) {
      if (c.target === fc.id && c.targetInput === "in") { try { await editor.removeConnection(c.id); } catch { /* ignore */ } }
    }
  } else {
    for (const c of editor.getConnections().filter((c) => c.target === fc.id && c.targetInput === "in")) {
      const src = editor.getNode(c.source);
      const sourceOutput = c.sourceOutput;
      await editor.removeConnection(c.id);
      if (src) {
        try { await editor.addConnection(new ClassicPreset.Connection(src, sourceOutput, host, hostKey) as SolenoidConnection); } catch { /* ignore */ }
      }
    }
    for (const c of editor.getConnections()) {
      if (c.source === fc.id && c.sourceOutput === "out") { try { await editor.removeConnection(c.id); } catch { /* ignore */ } }
    }
  }
}
