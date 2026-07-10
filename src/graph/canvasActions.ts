// Context-menu actions on canvas entities (extracted from Canvas.tsx):
// splice Conduits into cables, link a Standoff, delete cables, attach a
// Format Controller. All pure over (editor, area, container, target).
import { ClassicPreset, type NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra, SolenoidNode } from "./schemes";
import type { SocketContextTarget, CableContextTarget } from "./components";
import type { Pt } from "./lasso";
import {
  ConduitNode, FormatControllerNode, GroupNode,
  CONDUIT_MAX_LANES, conduitInKey, conduitOutKey,
} from "./rete-nodes";
import { CONDUIT_PIVOT } from "./ribbonCable";
import { groupCollapseStore, COLLAPSE_LAYOUT, pillY } from "./groupCollapse";
import { getSocketScreenCenter, screenToCanvas } from "./canvasGeometry";
import { computeDockedCanvasPos, insertFcInline } from "./fcDocking";
import { dockedNodeStore } from "./dockedNodeStore";
import { cableSelectionStore, cableGhostStore } from "./cableState";
import {
  standoffStore, settleStandoffs, anchorPoint, anchorFromVector,
  OPPOSITE_ANCHOR, ANCHOR_DIR, type Box as StandoffBox,
} from "./standoffs";
import { PUSH_GAP } from "./groupPushCore";
import { scheduleAutosave } from "./persistence";
import {
  processGraph,
  unselectAllNodes as unselectAllNodesFromProcess,
  selectNode as selectNodeFromProcess,
} from "./process";

type SolenoidConnection = import("./schemes").SolenoidConnection;

