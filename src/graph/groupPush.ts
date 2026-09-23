// [[C85]] groupPushDeterministic, [[C89]] standoffsSolveLast, [[C112]] noOverlapsEver
import { measuredSize } from "./nodeSize";
import type { View } from "./view";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { GroupNode } from "./rete-nodes";
import { moveGroupMembers, withLockedGroupsPinned } from "./groupLogic";
import { COLLAPSE_LAYOUT, groupCollapseStore, syncGroupCollapse, settleCollapse } from "./groupCollapse";
import { computeExpandPush, separateAll, PushBox, Satellite, Disp, Pt } from "./groupPushCore";
import { standoffStore, standoffClusters, liveStandoffs, Box as StandoffBox } from "./standoffs";
import { solveStandoffs } from "./standoffSolver";
import { scheduleAutosave } from "./persistence";
import { settingsStore } from "./settingsStore";
import { dockedNodeStore } from "./dockedNodeStore";
import { unselectAllNodes, selectNode } from "./canvasCommands";
import { measuredBox } from "./nodeSize";


type Editor = NodeEditor<Schemes>;

interface PushRecord {
  pushed: string;
  dueTo: Set<string>;
  preX: number;
  preY: number;
  expX: number;
  expY: number;
}

const _records = new Map<string, PushRecord>();

const EPS = 2;

export const groupPushStore = {
  invalidateGroup(id: string): void {
    _records.delete(id);
    for (const [pid, r] of [..._records]) {
      if (r.dueTo.has(id)) _records.delete(pid);
    }
  },
};

const position = (view: View, id: string) => view.position(id);

export function translateEntityBy(editor: Editor, view: View, id: string, dx: number, dy: number): void {
  translatePushed(editor, view, id, dx, dy);
}

function translatePushed(editor: Editor, view: View, id: string, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const p = position(view, id);
  if (!p) return;
  void view.moveNode(id, { x: p.x + dx, y: p.y + dy });
  const node = editor.getNode(id);
  // A group's members move with it, and so does every FC docked to one that isn't a member itself.
  const riders = node instanceof GroupNode ? node.members : [id];
  if (node instanceof GroupNode) moveGroupMembers(editor, view, node, dx, dy);
  const moved = new Set(riders);
  for (const host of riders) {
    for (const d of dockedNodeStore.getDockedTo(host)) {
      if (moved.has(d.id)) continue;
      const dp = position(view, d.id);
      if (dp) void view.moveNode(d.id, { x: dp.x + dx, y: dp.y + dy });
    }
  }
}

// ─── World snapshot ────────────────────────────────────────────────────────────

interface World {
  boxes: Map<string, PushBox>;
  looseIds: Set<string>;
  origin: Map<string, { x: number; y: number }>;
  /** How far an open group's box reaches left of and above the group's own corner, over its members' docked FCs. */
  overhang: Map<string, { left: number; top: number }>;
}

