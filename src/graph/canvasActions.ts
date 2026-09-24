// [[C10]] socketLattice, [[C89]] standoffsSolveLast
import type { View } from "./view";
import { ClassicPreset, type NodeEditor } from "rete";
import type { Schemes, SolenoidNode } from "./schemes";
import type { SocketContextTarget, CableContextTarget } from "./components";
import type { Pt } from "./lasso";
import {
  ConduitNode, FormatControllerNode, GroupNode,
  CONDUIT_MAX_LANES, conduitInKey, conduitOutKey, conduitGhostSpecs,
} from "./rete-nodes";
import { ribbonForConnection } from "./ribbonCable";
import { forgetNodeDeep } from "./nodeStoreRegistry";
import { rebuildGroupMembership } from "./groupMembership";
import { restoreSettledPushes } from "./groupPush";
import { CONDUIT_PIVOT } from "./ribbonCable";
import { groupCollapseStore, syncGroupCollapse, COLLAPSE_LAYOUT, pillY } from "./groupCollapse";
import { getSocketScreenCenter, screenToCanvas } from "./canvasGeometry";
import { computeDockedCanvasPos, insertFcInline, removeFcInline } from "./fcDocking";
import { cableSelectionStore, cableGhostStore } from "./cableState";
import { dockedNodeStore } from "./dockedNodeStore";
import {
  standoffStore, settleStandoffs, anchorPoint, anchorFromVector,
  OPPOSITE_ANCHOR, ANCHOR_DIR, type Box as StandoffBox,
} from "./standoffs";
import { drawnCableStore, commitDrawn } from "./drawnCables";
import { PUSH_GAP } from "./groupPushCore";
import { measuredBox } from "./nodeSize";
import { scheduleAutosave } from "./persistence";
import { processGraph } from "./process";
import { MAIN_EDIT_SCOPE, type EditScope } from "./activeGraph";
import { unselectAllNodes as unselectAllNodesFromProcess, selectNode as selectNodeFromProcess } from "./canvasCommands";
type SolenoidConnection = import("./schemes").SolenoidConnection;