// Splice a Conduit into every cable of the selection: source → in_i and
// out_i → target, lane-ordered top-to-bottom by each cable's midpoint. One
// Conduit takes up to CONDUIT_MAX_LANES cables; a bigger selection gets
// chunked into several. Each Conduit lands at its cables' midpoint centroid,
// rotated (45°-snapped) to the mean flow direction.
export async function insertConduitForCables(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  target: CableContextTarget,
): Promise<void> {
  // Where the cable's endpoint actually is, in canvas coords. A socket on a
  // collapsed group's hidden member still MEASURES at its expanded position
  // (members hide via visibility, so their rects stay live) — but its cable
  // is drawn to the group-edge pill, so use the pill point, exactly like
  // ConnectionComponent does. Then the live socket rect; then the node
  // position as a last resort.
  const socketCanvasPoint = (nodeId: string, key: string, side: "input" | "output") => {
    const pill = side === "output"
      ? groupCollapseStore.outPillFor(nodeId, key)
      : groupCollapseStore.inPillFor(nodeId, key);
    if (pill) {
      const g = area.nodeViews.get(pill.groupId)?.position;
      if (g) {
        return {
          x: pill.side === "left" ? g.x : g.x + COLLAPSE_LAYOUT.width,
          y: g.y + pillY(pill.index),
        };
      }
    }
    const sc = getSocketScreenCenter(area, nodeId, key, side);
    if (sc && (sc.x !== 0 || sc.y !== 0)) return screenToCanvas(area, container, sc.x, sc.y);
    const np = area.nodeViews.get(nodeId)?.position;
    if (!np) return null;
    const node = editor.getNode(nodeId);
    return {
      x: np.x + (side === "output" ? node?.width ?? 100 : 0),
      y: np.y + (node?.height ?? 60) / 2,
    };
  };

  // One LANE per unique source socket, not per cable: a value fanning out to
  // several targets (B→B1, B→B2) rides the Conduit once — B→in_i, and the
  // fan-out moves to the Conduit's output (out_i→B1, out_i→B2).
  type Lane = { conns: SolenoidConnection[]; mid: Pt; dir: Pt };
  const laneBySource = new Map<string, { conns: SolenoidConnection[]; mids: Pt[]; dirs: Pt[] }>();
  for (const id of target.connIds) {
    const conn = editor.getConnections().find((c) => c.id === id);
    if (!conn) continue;
    const s = socketCanvasPoint(conn.source, conn.sourceOutput, "output");
    const t = socketCanvasPoint(conn.target, conn.targetInput, "input");
    if (!s || !t) continue;
    const key = `${conn.source}::${conn.sourceOutput}`;
    const lane = laneBySource.get(key) ?? { conns: [], mids: [], dirs: [] };
    lane.conns.push(conn);
    lane.mids.push({ x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 });
    lane.dirs.push({ x: t.x - s.x, y: t.y - s.y });
    laneBySource.set(key, lane);
  }
  const lanes: Lane[] = [...laneBySource.values()].map((l) => ({
    conns: l.conns,
    mid: {
      x: l.mids.reduce((s2, p) => s2 + p.x, 0) / l.mids.length,
      y: l.mids.reduce((s2, p) => s2 + p.y, 0) / l.mids.length,
    },
    dir: {
      x: l.dirs.reduce((s2, p) => s2 + p.x, 0) / l.dirs.length,
      y: l.dirs.reduce((s2, p) => s2 + p.y, 0) / l.dirs.length,
    },
  }));
  if (lanes.length === 0) return;
  // Lane 0 is the Conduit's top row — order lanes by visual position so the
  // spliced cables don't cross.
  lanes.sort((a, b) => a.mid.y - b.mid.y || a.mid.x - b.mid.x);

  cableSelectionStore.clear();
  unselectAllNodesFromProcess();
  const created: string[] = [];
  for (let base = 0; base < lanes.length; base += CONDUIT_MAX_LANES) {
    const chunk = lanes.slice(base, base + CONDUIT_MAX_LANES);
    const cx = chunk.reduce((s2, it) => s2 + it.mid.x, 0) / chunk.length;
    let cy = chunk.reduce((s2, it) => s2 + it.mid.y, 0) / chunk.length;
    const dx = chunk.reduce((s2, it) => s2 + it.dir.x, 0);
    const dy = chunk.reduce((s2, it) => s2 + it.dir.y, 0);
    const angle = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) / 45) * 45;
    // Don't bury the new Conduit under an existing node: it renders at
    // z-index -1 (behind nodes), so a centroid that lands on a node body
    // would leave it invisible and unclickable. Nudge it below any covering
    // node. EXPANDED groups are background boxes (fine to sit inside);
    // COLLAPSED groups render an opaque summary card, so they're obstacles.
    // Members hidden inside a collapsed group hide via visibility (their
    // boxes still measure) — they're not really there, skip them.
    for (let pass = 0; pass < 4; pass++) {
      let bumped = false;
      for (const n of editor.getNodes()) {
        if (n instanceof GroupNode && !n.collapsed) continue;
        if (groupCollapseStore.isNodeHidden(n.id)) continue;
        const view = area.nodeViews.get(n.id);
        if (!view) continue;
        const w = view.element.offsetWidth || n.width || 0;
        const h = view.element.offsetHeight || n.height || 0;
        if (w === 0 || h === 0) continue;
        const p = view.position;
        if (
          cx + CONDUIT_PIVOT > p.x && cx - CONDUIT_PIVOT < p.x + w &&
          cy + CONDUIT_PIVOT > p.y && cy - CONDUIT_PIVOT < p.y + h
        ) {
          cy = p.y + h + CONDUIT_PIVOT + 16;
          bumped = true;
        }
      }
      if (!bumped) break;
    }
    const conduit = new ConduitNode({ angle }) as unknown as SolenoidNode;
    await editor.addNode(conduit);
    await area.translate(conduit.id, { x: cx - CONDUIT_PIVOT, y: cy - CONDUIT_PIVOT });
    for (let i = 0; i < chunk.length; i++) {
      const lane = chunk[i];
      const src = editor.getNode(lane.conns[0].source);
      if (!src) continue;
      for (const conn of lane.conns) {
        try { await editor.removeConnection(conn.id); } catch { /* already gone */ }
      }
      try {
        await editor.addConnection(
          new ClassicPreset.Connection(src, lane.conns[0].sourceOutput, conduit, conduitInKey(i)) as SolenoidConnection,
        );
      } catch { /* incompatible — leave disconnected */ }
      for (const conn of lane.conns) {
        const tgt = editor.getNode(conn.target);
        if (!tgt) continue;
        try {
          await editor.addConnection(
            new ClassicPreset.Connection(conduit, conduitOutKey(i), tgt, conn.targetInput) as SolenoidConnection,
          );
        } catch { /* incompatible — leave disconnected */ }
      }
    }
    created.push(conduit.id);
  }
  // Select the new Conduit(s) — feedback, and the expanded block shows its lanes.
  created.forEach((id, i) => selectNodeFromProcess(id, i > 0));
  await processGraph();
}

