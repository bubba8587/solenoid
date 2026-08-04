import { ConduitNode } from "./rete-nodes";
import { groupCollapseStore } from "./groupCollapse";
import { cableGhostStore, cableSelectionStore } from "./cableState";
import { getArea } from "./process";

// Geometry constants shared with ConduitComponent so trunk endpoints can be
// computed without measuring DOM. The squares ARE the sockets; lane pitch is
// SQ + ROW_GAP (scaled).
export const CONDUIT_BODY_SIZE = 92;
export const CONDUIT_PIVOT = CONDUIT_BODY_SIZE / 2;
export const CONDUIT_SQ = 10;
export const CONDUIT_COL_GAP = 1.5;
export const CONDUIT_ROW_GAP = 1.5;

// ConduitComponent publishes its live angle + scale (the connector shrinks when
// deselected, expands when selected / a drag is near). Connection components
// read it to place the trunk's face-center endpoints, and subscribe so the
// trunk tracks expansion.

type ConduitLayout = { angle: number; scale: number; selected: boolean };

const _layouts = new Map<string, ConduitLayout>();
let _layoutVersion = 0;
const _layoutListeners = new Set<() => void>();
function notifyLayout() { _layoutVersion++; for (const l of _layoutListeners) l(); }

export const conduitLayoutStore = {
  set(nodeId: string, layout: ConduitLayout) {
    const cur = _layouts.get(nodeId);
    if (cur && cur.angle === layout.angle && cur.scale === layout.scale && cur.selected === layout.selected) return;
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

// Center of a Conduit's input/output socket column, in canvas coords, plus the
// block angle. This is where the ribbon trunk attaches. Null until the Conduit
// has mounted and published its layout.
export function conduitFacePoint(
  nodeId: string,
  side: "in" | "out",
): { x: number; y: number; angle: number } | null {
  const lay = _layouts.get(nodeId);
  const pos = getArea()?.nodeViews.get(nodeId)?.position;
  if (!lay || !pos) return null;
  const halfW = ((CONDUIT_SQ + CONDUIT_COL_GAP) * lay.scale) / 2;
  const sign = side === "out" ? 1 : -1;
  const rad = (lay.angle * Math.PI) / 180;
  return {
    x: pos.x + CONDUIT_PIVOT + sign * halfW * Math.cos(rad),
    y: pos.y + CONDUIT_PIVOT + sign * halfW * Math.sin(rad),
    angle: lay.angle,
  };
}

// The hovered ribbon key. The trunk and every fan branch are drawn by different
// ConnectionComponents; sharing hover through a store is what makes the whole
// ribbon light up together.

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
  // "conduit" / "group": a VISIBLE Conduit's outputs bundle to one entity
  // (another Conduit, or a collapsed group's combined input pill).
  // "groupSource": the INVERSE — a Conduit HIDDEN in a collapsed group whose
  // outputs leave the group bundle out of the group's combined OUTPUT pill,
  // fanning to their various external targets.
  kind: "conduit" | "group" | "groupSource";
  sourceId: string; // source Conduit id, or (groupSource) the source collapsed group id
  targetId: string; // destination Conduit id / collapsed group id
  // For "groupSource": whether the destination is a visible Conduit (fan into it)
  // or a collapsed group (land whole on its pill). Undefined for the other kinds.
  destKind?: "conduit" | "group";
  members: Conn[];  // sorted by lane index; members[0] is the representative
  repId: string;
};

const laneIdx = (key: string) => Number(key.slice(key.indexOf("_") + 1));

// The entity a connection lands on, for bundling purposes: a collapsed group's
// pill (checked first — a hidden target Conduit belongs to its group), else a
// visible Conduit's lane input.
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

const _separationPins = new Map<string, Set<string>>(); // conduit id → pinning cable ids

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
  // Prune pins whose cable is no longer selected — they've expired.
  for (const id of pins) if (!cableSelectionStore.has(id)) pins.delete(id);
  if (pins.size === 0) _separationPins.delete(conduitId);
  return pins.size > 0;
}

/**
 * The ribbon this connection belongs to, or null when it renders as a normal
 * cable. A ribbon = 2+ non-ghost cables from one visible Conduit's outputs to
 * the same entity. Computed fresh from the editor each call (cheap), so there
 * is no membership state to keep in sync. `ignoreSeparation` asks for the
 * would-be ribbon regardless of separation (used to decide whether a clicked
 * cable should pin).
 */
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
