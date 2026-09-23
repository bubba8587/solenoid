// [[C85]] groupPushDeterministic, [[C89]] standoffsSolveLast
import { measuredSize } from "./nodeSize";
import type { View } from "./view";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { GroupNode } from "./rete-nodes";
import { moveGroupMembers, withLockedGroupsPinned } from "./groupLogic";
import { COLLAPSE_LAYOUT, groupCollapseStore, syncGroupCollapse, settleCollapse } from "./groupCollapse";
import { computeExpandPush, separateOverlaps, overlappingPairs, PushBox, Satellite, Disp, Pt } from "./groupPushCore";
import { standoffStore, standoffClusters, Box as StandoffBox } from "./standoffs";
import { solveStandoffs } from "./standoffSolver";
import { scheduleAutosave } from "./persistence";
import { settingsStore } from "./settingsStore";
import { dockedNodeStore } from "./dockedNodeStore";
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
  if (node instanceof GroupNode) {
    moveGroupMembers(editor, view, node, dx, dy);
  } else {
    for (const d of dockedNodeStore.getDockedTo(id)) {
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
}

function buildWorld(editor: Editor, view: View, expandedIds: Set<string>): World {
  const grouped = new Set<string>();
  for (const n of editor.getNodes()) {
    if (n instanceof GroupNode) for (const m of n.members) grouped.add(m);
  }
  const boxes = new Map<string, PushBox>();
  const looseIds = new Set<string>();
  const origin = new Map<string, { x: number; y: number }>();
  for (const n of editor.getNodes()) {
    const p = view.position(n.id);
    if (!p) continue;
    if (n instanceof GroupNode) {
      const m = expandedIds.has(n.id) ? null : measuredSize(view, n.id);
      const el = view.nodeElement(n.id);
      // [[D64]] exception: an expanding group is read at its STORED size mid-render.
      const w = expandedIds.has(n.id) ? n.width : m?.w ?? (el?.offsetWidth || n.width);
      const h = expandedIds.has(n.id) ? n.height : m?.h ?? (el?.offsetHeight || n.height);
      boxes.set(n.id, { id: n.id, x: p.x, y: p.y, w, h });
    } else {
      if (grouped.has(n.id) || dockedNodeStore.get(n.id)) continue;
      const mb = measuredBox(view, n.id, editor);
      const w = mb?.w ?? 100;
      const h = mb?.h ?? 50;
      let fcW = 0;
      for (const d of dockedNodeStore.getDockedTo(n.id)) {
        if (d.side !== "output") continue;
        const fc = editor.getNode(d.id) as { width?: number } | undefined;
        if (fc?.width) fcW = Math.max(fcW, fc.width + 8);
      }
      boxes.set(n.id, { id: n.id, x: p.x, y: p.y, w: w + fcW, h });
      looseIds.add(n.id);
    }
  }
  for (const [id, b] of boxes) origin.set(id, { x: b.x, y: b.y });
  return { boxes, looseIds, origin };
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

function runExpandPushes(
  editor: Editor,
  view: View,
  changed: GroupNode[],
  preSizes: Map<string, { w: number; h: number }>,
  record = true,
): void {
  const expandedIds = new Set(changed.map((g) => g.id));
  const world = buildWorld(editor, view, expandedIds);
  const before = new Map<string, PushBox>();
  for (const [id, b] of world.boxes) {
    const pre = preSizes.get(id);
    before.set(id, { id, x: b.x, y: b.y, w: pre?.w ?? b.w, h: pre?.h ?? b.h });
  }

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
    const spec = { x: gBox.x, y: gBox.y, preW: pre.w, preH: pre.h, postW: gBox.w, postH: gBox.h };
    const obstacles = [...world.boxes.values()].filter((b) => b.id !== g.id);
    const sats = satellitesFor(editor, view, g, world);
    const anchors = buildAnchors(editor, world, sats);
    const disp = computeExpandPush(spec, obstacles, sats, anchors);
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
    for (const cluster of standoffClusters(standoffStore.all())) {
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
        if (!b) continue;
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
    const settle = solveStandoffs(plain, standoffStore.all(), withLockedGroupsPinned(editor, expandedIds), { forceLock: true });
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

  {
    const unitOf = new Map<string, string>();
    const unitMembers = new Map<string, string[]>();
    if (!standoffStore.isEmpty()) {
      let ci = 0;
      for (const cl of standoffClusters(standoffStore.all())) {
        const ids = [...cl].filter((id) => world.boxes.has(id));
        if (ids.length < 2) continue;
        const uid = `__cluster${ci++}`;
        for (const id of ids) unitOf.set(id, uid);
        unitMembers.set(uid, ids);
      }
    }
    const unitsOf = (boxes: Map<string, PushBox>): PushBox[] => {
      const units: PushBox[] = [];
      for (const [uid, ids] of unitMembers) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of ids) {
          const b = boxes.get(id)!;
          minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
        }
        units.push({ id: uid, x: minX, y: minY, w: maxX - minX, h: maxY - minY });
      }
      for (const b of boxes.values()) {
        if (!unitOf.has(b.id)) units.push({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h });
      }
      return units;
    };
    for (const [uid, d] of separateOverlaps(unitsOf(world.boxes), overlappingPairs(unitsOf(before)))) {
      for (const id of unitMembers.get(uid) ?? [uid]) {
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
  await Promise.all(changed.map((g) => view.rerenderNode(g.id)));
  for (const g of changed) settleCollapse(view, g.id, g.members, !collapse);

  if (collapse) {
    restoreSettledPushes(editor, view);
    settleStandoffsOverWorld(editor, view, new Set(changed.map((g) => g.id)));
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
  const disp = solveStandoffs(plain, standoffStore.all(), withLockedGroupsPinned(editor, pinned), { forceLock: true });
  for (const [id, d] of disp) translatePushed(editor, view, id, d.dx, d.dy);
}
