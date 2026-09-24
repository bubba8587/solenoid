// [[C10]] socketLattice
import { ConduitNode, conduitLaneOf } from "./rete-nodes";
import { groupCollapseStore } from "./groupCollapse";
import { cableGhostStore, cableSelectionStore } from "./cableState";

import { getOwningView } from "./activeGraph";

export const CONDUIT_BODY_SIZE = 92;
export const CONDUIT_PIVOT = CONDUIT_BODY_SIZE / 2;
export const CONDUIT_SQ = 10;
export const CONDUIT_COL_GAP = 1.5;
export const CONDUIT_ROW_GAP = 1.5;


export type ConduitLayout = { angle: number; scale: number; selected: boolean; lanes: number };

const _layouts = new Map<string, ConduitLayout>();
let _layoutVersion = 0;
const _layoutListeners = new Set<() => void>();
function notifyLayout() { _layoutVersion++; for (const l of _layoutListeners) l(); }

export const conduitLayoutStore = {
  set(nodeId: string, layout: ConduitLayout) {
    const cur = _layouts.get(nodeId);
    if (cur && cur.angle === layout.angle && cur.scale === layout.scale && cur.selected === layout.selected
        && cur.lanes === layout.lanes) return;
    _layouts.set(nodeId, layout);
    notifyLayout();
  },
  clear(nodeId: string) {
    if (!_layouts.delete(nodeId)) return;
    notifyLayout();
  },
  get: (nodeId: string) => _layouts.get(nodeId),
  version: () => _layoutVersion,
  subscribe(l: () => void) { _layoutListeners.add(l); return () => { _layoutListeners.delete(l); }; },
};

const columnHalf = (scale: number) => ((CONDUIT_SQ + CONDUIT_COL_GAP) * scale) / 2;

export function conduitFacePoint(
  nodeId: string,
  side: "in" | "out",
): { x: number; y: number; angle: number } | null {
  const lay = _layouts.get(nodeId);
  const pos = getOwningView(nodeId)?.position(nodeId);
  if (!lay || !pos) return null;
  const sign = side === "out" ? 1 : -1;
  const rad = (lay.angle * Math.PI) / 180;
  return {
    x: pos.x + CONDUIT_PIVOT + sign * columnHalf(lay.scale) * Math.cos(rad),
    y: pos.y + CONDUIT_PIVOT + sign * columnHalf(lay.scale) * Math.sin(rad),
    angle: lay.angle,
  };
}

export function conduitLaneOffset(
  lay: Pick<ConduitLayout, "angle" | "scale" | "lanes">,
  side: "in" | "out",
  laneIdx: number,
): { x: number; y: number } {
  const sq = CONDUIT_SQ * lay.scale;
  const lx = (side === "out" ? 1 : -1) * columnHalf(lay.scale);
  const ly = (laneIdx - (lay.lanes - 1) / 2) * (sq + CONDUIT_ROW_GAP * lay.scale);
  const rad = (lay.angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: lx * c - ly * s, y: lx * s + ly * c };
}

export function conduitLanePoint(
  nodeId: string,
  side: "in" | "out",
  socketKey: string,
): { x: number; y: number } | null {
  const lay = _layouts.get(nodeId);
  const pos = getOwningView(nodeId)?.position(nodeId);
  if (!lay || !pos) return null;
  const i = conduitLaneOf(socketKey, side);
  if (i < 0) return null;
  // A cable can land a frame before the component republishes its lane count.
  const off = conduitLaneOffset(lay, side, Math.min(i, lay.lanes - 1));
  return { x: pos.x + CONDUIT_PIVOT + off.x, y: pos.y + CONDUIT_PIVOT + off.y };
}


let _hoveredRibbon: string | null = null;
const _hoverListeners = new Set<() => void>();

export const ribbonHoverStore = {
  get: () => _hoveredRibbon,
  set(key: string | null) {
    if (_hoveredRibbon === key) return;
    _hoveredRibbon = key;
    for (const l of _hoverListeners) l();
  },
  subscribe(l: () => void) { _hoverListeners.add(l); return () => { _hoverListeners.delete(l); }; },
};

type Conn = {
  id: string;
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
};
type EditorLike = {
  getNode(id: string): unknown;
  getConnections(): Conn[];
};