/** An open group's box reaches over any FC docked to a member that hangs past its edge, since the FC rides that member ([[C112]] noOverlapsEver). */
function withDockedOverhang(editor: Editor, view: View, g: GroupNode, box: PushBox): PushBox {
  let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
  for (const m of g.members) {
    for (const d of dockedNodeStore.getDockedTo(m)) {
      const b = measuredBox(view, d.id, editor);
      if (!b) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
  }
  return { id: box.id, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function buildWorld(editor: Editor, view: View, expandedIds: Set<string>): World {
  const grouped = new Set<string>();
  for (const n of editor.getNodes()) {
    if (n instanceof GroupNode) for (const m of n.members) grouped.add(m);
  }
  const boxes = new Map<string, PushBox>();
  const looseIds = new Set<string>();
  const origin = new Map<string, { x: number; y: number }>();
  const overhang = new Map<string, { left: number; top: number }>();
  for (const n of editor.getNodes()) {
    const p = view.position(n.id);
    if (!p) continue;
    if (n instanceof GroupNode) {
      if (n.collapsed && !expandedIds.has(n.id)) {
        boxes.set(n.id, { id: n.id, x: p.x, y: p.y, ...collapsedCardSize(view, n) });
        continue;
      }
      const box = withDockedOverhang(editor, view, n, { id: n.id, x: p.x, y: p.y, w: n.width, h: n.height });
      boxes.set(n.id, box);
      overhang.set(n.id, { left: p.x - box.x, top: p.y - box.y });
    } else {
      if (grouped.has(n.id) || dockedNodeStore.get(n.id)) continue;
      const mb = measuredBox(view, n.id, editor);
      const w = mb?.w ?? 100;
      const h = mb?.h ?? 50;
      // A docked FC rides its host, so the host's box reaches over it: right for an output dock, left for an input dock.
      let fcRight = 0;
      let fcLeft = 0;
      for (const d of dockedNodeStore.getDockedTo(n.id)) {
        const fc = editor.getNode(d.id) as { width?: number } | undefined;
        if (!fc?.width) continue;
        if (d.side === "output") fcRight = Math.max(fcRight, fc.width + 8);
        else fcLeft = Math.max(fcLeft, fc.width + 8);
      }
      boxes.set(n.id, { id: n.id, x: p.x - fcLeft, y: p.y, w: w + fcLeft + fcRight, h });
      looseIds.add(n.id);
    }
  }
  for (const [id, b] of boxes) origin.set(id, { x: b.x, y: b.y });
  return { boxes, looseIds, origin, overhang };
}

function satellitesFor(editor: Editor, view: View, g: GroupNode, world: World): Map<string, Satellite> {
  const members = new Set(g.members);
  const gBox = world.boxes.get(g.id);
  const gOrig = world.origin.get(g.id);
  const gShift = gBox && gOrig ? { dx: gBox.x - gOrig.x, dy: gBox.y - gOrig.y } : { dx: 0, dy: 0 };

  const memberCy = (id: string): number | null => {
    const b = measuredBox(view, id, editor);
    if (!b) return null;
    return b.y + b.h / 2 + gShift.dy;
  };

  const agg = new Map<string, { up: number; down: number; ys: number[] }>();
  const tally = (looseId: string, dir: "up" | "down", memberId: string) => {
    if (!world.looseIds.has(looseId)) return;
    const e = agg.get(looseId) ?? { up: 0, down: 0, ys: [] };
    e[dir]++;
    const cy = memberCy(memberId);
    if (cy !== null) e.ys.push(cy);
    agg.set(looseId, e);
  };
  for (const c of editor.getConnections()) {
    if (members.has(c.target) && !members.has(c.source)) tally(c.source, "up", c.target);
    if (members.has(c.source) && !members.has(c.target)) tally(c.target, "down", c.source);
  }

  const out = new Map<string, Satellite>();
  for (const [id, e] of agg) {
    if (e.up === e.down) continue;
    const fallbackCy = gBox ? gBox.y + gBox.h / 2 : 0;
    out.set(id, {
      side: e.up > e.down ? "upstream" : "downstream",
      alignCy: e.ys.length ? e.ys.reduce((a, b) => a + b, 0) / e.ys.length : fallbackCy,
    });
  }
  return out;
}

function buildAnchors(
  editor: Editor,
  world: World,
  satellites: Map<string, Satellite>,
): Map<string, Pt[]> {
  const memberOf = new Map<string, string>();
  const groupIds = new Set<string>();
  for (const n of editor.getNodes()) {
    if (n instanceof GroupNode) { groupIds.add(n.id); for (const m of n.members) memberOf.set(m, n.id); }
  }
  const entityOf = (id: string): string | null => {
    const g = memberOf.get(id);
    if (g) return g;
    const dock = dockedNodeStore.get(id);
    if (dock) return memberOf.get(dock.hostNodeId) ?? (world.boxes.has(dock.hostNodeId) ? dock.hostNodeId : null);
    return world.boxes.has(id) ? id : null;
  };
  const out = new Map<string, Pt[]>();
  const add = (from: string | null, to: string | null) => {
    if (!from || !to || from === to) return;
    const tb = world.boxes.get(to);
    if (!tb) return;
    const list = out.get(from) ?? [];
    list.push({ x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 });
    out.set(from, list);
  };
  for (const c of editor.getConnections()) {
    const s = entityOf(c.source);
    const t = entityOf(c.target);
    add(s, t);
    add(t, s);
  }
  for (const id of satellites.keys()) out.delete(id);
  for (const id of groupIds) out.delete(id);
  return out;
}

function collapsedCardSize(view: View, g: GroupNode): { w: number; h: number } {
  const m = measuredSize(view, g.id);
  if (m) return m;
  const el = view.nodeElement(g.id);
  // [[D64]] exception: the last tier is the collapsed-card layout formula, not a default.
  if (el && el.offsetWidth > 0) return { w: el.offsetWidth, h: el.offsetHeight };
  const rows = Math.max(
    groupCollapseStore.retainedFor(g.id).length,
    groupCollapseStore.inputPillsFor(g.id).length,
  );
  return {
    w: COLLAPSE_LAYOUT.width,
    h: COLLAPSE_LAYOUT.headerH + COLLAPSE_LAYOUT.padTop * 2 + rows * COLLAPSE_LAYOUT.rowH,
  };
}

// ─── Expand: run the core per group over one shared box world ─────────────────

function lockedGroupIds(editor: Editor): Set<string> {
  const out = new Set<string>();
  for (const n of editor.getNodes()) if (n instanceof GroupNode && n.lockedPosition) out.add(n.id);
  return out;
}

function runExpandPushes(
  editor: Editor,
  view: View,
  changed: GroupNode[],
  preSizes: Map<string, { w: number; h: number }>,
  record = true,
): void {
  const expandedIds = new Set(changed.map((g) => g.id));
  const world = buildWorld(editor, view, expandedIds);
  const locked = lockedGroupIds(editor);

  const order = [...changed].sort((a, b) => {
    const pa = world.boxes.get(a.id);
    const pb = world.boxes.get(b.id);
    return (pa ? pa.x + pa.y : 0) - (pb ? pb.x + pb.y : 0);
  });

  const totals = new Map<string, Disp>();
  const attribution = new Map<string, Set<string>>();

  for (const g of order) {
    const gBox = world.boxes.get(g.id);
    const pre = preSizes.get(g.id);
    if (!gBox || !pre) continue;
    // The collapsed card keeps its right and bottom seams; an overhang only widens it toward the box's corner.
    const oh = world.overhang.get(g.id) ?? { left: 0, top: 0 };
    const spec = { x: gBox.x, y: gBox.y, preW: pre.w + oh.left, preH: pre.h + oh.top, postW: gBox.w, postH: gBox.h };
    const obstacles = [...world.boxes.values()].filter((b) => b.id !== g.id);
    const sats = satellitesFor(editor, view, g, world);
    const anchors = buildAnchors(editor, world, sats);
    const disp = computeExpandPush(spec, obstacles, sats, anchors, locked);
    for (const [id, d] of disp) {
      const b = world.boxes.get(id)!;
      b.x += d.dx;
      b.y += d.dy;
      const t = totals.get(id) ?? { dx: 0, dy: 0 };
      t.dx += d.dx;
      t.dy += d.dy;
      totals.set(id, t);
      const due = attribution.get(id) ?? new Set<string>();
      due.add(g.id);
      attribution.set(id, due);
    }
  }

  if (!standoffStore.isEmpty()) {
    for (const cluster of standoffClusters(liveStandoffs(groupCollapseStore.isNodeHidden))) {
      let lead: Disp = { dx: 0, dy: 0 };
      let leadMag = 0;
      for (const id of cluster) {
        const t = totals.get(id);
        if (!t) continue;
        const mag = t.dx * t.dx + t.dy * t.dy;
        if (mag > leadMag) { leadMag = mag; lead = t; }
      }
      if (leadMag === 0) continue;
      const groups = new Set<string>();
      for (const id of cluster) for (const g of attribution.get(id) ?? []) groups.add(g);
      for (const id of cluster) {
        const b = world.boxes.get(id);
        if (!b || locked.has(id)) continue;
        const t = totals.get(id) ?? { dx: 0, dy: 0 };
        const ddx = lead.dx - t.dx;
        const ddy = lead.dy - t.dy;
        if (ddx !== 0 || ddy !== 0) { b.x += ddx; b.y += ddy; }
        totals.set(id, { dx: lead.dx, dy: lead.dy });
        attribution.set(id, new Set(groups));
      }
    }
  }

  if (!standoffStore.isEmpty()) {
    const plain = new Map<string, StandoffBox>(
      [...world.boxes].map(([id, b]) => [id, { x: b.x, y: b.y, w: b.w, h: b.h }]),
    );
    const settle = solveStandoffs(plain, liveStandoffs(groupCollapseStore.isNodeHidden), withLockedGroupsPinned(editor, expandedIds), { forceLock: true });
    for (const [id, d] of settle) {
      const b = world.boxes.get(id);
      if (!b) continue;
      b.x += d.dx;
      b.y += d.dy;
      const t = totals.get(id) ?? { dx: 0, dy: 0 };
      t.dx += d.dx;
      t.dy += d.dy;
      totals.set(id, t);
      const due = attribution.get(id) ?? new Set<string>();
      for (const g of changed) due.add(g.id);
      attribution.set(id, due);
    }
  }

  const backstop = separateAll([...world.boxes.values()], {
    clusters: standoffClusters(liveStandoffs(groupCollapseStore.isNodeHidden)),
    fixed: locked,
    prefer: expandedIds,
  });
  for (const [id, d] of backstop) {
    const b = world.boxes.get(id)!;
    b.x += d.dx;
    b.y += d.dy;
    const t = totals.get(id) ?? { dx: 0, dy: 0 };
    t.dx += d.dx;
    t.dy += d.dy;
    totals.set(id, t);
    const due = attribution.get(id) ?? new Set<string>();
    for (const g of changed) due.add(g.id);
    attribution.set(id, due);
  }

  for (const [id, t] of totals) {
    if (t.dx === 0 && t.dy === 0) continue;
    const p = position(view, id);
    if (!p) continue;
    if (record) {
      const existing = _records.get(id);
      const stale = existing &&
        (Math.abs(p.x - existing.expX) > EPS || Math.abs(p.y - existing.expY) > EPS);
      if (existing && !stale) {
        for (const gid of attribution.get(id)!) existing.dueTo.add(gid);
        existing.expX = p.x + t.dx;
        existing.expY = p.y + t.dy;
      } else {
        _records.set(id, {
          pushed: id,
          dueTo: attribution.get(id)!,
          preX: p.x,
          preY: p.y,
          expX: p.x + t.dx,
          expY: p.y + t.dy,
        });
      }
    }
    translatePushed(editor, view, id, t.dx, t.dy);
  }
}

/** Pass only groups that actually grew; `preSizes` is each one's size before it grew. */
export function pushForGrownGroups(
  editor: Editor,
  view: View,
  grown: GroupNode[],
  preSizes: Map<string, { w: number; h: number }>,
): void {
  if (grown.length === 0 || !settingsStore.get("groupPush")) return;
  runExpandPushes(editor, view, grown, preSizes, false);
}

// ─── Restore ───────────────────────────────────────────────────────────────────

export function restoreSettledPushes(editor: Editor, view: View): void {
  let moved = false;
  for (const [id, r] of [..._records]) {
    const settled = [...r.dueTo].every((gid) => {
      const g = editor.getNode(gid);
      return !g || (g instanceof GroupNode && g.collapsed);
    });
    if (!settled) continue;
    _records.delete(id);
    const p = position(view, id);
    if (!p) continue;
    if (Math.abs(p.x - r.expX) <= EPS && Math.abs(p.y - r.expY) <= EPS) {
      translatePushed(editor, view, id, r.preX - p.x, r.preY - p.y);
      moved = true;
    }
  }
  if (moved) scheduleAutosave();
}

// [[C52]] visibleSelection: a member hidden by the collapse leaves the selection.
function dropHiddenFromSelection(editor: Editor): void {
  const selected = editor.getNodes().filter((n) => (n as { selected?: boolean }).selected === true);
  if (!selected.some((n) => groupCollapseStore.isNodeHidden(n.id))) return;
  const keep = selected.filter((n) => !groupCollapseStore.isNodeHidden(n.id)).map((n) => n.id);
  unselectAllNodes();
  keep.forEach((id, i) => selectNode(id, i > 0));
}

// ─── The one toggle entry point ────────────────────────────────────────────────

export async function setGroupsCollapsed(
  editor: Editor,
  view: View,
  targets: GroupNode[],
  collapse: boolean,
): Promise<void> {
  const changed = targets.filter((g) => g.collapsed !== collapse);
  if (changed.length === 0) return;

  const preSizes = new Map<string, { w: number; h: number }>();
  if (!collapse) for (const g of changed) preSizes.set(g.id, collapsedCardSize(view, g));

  for (const g of changed) g.collapsed = collapse;
  syncGroupCollapse(editor, view);
  if (collapse) dropHiddenFromSelection(editor);
  await Promise.all(changed.map((g) => view.rerenderNode(g.id)));
  for (const g of changed) settleCollapse(view, g.id, g.members, !collapse);

  if (collapse) {
    restoreSettledPushes(editor, view);
    settleStandoffsOverWorld(editor, view, new Set(changed.map((g) => g.id)));
    settleOverlapsAfterPaint(editor, view, new Set(changed.map((g) => g.id)));
  } else if (settingsStore.get("groupPush")) {
    runExpandPushes(editor, view, changed, preSizes);
  }
  scheduleAutosave();
}

function settleStandoffsOverWorld(editor: Editor, view: View, pinned: Set<string>): void {
  if (standoffStore.isEmpty()) return;
  const world = buildWorld(editor, view, new Set());
  const plain = new Map<string, StandoffBox>(
    [...world.boxes].map(([id, b]) => [id, { x: b.x, y: b.y, w: b.w, h: b.h }]),
  );
  const disp = solveStandoffs(plain, liveStandoffs(groupCollapseStore.isNodeHidden), withLockedGroupsPinned(editor, pinned), { forceLock: true });
  for (const [id, d] of disp) translatePushed(editor, view, id, d.dx, d.dy);
}

/** Separates every overlap among the top-level boxes; `prefer` holds still where it can. */
export function settleOverlaps(editor: Editor, view: View, prefer: ReadonlySet<string> = new Set()): void {
  const world = buildWorld(editor, view, new Set());
  const disp = separateAll([...world.boxes.values()], {
    clusters: standoffClusters(liveStandoffs(groupCollapseStore.isNodeHidden)),
    fixed: lockedGroupIds(editor),
    prefer,
  });
  for (const [id, d] of disp) translatePushed(editor, view, id, d.dx, d.dy);
  if (disp.size) scheduleAutosave();
}

/** Two frames later, so React Flow has measured whatever the op just resized. */
export function settleOverlapsAfterPaint(editor: Editor, view: View, prefer: ReadonlySet<string> = new Set()): void {
  requestAnimationFrame(() => requestAnimationFrame(() => settleOverlaps(editor, view, prefer)));
}
