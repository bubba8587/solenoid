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
  CONDUIT_MAX_LANES, conduitInKey, conduitOutKey, conduitGhostSpecs,
} from "./rete-nodes";
import { ribbonForConnection } from "./ribbonCable";
import { forgetNode } from "./nodeStoreRegistry";
import { rebuildGroupMembership } from "./groupMembership";
import { restoreSettledPushes } from "./groupPush";
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
import { measuredBox } from "./nodeSize";
import { scheduleAutosave } from "./persistence";
import {
  processGraph, beginGraphRebuild, endGraphRebuild, bulkSettle,
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
        const b = measuredBox(area, n.id, editor);
        if (!b) continue;
        const { w, h } = b;
        const p = { x: b.x, y: b.y };
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
  // measuredBox: the same size read the standoff SOLVER uses (Canvas
  // standoffBoxes), so the band created here matches the boxes it constrains.
  const boxOf = (id: string): StandoffBox | null => measuredBox(area, id, editor);
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

// Remove the selected cables and/or the selected nodes (a lasso can select
// both at once). Shared by the Delete/Backspace key path and the mobile
// delete control. Node deletion splices a ghost cable when a node has
// exactly one in + one out.
export async function deleteSelection(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra> | null,
): Promise<void> {
  // A selected standoff is its own deletion target (exclusive selection).
  const standoffSel = standoffStore.selected();
  if (standoffSel) {
    standoffStore.remove(standoffSel);
    scheduleAutosave();
    return;
  }

  const selectedCableIds = cableSelectionStore.ids();
  const selected = editor.getNodes().filter((n) => n.selected);
  // Gate the WHOLE removal (selected cables + nodes): each removeConnection fires
  // `connectionremoved` (FC reconcile + mismatch rescan + a FULL processGraph +
  // collapse re-sync) and each removeNode fires `noderemoved` (rebuildGroupMembership
  // + syncGroupCollapse + restoreSettledPushes + forgetNode) — run per item that's
  // O((nodes+cables) × nodes), i.e. a bulk delete hangs the tab. Suppress the
  // per-event sweeps and do the equivalents ONCE below. (dropFromGroups +
  // standoffStore cleanup still run per noderemoved — they're cheap, outside the gate.)
  const deletedIds: string[] = [];
  let deletedGroup = false;
  beginGraphRebuild();
  try {
    if (selectedCableIds.length > 0) {
      cableSelectionStore.clear();
      // A Ribbon (bundled Conduit cable) is one entity: any selected lane
      // takes every lane with it.
      const doomed = new Set<string>();
      for (const id of selectedCableIds) {
        const conn = editor.getConnections().find((c) => c.id === id);
        if (!conn) continue;
        const ribbon = ribbonForConnection(editor, conn);
        if (ribbon) for (const m of ribbon.members) doomed.add(m.id);
        else doomed.add(id);
      }
      for (const id of doomed) {
        cableGhostStore.commit(id);
        try { await editor.removeConnection(id); } catch { /* already gone */ }
      }
    }

    for (const node of selected) {
      deletedIds.push(node.id);
      if (node instanceof GroupNode) deletedGroup = true;
      const incoming = editor.getConnections().filter((c) => c.target === node.id);
      const outgoing = editor.getConnections().filter((c) => c.source === node.id);

      // Conduit: splice PER LANE. The generic 1-in/1-out splice below can't see a
      // multi-lane bundle, so without this a deleted Conduit drops every cable
      // with no ghost. `conduitGhostSpecs` pairs in_i→out_i and yields the
      // unambiguous per-lane rewires (skipping missing ends, self-loops, dups);
      // we drop the Conduit + its cables, then add a ghost per spec. (Also covers
      // a 1-lane Conduit, so it goes through here, not the generic path below.)
      if (node instanceof ConduitNode) {
        const specs = conduitGhostSpecs(incoming, outgoing, editor.getConnections());
        for (const conn of [...incoming, ...outgoing]) await editor.removeConnection(conn.id);
        await editor.removeNode(node.id);
        for (const s of specs) {
          const src = editor.getNode(s.source);
          const dst = editor.getNode(s.target);
          if (!src || !dst) continue;
          const ghost = new ClassicPreset.Connection(src, s.sourceOutput, dst, s.targetInput) as SolenoidConnection;
          await editor.addConnection(ghost);
          cableGhostStore.mark(ghost.id);
        }
        continue;
      }

      // Splice case: 1 in + 1 out → leave a ghost cable from the upstream
      // source to the downstream target. Click the ghost to adopt it.
      const canSplice =
        incoming.length === 1 &&
        outgoing.length === 1 &&
        incoming[0].source !== outgoing[0].target &&
        !editor.getConnections().some(
          (c) =>
            c.source === incoming[0].source &&
            c.sourceOutput === incoming[0].sourceOutput &&
            c.target === outgoing[0].target &&
            c.targetInput === outgoing[0].targetInput,
        );

      if (canSplice) {
        const src = editor.getNode(incoming[0].source);
        const dst = editor.getNode(outgoing[0].target);
        if (src && dst) {
          await editor.removeConnection(incoming[0].id);
          await editor.removeConnection(outgoing[0].id);
          await editor.removeNode(node.id);
          const ghost = new ClassicPreset.Connection(
            src,
            incoming[0].sourceOutput,
            dst,
            outgoing[0].targetInput,
          ) as SolenoidConnection;
          await editor.addConnection(ghost);
          cableGhostStore.mark(ghost.id);
          continue;
        }
      }

      for (const conn of [...incoming, ...outgoing]) {
        await editor.removeConnection(conn.id);
      }
      await editor.removeNode(node.id);
    }
  } finally {
    endGraphRebuild();
  }

  // The per-event settles were suppressed above — run the equivalents ONCE, in the
  // same order noderemoved/connectionremoved would: forget store state, rebuild
  // membership, the FC/mismatch/recompute/collapse pass (bulkSettle), then restore
  // any pushes a deleted expanded group was holding open.
  if (deletedIds.length || selectedCableIds.length) {
    for (const id of deletedIds) forgetNode(id);
    if (deletedIds.length) rebuildGroupMembership(editor);
    await bulkSettle();
    if (deletedGroup && area) restoreSettledPushes(editor, area);
  } else {
    await processGraph();
  }
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
