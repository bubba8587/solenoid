// Format Controller docking: snap-target detection, dock positioning, and the
// inline splice/unsplice of a docked FC into the host's data path. Everything
// here is pure over (editor, area, container, fc).
import { ClassicPreset, type NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import { FormatControllerNode } from "./rete-nodes";
import { getSocketScreenCenter, screenToCanvas } from "./canvasGeometry";

type SolenoidConnection = import("./schemes").SolenoidConnection;

export function computeDockedCanvasPos(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  hostNodeId: string,
  socketKey: string,
  side: "input" | "output",
  dockedWidth: number,
  dockedHeight: number,
): { x: number; y: number } | null {
  const sc = getSocketScreenCenter(area, hostNodeId, socketKey, side);
  if (!sc) return null;
  const { x: cx, y: cy } = screenToCanvas(area, container, sc.x, sc.y);
  // Align the Transformer's connecting socket flush with the host socket.
  // Host INPUT  → Transformer output (right edge) should meet it → Transformer goes LEFT.
  // Host OUTPUT → Transformer input  (left edge) should meet it → Transformer goes RIGHT.
  //
  // ROUND to whole canvas px: `cx`/`cy` come from a screen round-trip
  // (getBoundingClientRect → screenToCanvas ÷ zoom), so they land on sub-pixels.
  // A fractional, host-position-derived dock edge shifts on every re-dock, and
  // group autofit then chases it — the group creeps.
  return {
    x: Math.round(side === "input" ? cx - dockedWidth : cx),
    y: Math.round(cy - dockedHeight / 2),
  };
}

// The docked node's real rendered size in canvas units (its DOM element's
// unscaled offset box), falling back to the node's stored estimate before it
// has painted. The dock math centers the FC on the host socket using its
// height, so a stale estimate drops it several px low.
export function dockedRenderedDims(
  area: AreaPlugin<Schemes, AreaExtra>,
  nodeId: string,
  fallbackW: number,
  fallbackH: number,
): { w: number; h: number } {
  const el = area.nodeViews.get(nodeId)?.element;
  return { w: el?.offsetWidth || fallbackW, h: el?.offsetHeight || fallbackH };
}

// How close the FC's edge socket must be to a host socket to snap-dock — in
// CANVAS units (screen distance ÷ zoom). Comparing raw SCREEN px lets a
// zoomed-out canvas snap an FC to hosts a huge canvas distance away. At zoom 1
// this equals 34 screen px.
const DOCK_SNAP_CANVAS_PX = 34;

// On drop, find the host socket the FC should dock to: the nearest one whose
// pairing edge (host output ↔ FC input, host input ↔ FC output) is within snap
// range of the FC's matching socket. Returns null if nothing is close enough.
export function findDockTarget(
  area: AreaPlugin<Schemes, AreaExtra>,
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


// An FC docked to a host OUTPUT is inserted into the data path: the host's
// existing consumers are rerouted to pull from the FC, and the host output is
// fed into the FC. The FC passes the original value through unchanged (display-
// only formatting), so downstream values are identical — but the host's display
// formats, and cables now originate from the FC's output.

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
    // Docked on a host INPUT: only splice when a cable actually feeds the input
    // (a literal/unwired input has nothing to route; the FC then just annotates
    // the host's display).
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

// Reverse of insertFcInline (on re-home / un-splice): reconnect the original
// path around the FC. Call BEFORE undock() / before changing fc.hostNodeId
// (it reads fc.hostNodeId / fc.socketKey / fc.side).
export async function removeFcInline(editor: NodeEditor<Schemes>, fc: FormatControllerNode): Promise<void> {
  const host = fc.hostNodeId ? editor.getNode(fc.hostNodeId) : undefined;
  const hostKey = fc.socketKey;

  if (!host) {
    // A WIRED but undocked FC (hand-wired inline, now being drag-docked onto a
    // host): there is no host socket to reconnect through, so bridge whatever
    // feeds FC.in straight to FC.out's consumers, then drop the FC's own
    // cables — the host-gated reconnects below would otherwise DELETE the
    // downstream cable.
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