// Create a Standoff between the two selected items: anchors face each other
// along the dominant direction (one of 8 — sides for cardinal, corners for
// diagonal), the band defaults to [gap, current distance] — "never closer
// than a gap, never farther than where I placed it".
export function linkStandoffBetween(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  t: { aId: string; bId: string },
): void {
  const boxOf = (id: string): StandoffBox | null => {
    const view = area.nodeViews.get(id);
    const node = editor.getNode(id) as { width?: number; height?: number } | undefined;
    if (!view || !node) return null;
    return {
      x: view.position.x,
      y: view.position.y,
      w: view.element.offsetWidth || node.width || 100,
      h: view.element.offsetHeight || node.height || 50,
    };
  };
  const ba = boxOf(t.aId);
  const bb = boxOf(t.bId);
  if (!ba || !bb) return;
  const anchor = anchorFromVector(
    bb.x + bb.w / 2 - (ba.x + ba.w / 2),
    bb.y + bb.h / 2 - (ba.y + ba.h / 2),
  );
  const opposite = OPPOSITE_ANCHOR[anchor];
  const pa = anchorPoint(ba, anchor);
  const pb = anchorPoint(bb, opposite);
  const axis = ANCHOR_DIR[anchor];
  const dist = Math.max(0, (pb.x - pa.x) * axis.x + (pb.y - pa.y) * axis.y);
  const min = Math.min(PUSH_GAP, dist);
  const s = standoffStore.add(
    { nodeId: t.aId, anchor },
    { nodeId: t.bId, anchor: opposite },
    min,
    Math.max(dist, min),
    true, // new standoffs lock to 45° by default; the toolbar can unlock
  );
  standoffStore.select(s.id);
  unselectAllNodesFromProcess();
  cableSelectionStore.set(null);
  settleStandoffs(); // apply the rigid 45° alignment right away
  scheduleAutosave();
}

export async function deleteCables(
  editor: NodeEditor<Schemes>,
  target: CableContextTarget,
): Promise<void> {
  cableSelectionStore.clear();
  for (const id of target.connIds) {
    cableGhostStore.commit(id);
    try { await editor.removeConnection(id); } catch { /* already gone */ }
  }
  await processGraph();
}

export async function attachFormatController(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  target: SocketContextTarget,
): Promise<void> {
  const fc = new FormatControllerNode({
    hostNodeId: target.nodeId,
    socketKey:  target.socketKey,
    side:       target.side,
  });
  await editor.addNode(fc as SolenoidNode);
  // dockSelf() was called by the nodecreated pipe — now position it.
  const rel = dockedNodeStore.get(fc.id);
  if (rel) {
    const pos = computeDockedCanvasPos(area, container, rel.hostNodeId, rel.socketKey, rel.side, fc.width, fc.height);
    if (pos) await area.translate(fc.id, pos);
  }
  // Insert it into the data path so the original value flows through it.
  await insertFcInline(editor, fc);
  await processGraph();
}