export async function insertConduitForCables(
  editor: NodeEditor<Schemes>,
  view: View,
  container: HTMLElement,
  target: CableContextTarget,
): Promise<void> {
  const socketCanvasPoint = (nodeId: string, key: string, side: "input" | "output") => {
    const pill = side === "output"
      ? groupCollapseStore.outPillFor(nodeId, key)
      : groupCollapseStore.inPillFor(nodeId, key);
    if (pill) {
      const g = view.position(pill.groupId);
      if (g) {
        return {
          x: pill.side === "left" ? g.x : g.x + COLLAPSE_LAYOUT.width,
          y: g.y + pillY(pill.index),
        };
      }
    }
    const sc = getSocketScreenCenter(view, nodeId, key, side);
    if (sc && (sc.x !== 0 || sc.y !== 0)) return screenToCanvas(view, container, sc.x, sc.y);
    const np = view.position(nodeId);
    if (!np) return null;
    const node = editor.getNode(nodeId);
    return {
      x: np.x + (side === "output" ? node?.width ?? 100 : 0),
      y: np.y + (node?.height ?? 60) / 2,
    };
  };

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
    for (let pass = 0; pass < 4; pass++) {
      let bumped = false;
      for (const n of editor.getNodes()) {
        if (n instanceof GroupNode && !n.collapsed) continue;
        if (groupCollapseStore.isNodeHidden(n.id)) continue;
        const b = measuredBox(view, n.id, editor);
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
    await view.moveNode(conduit.id, { x: cx - CONDUIT_PIVOT, y: cy - CONDUIT_PIVOT });
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
  created.forEach((id, i) => selectNodeFromProcess(id, i > 0));
  await processGraph();
}

export function linkStandoffBetween(
  editor: NodeEditor<Schemes>,
  view: View,
  t: { aId: string; bId: string },
): void {
  for (const n of editor.getNodes()) {
    if (n instanceof GroupNode && (n.members.includes(t.aId) || n.members.includes(t.bId))) return;
  }
  const boxOf = (id: string): StandoffBox | null => measuredBox(view, id, editor);
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
    true,
  );
  standoffStore.select(s.id);
  unselectAllNodesFromProcess();
  cableSelectionStore.set(null);
  drawnCableStore.select(null);
  settleStandoffs();
  scheduleAutosave();
}

/**
 * Every surface's `noderemoved` settle ([[B10]] reactFlowView). Under a rebuild gate a removal may be a
 * relocation (Wrap as Composite keeps the node and its stores), so the gated edit forgets what it really deleted.
 */
export function settleNodeRemoved(editor: NodeEditor<Schemes>, view: View, node: SolenoidNode, gated: boolean): void {
  if (gated) return;
  forgetNodeDeep(node);
  rebuildGroupMembership(editor);
  syncGroupCollapse(editor, view);
  if (node instanceof GroupNode) restoreSettledPushes(editor, view);
}

/** What differs between the surfaces that share the delete verb ([[C43]] oneFlowSurface). */
export type DeleteScope = EditScope & {
  /** Drawn cables and standoffs exist on the main canvas alone. */
  mainLayers: boolean;
  /** Nodes Delete never removes (a drill-in's boundary markers, which are its ports). */
  keeps?: (n: SolenoidNode) => boolean;
};

export const MAIN_DELETE_SCOPE: DeleteScope = { ...MAIN_EDIT_SCOPE, mainLayers: true };

const dockedFc = (n: SolenoidNode): n is FormatControllerNode & SolenoidNode =>
  n instanceof FormatControllerNode && !!n.hostNodeId;

/** The selection plus every FC docked to a doomed node, at any depth: a docked FC is part of its host's entity. */
export function deleteSet(editor: NodeEditor<Schemes>): Set<string> {
  const ids = new Set(editor.getNodes().filter((n) => n.selected).map((n) => n.id));
  for (const id of ids) for (const d of dockedNodeStore.getDockedTo(id)) if (editor.getNode(d.id)) ids.add(d.id);
  return ids;
}

export async function deleteSelection(
  editor: NodeEditor<Schemes>,
  view: View | null,
  scope: DeleteScope = MAIN_DELETE_SCOPE,
): Promise<void> {
  if (scope.mainLayers) {
    const drawnSel = drawnCableStore.selected();
    if (drawnSel) {
      drawnCableStore.remove(drawnSel);
      commitDrawn();
      return;
    }

    const standoffSel = standoffStore.selected();
    if (standoffSel) {
      standoffStore.remove(standoffSel);
      scheduleAutosave();
      return;
    }
  }

  const doomedIds = deleteSet(editor);
  const selectedCableIds = cableSelectionStore.ids();
  // A docked FC goes before its host, so its unsplice sees the host's wiring intact.
  const selected = editor.getNodes()
    .filter((n) => doomedIds.has(n.id) && !scope.keeps?.(n))
    .sort((a, b) => Number(dockedFc(b)) - Number(dockedFc(a)));
  const deleted: SolenoidNode[] = [];
  let deletedGroup = false;
  scope.begin();
  try {
    if (selectedCableIds.length > 0) {
      cableSelectionStore.clear();
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
      deleted.push(node);
      if (node instanceof GroupNode) deletedGroup = true;

      if (dockedFc(node)) {
        await removeFcInline(editor, node);
        for (const c of editor.getConnections().filter((c) => c.source === node.id || c.target === node.id)) {
          await editor.removeConnection(c.id);
        }
        await editor.removeNode(node.id);
        continue;
      }

      const incoming = editor.getConnections().filter((c) => c.target === node.id);
      const outgoing = editor.getConnections().filter((c) => c.source === node.id);
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
    scope.end();
  }

  // The per-event settles were suppressed above; run their equivalents once, in the order noderemoved and connectionremoved would.
  for (const node of deleted) forgetNodeDeep(node);
  if (deleted.length) rebuildGroupMembership(editor);
  await scope.settle();
  if (deletedGroup && view) restoreSettledPushes(editor, view);
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

/** An FC never docks onto another FC, from the socket menu or a drag. */
export function canAttachFc(editor: NodeEditor<Schemes>, nodeId: string): boolean {
  const host = editor.getNode(nodeId);
  return !!host && !(host instanceof FormatControllerNode);
}

export async function attachFormatController(
  editor: NodeEditor<Schemes>,
  view: View,
  container: HTMLElement,
  target: SocketContextTarget,
): Promise<void> {
  if (!canAttachFc(editor, target.nodeId)) return;
  const fc = new FormatControllerNode({
    hostNodeId: target.nodeId,
    socketKey:  target.socketKey,
    side:       target.side,
  });
  await editor.addNode(fc as SolenoidNode);
  fc.dockSelf(editor); // needs the id addNode assigned; undocked, it lands at canvas (0,0)
  const pos = computeDockedCanvasPos(view, container, fc.hostNodeId, fc.socketKey, fc.side, fc.width, fc.height);
  if (pos) await view.moveNode(fc.id, pos);
  await insertFcInline(editor, fc);
  await processGraph();
}