export type RibbonCable = {
  key: string;
  kind: "conduit" | "group" | "groupSource";
  sourceId: string;
  targetId: string;
  destKind?: "conduit" | "group";
  members: Conn[];
  repId: string;
};

const laneIdx = (key: string) => Number(key.slice(key.indexOf("_") + 1));

function ribbonTargetOf(editor: EditorLike, c: Conn): { kind: "conduit" | "group"; id: string } | null {
  const pill = groupCollapseStore.inPillFor(c.target, c.targetInput);
  if (pill) return { kind: "group", id: pill.groupId };
  if (
    editor.getNode(c.target) instanceof ConduitNode &&
    c.targetInput.startsWith("in_") &&
    !groupCollapseStore.isNodeHidden(c.target)
  ) {
    return { kind: "conduit", id: c.target };
  }
  return null;
}

const _separationPins = new Map<string, Set<string>>();

export function pinRibbonSeparation(conduitIds: string[], cableId: string): void {
  for (const id of conduitIds) {
    const pins = _separationPins.get(id) ?? new Set<string>();
    pins.add(cableId);
    _separationPins.set(id, pins);
  }
}

function isSeparated(conduitId: string): boolean {
  if (_layouts.get(conduitId)?.selected) return true;
  const pins = _separationPins.get(conduitId);
  if (!pins) return false;
  for (const id of pins) if (!cableSelectionStore.has(id)) pins.delete(id);
  if (pins.size === 0) _separationPins.delete(conduitId);
  return pins.size > 0;
}

export function ribbonForConnection(
  editor: EditorLike,
  conn: Conn,
  opts?: { ignoreSeparation?: boolean },
): RibbonCable | null {
  if (!conn.source || !conn.target) return null;
  if (cableGhostStore.isGhost(conn.id)) return null;
  if (!(editor.getNode(conn.source) instanceof ConduitNode)) return null;
  if (!conn.sourceOutput.startsWith("out_")) return null;
  if (groupCollapseStore.isNodeHidden(conn.source)) return groupSourceRibbon(editor, conn);
  const separate = !opts?.ignoreSeparation;
  if (separate && isSeparated(conn.source)) return null;
  const tgt = ribbonTargetOf(editor, conn);
  if (!tgt) return null;
  if (separate && tgt.kind === "conduit" && isSeparated(tgt.id)) return null;
  const members = editor
    .getConnections()
    .filter((c) => {
      if (c.source !== conn.source || !c.sourceOutput.startsWith("out_")) return false;
      if (cableGhostStore.isGhost(c.id)) return false;
      const t = ribbonTargetOf(editor, c);
      return t !== null && t.kind === tgt.kind && t.id === tgt.id;
    })
    .sort((a, b) => laneIdx(a.sourceOutput) - laneIdx(b.sourceOutput));
  if (members.length < 2) return null;
  return {
    key: `${conn.source}→${tgt.kind}:${tgt.id}`,
    kind: tgt.kind,
    sourceId: conn.source,
    targetId: tgt.id,
    members,
    repId: members[0].id,
  };
}

function groupSourceRibbon(editor: EditorLike, conn: Conn): RibbonCable | null {
  const dest = ribbonTargetOf(editor, conn);
  if (!dest) return null;
  const pill = groupCollapseStore.outPillFor(conn.source, conn.sourceOutput);
  if (!pill) return null;
  const members = editor
    .getConnections()
    .filter((c) => {
      if (c.source !== conn.source || !c.sourceOutput.startsWith("out_")) return false;
      if (cableGhostStore.isGhost(c.id)) return false;
      const d = ribbonTargetOf(editor, c);
      return !!d && d.kind === dest.kind && d.id === dest.id;
    })
    .sort((a, b) => laneIdx(a.sourceOutput) - laneIdx(b.sourceOutput));
  if (members.length < 2) return null;
  return {
    key: `groupsrc:${pill.groupId}:${conn.source}→${dest.kind}:${dest.id}`,
    kind: "groupSource",
    sourceId: pill.groupId,
    targetId: dest.id,
    destKind: dest.kind,
    members,
    repId: members[0].id,
  };
}
