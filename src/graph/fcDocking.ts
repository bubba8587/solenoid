// Format Controller docking — snap detection, dock positioning, and the inline
// splice/unsplice into the host's data path; all pure over (editor, area, container, fc).
import type { Surface } from "./surface";
import { ClassicPreset, type NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { FormatControllerNode } from "./rete-nodes";
import { getSocketScreenCenter, screenToCanvas } from "./canvasGeometry";

type SolenoidConnection = import("./schemes").SolenoidConnection;

export function computeDockedCanvasPos(
  area: Surface,
  container: HTMLElement,
  hostNodeId: string,
  socketKey: string,
  side: "input" | "output",
  dockedWidth: number,
  dockedHeight: number,
): { x: number; y: number } | null {
  // Anchor on the host's MODEL position plus the socket's offset inside the host wrapper:
  // both rects come from the same DOM frame, so the offset holds even when the wrapper
  // has not been re-committed at the host's new position yet (the post-Tidy snap runs a
  // frame after the translates; reading the socket's screen point there placed the FC
  // relative to the host's OLD spot). Screen conversion stays as the fallback.
  const view = area.nodeViews.get(hostNodeId);
  const sockEl = view?.element.querySelector<HTMLElement>(`[data-socket-key="${socketKey}"][data-socket-side="${side}"]`);
  let cx: number, cy: number;
  if (view && sockEl) {
    const k = area.area.transform.k || 1;
    const host = view.element.getBoundingClientRect();
    const r = sockEl.getBoundingClientRect();
    cx = view.position.x + (r.left + r.width / 2 - host.left) / k;
    cy = view.position.y + (r.top + r.height / 2 - host.top) / k;
  } else {
    const sc = getSocketScreenCenter(area, hostNodeId, socketKey, side);
    if (!sc) return null;
    ({ x: cx, y: cy } = screenToCanvas(area, container, sc.x, sc.y));
  }
  // Host INPUT  → FC output (right edge) meets it → FC goes LEFT.
  // Host OUTPUT → FC input  (left edge) meets it → FC goes RIGHT.
  // ROUND to whole canvas px — a fractional dock edge (the screen round-trip lands on
  // sub-pixels) shifts on every re-dock and group autofit chases it, so the group creeps.
  return {
    x: Math.round(side === "input" ? cx - dockedWidth : cx),
    y: Math.round(cy - dockedHeight / 2),
  };
}

// Measured size, not the node's stored estimate — the dock math centers the FC on the
// host socket by height, so a stale estimate drops it several px low.
export function dockedRenderedDims(
  area: Surface,
  nodeId: string,
  fallbackW: number,
  fallbackH: number,
): { w: number; h: number } {
  const el = area.nodeViews.get(nodeId)?.element;
  return { w: el?.offsetWidth || fallbackW, h: el?.offsetHeight || fallbackH };
}

// Snap radius in CANVAS units (screen ÷ zoom) — comparing raw SCREEN px would let a
// zoomed-out canvas snap to hosts a huge canvas distance away.
const DOCK_SNAP_CANVAS_PX = 34;

// The nearest host socket whose pairing edge (host output ↔ FC input, host input ↔ FC
// output) is within snap range; null if nothing is close enough.
export function findDockTarget(
  area: Surface,
  editor: NodeEditor<Schemes>,
  fc: FormatControllerNode,
): { hostNodeId: string; socketKey: string; side: "input" | "output" } | null {
  const fcIn  = getSocketScreenCenter(area, fc.id, "in",  "input");
  const fcOut = getSocketScreenCenter(area, fc.id, "out", "output");
  if (!fcIn && !fcOut) return null;
  const zoom = area.area.transform.k || 1;

  let best: { hostNodeId: string; socketKey: string; side: "input" | "output"; dist: number } | null = null;
  for (const host of editor.getNodes()) {
    if (host.id === fc.id || host instanceof FormatControllerNode) continue;
    const sides: Array<"input" | "output"> = ["input", "output"];
    for (const side of sides) {
      const ports = side === "input" ? host.inputs : host.outputs;
      for (const socketKey of Object.keys(ports)) {
        // Pair host output with the FC's input edge, host input with its output edge.
        const fcPt = side === "output" ? fcIn : fcOut;
        if (!fcPt) continue;
        const hostPt = getSocketScreenCenter(area, host.id, socketKey, side);
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


// Splices the FC into the data path (host consumers repull from the FC). Values are
// unchanged — the FC formats display only — but cables now originate at the FC.

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
    // On a host INPUT, splice only when a cable feeds it — an unwired input has nothing
    // to route, so the FC just annotates the host's display.
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

// Reverse of insertFcInline. Call BEFORE undock() or any change to fc.hostNodeId —
// it reads fc.hostNodeId / fc.socketKey / fc.side.
export async function removeFcInline(editor: NodeEditor<Schemes>, fc: FormatControllerNode): Promise<void> {
  const host = fc.hostNodeId ? editor.getNode(fc.hostNodeId) : undefined;
  const hostKey = fc.socketKey;

  if (!host) {
    // A WIRED but undocked FC has no host socket to reconnect through, so bridge FC.in's
    // source to FC.out's consumers — the host-gated paths below would DELETE that cable.
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
    // FC.out consumers → back to host output; drop host → FC.in.
    for (const c of editor.getConnections().filter((c) => c.source === fc.id && c.sourceOutput === "out")) {
      const tgt = editor.getNode(c.target);
      const targetInput = c.targetInput;
      await editor.removeConnection(c.id);
      if (host && tgt) {
        try { await editor.addConnection(new ClassicPreset.Connection(host, hostKey, tgt, targetInput) as SolenoidConnection); } catch { /* ignore */ }
      }
    }
    for (const c of editor.getConnections()) {
      if (c.target === fc.id && c.targetInput === "in") { try { await editor.removeConnection(c.id); } catch { /* ignore */ } }
    }
  } else {
    // FC.in source → back to host input; drop FC.out → host input.
    for (const c of editor.getConnections().filter((c) => c.target === fc.id && c.targetInput === "in")) {
      const src = editor.getNode(c.source);
      const sourceOutput = c.sourceOutput;
      await editor.removeConnection(c.id);
      if (host && src) {
        try { await editor.addConnection(new ClassicPreset.Connection(src, sourceOutput, host, hostKey) as SolenoidConnection); } catch { /* ignore */ }
      }
    }
    for (const c of editor.getConnections()) {
      if (c.source === fc.id && c.sourceOutput === "out") { try { await editor.removeConnection(c.id); } catch { /* ignore */ } }
    }
  }
}
