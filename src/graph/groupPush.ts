import type { Surface } from "./surface";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { GroupNode } from "./rete-nodes";
import { moveGroupMembers } from "./groupLogic";
import { COLLAPSE_LAYOUT, groupCollapseStore, syncGroupCollapse, settleCollapse } from "./groupCollapse";
import { computeExpandPush, separateOverlaps, PushBox, Satellite, Disp, Pt } from "./groupPushCore";
import { standoffStore, standoffClusters, Box as StandoffBox } from "./standoffs";
import { solveStandoffs } from "./standoffSolver";
import { scheduleAutosave } from "./persistence";
import { settingsStore } from "./settingsStore";
import { dockedNodeStore } from "./dockedNodeStore";
import { measuredBox } from "./nodeSize";

// Push records are in-memory only: a reload keeps everything where it is.

type Editor = NodeEditor<Schemes>;
type Area = Surface;

interface PushRecord {
  pushed: string;        // the entity that was moved (group or loose node)
  dueTo: Set<string>;    // expanded groups whose expansion displaced it
  preX: number;          // where it was before the first push (restore target)
  preY: number;
  expX: number;          // where our latest push left it ("untouched?" check)
  expY: number;
}

const _records = new Map<string, PushRecord>(); // keyed by pushed id

const EPS = 2; // px tolerance for "still where we left it"

export const groupPushStore = {
  /** Forget any displacement involving this entity (it was manually moved). */
  invalidateGroup(id: string): void {
    _records.delete(id);
    for (const [pid, r] of [..._records]) {
      if (r.dueTo.has(id)) _records.delete(pid);
    }
  },
};

function position(area: Area, id: string) {
  return area.nodeViews.get(id)?.position;
}

// A group carries its members; a loose node carries any FC docked to it.
export function translateEntityBy(editor: Editor, area: Area, id: string, dx: number, dy: number): void {
  translatePushed(editor, area, id, dx, dy);
}

function translatePushed(editor: Editor, area: Area, id: string, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const p = position(area, id);
  if (!p) return;
  void area.translate(id, { x: p.x + dx, y: p.y + dy });
  const node = editor.getNode(id);
  if (node instanceof GroupNode) {
    moveGroupMembers(editor, area, node, dx, dy);
  } else {
    for (const d of dockedNodeStore.getDockedTo(id)) {
      const dp = position(area, d.id);
      if (dp) void area.translate(d.id, { x: dp.x + dx, y: dp.y + dy });
    }
  }
}

// ─── World snapshot ────────────────────────────────────────────────────────────
// Movable boxes = every group + every loose (ungrouped, undocked) node. Groups in
// `expandedIds` use their STORED size — their element may still be mid-render.

interface World {
  boxes: Map<string, PushBox>;
  looseIds: Set<string>;
  origin: Map<string, { x: number; y: number }>;
}

function buildWorld(editor: Editor, area: Area, expandedIds: Set<string>): World {
  const grouped = new Set<string>();
  for (const n of editor.getNodes()) {
    if (n instanceof GroupNode) for (const m of n.members) grouped.add(m);
  }
  const boxes = new Map<string, PushBox>();
  const looseIds = new Set<string>();
  const origin = new Map<string, { x: number; y: number }>();
  for (const n of editor.getNodes()) {
    const view = area.nodeViews.get(n.id);
    if (!view) continue;
    const p = view.position;
    if (n instanceof GroupNode) {
      const w = expandedIds.has(n.id) ? n.width : view.element.offsetWidth || n.width;
      const h = expandedIds.has(n.id) ? n.height : view.element.offsetHeight || n.height;
      boxes.set(n.id, { id: n.id, x: p.x, y: p.y, w, h });
    } else {
      if (grouped.has(n.id) || dockedNodeStore.get(n.id)) continue;
      // The shared size chokepoint, so the push math agrees with align/autofit.
      const mb = measuredBox(area, n.id, editor);
      const w = mb?.w ?? 100;
      const h = mb?.h ?? 50;
      // A docked FC has no box of its own, so without reserving its width the
      // overlap math shoves another box under it.
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

// alignCy is in WORLD coords — corrected by however far this group has already
// shifted within the batch, since members only physically move when it applies.
function satellitesFor(editor: Editor, area: Area, g: GroupNode, world: World): Map<string, Satellite> {
  const members = new Set(g.members);
  const gBox = world.boxes.get(g.id);
  const gOrig = world.origin.get(g.id);
  const gShift = gBox && gOrig ? { dx: gBox.x - gOrig.x, dy: gBox.y - gOrig.y } : { dx: 0, dy: 0 };

  const memberCy = (id: string): number | null => {
    const b = measuredBox(area, id, editor);
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
    if (e.up === e.down) continue; // wired both ways equally — no clear side
    const fallbackCy = gBox ? gBox.y + gBox.h / 2 : 0;
    out.set(id, {
      side: e.up > e.down ? "upstream" : "downstream",
      alignCy: e.ys.length ? e.ys.reduce((a, b) => a + b, 0) / e.ys.length : fallbackCy,
    });
  }
  return out;
}

// A displaced box clears TOWARD its anchors so cables stay short; each anchor
// resolves to its push entity (a member counts as its group, a docked FC as its
// host). Satellites of the expanding group are excluded — the rails pull them.
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
  // Groups must clear GEOMETRICALLY, never toward their cables — a group chasing
  // its connections piles interconnected groups onto one spot in a multi-expand.
  for (const id of groupIds) out.delete(id);
  return out;
}

// Must be measured BEFORE the expand flips the element; layout formula as fallback.
function collapsedCardSize(area: Area, g: GroupNode): { w: number; h: number } {
  const el = area.nodeViews.get(g.id)?.element;
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
// Passes run over the SAME in-memory boxes — translates are async, so reading the
// DOM between them would see stale positions; totals apply once at the end.

function runExpandPushes(
  editor: Editor,
  area: Area,
  changed: GroupNode[],
  preSizes: Map<string, { w: number; h: number }>,
  record = true,
): void {
  const expandedIds = new Set(changed.map((g) => g.id));
  const world = buildWorld(editor, area, expandedIds);

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
    const sats = satellitesFor(editor, area, g, world);
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

  // A standoff cluster moves as ONE rigid block: every member takes the cluster's
  // LARGEST push, keeping relative offsets intact.
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
      if (leadMag === 0) continue; // this push didn't touch the cluster
      // Attribution is the union of the members', so a later collapse restores the
      // whole cluster together.
      const groups = new Set<string>();
      for (const id of cluster) for (const g of attribution.get(id) ?? []) groups.add(g);
      for (const id of cluster) {
        const b = world.boxes.get(id);
        if (!b) continue; // standoff end isn't a loose entity (e.g. grouped) — skip
        const t = totals.get(id) ?? { dx: 0, dy: 0 };
        const ddx = lead.dx - t.dx;
        const ddy = lead.dy - t.dy;
        if (ddx !== 0 || ddy !== 0) { b.x += ddx; b.y += ddy; }
        totals.set(id, { dx: lead.dx, dy: lead.dy });
        attribution.set(id, new Set(groups));
      }
    }
  }

  // Standoffs outrank the heuristics; the corrections fold into the same
  // totals/records so collapse snaps everything back together.
  if (!standoffStore.isEmpty()) {
    const plain = new Map<string, StandoffBox>(
      [...world.boxes].map(([id, b]) => [id, { x: b.x, y: b.y, w: b.w, h: b.h }]),
    );
    const settle = solveStandoffs(plain, standoffStore.all(), expandedIds, { forceLock: true });
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

  // Hard backstop: separate EVERY remaining overlap, treating a standoff cluster as
  // one rigid unit so it can't tear. Monotonic (+x/+y) ⇒ terminates overlap-free.
  {
    const unitOf = new Map<string, string>();        // boxId → unit id
    const unitMembers = new Map<string, string[]>(); // unit id → boxIds
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
    const units: PushBox[] = [];
    for (const [uid, ids] of unitMembers) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of ids) {
        const b = world.boxes.get(id)!;
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      }
      units.push({ id: uid, x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    }
    for (const b of world.boxes.values()) {
      if (!unitOf.has(b.id)) units.push({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h });
    }
    for (const [uid, d] of separateOverlaps(units)) {
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
    const p = position(area, id);
    if (!p) continue;
    // `record` off ⇒ the displacement is PERMANENT, no restore record.
    if (record) {
      const existing = _records.get(id);
      // Merge only into a record whose node is STILL where our last push left it —
      // Tidy/align translate without firing drag invalidation, so merging into a
      // stale record would re-arm an obsolete restore target.
      const stale = existing &&
        (Math.abs(p.x - existing.expX) > EPS || Math.abs(p.y - existing.expY) > EPS);
      if (existing && !stale) {
        // Keep the original restore target; only extend the contributors.
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
    translatePushed(editor, area, id, t.dx, t.dy);
  }
}

/** The displacement is PERMANENT (no restore record); `preSizes` is each group's
 *  size BEFORE it grew, and only actually-grown groups may be passed. */
export function pushForGrownGroups(
  editor: Editor,
  area: Area,
  grown: GroupNode[],
  preSizes: Map<string, { w: number; h: number }>,
): void {
  if (grown.length === 0 || !settingsStore.get("groupPush")) return;
  runExpandPushes(editor, area, grown, preSizes, false);
}

// ─── Restore ───────────────────────────────────────────────────────────────────

/** Slides back every pushed entity whose contributing groups are ALL collapsed or
 *  deleted, unless it moved since; absolute records keep restores order-independent. */
export function restoreSettledPushes(editor: Editor, area: Area): void {
  let moved = false;
  for (const [id, r] of [..._records]) {
    const settled = [...r.dueTo].every((gid) => {
      const g = editor.getNode(gid);
      return !g || (g instanceof GroupNode && g.collapsed);
    });
    if (!settled) continue;
    _records.delete(id);
    const p = position(area, id);
    if (!p) continue;
    if (Math.abs(p.x - r.expX) <= EPS && Math.abs(p.y - r.expY) <= EPS) {
      translatePushed(editor, area, id, r.preX - p.x, r.preY - p.y);
      moved = true;
    }
    // else: moved since we pushed it — leave it where it is.
  }
  if (moved) scheduleAutosave();
}

// ─── The one toggle entry point ────────────────────────────────────────────────

/** THE toggle entry point (chevron and outline panel route through here) so the
 *  flip → sync → re-render → settle → push/restore order is identical everywhere. */
export async function setGroupsCollapsed(
  editor: Editor,
  area: Area,
  targets: GroupNode[],
  collapse: boolean,
): Promise<void> {
  const changed = targets.filter((g) => g.collapsed !== collapse);
  if (changed.length === 0) return;

  // The seam origins for the expansion — measure BEFORE the flip re-renders full size.
  const preSizes = new Map<string, { w: number; h: number }>();
  if (!collapse) for (const g of changed) preSizes.set(g.id, collapsedCardSize(area, g));

  for (const g of changed) g.collapsed = collapse;
  syncGroupCollapse(editor, area);
  // Wait for the size/render change so footprints measured below are current.
  await Promise.all(changed.map((g) => area.update("node", g.id)));
  for (const g of changed) settleCollapse(editor, area, g.id, g.members, !collapse);

  if (collapse) {
    restoreSettledPushes(editor, area);
    // Collapsing moves the standoff anchors, so re-satisfy any band the shrink
    // violated; a no-op when the restores above already landed everything in band.
    settleStandoffsOverWorld(editor, area, new Set(changed.map((g) => g.id)));
  } else if (settingsStore.get("groupPush")) {
    runExpandPushes(editor, area, changed, preSizes);
  }
  scheduleAutosave();
}

// Solve the standoff network over live boxes and apply the corrections.
function settleStandoffsOverWorld(editor: Editor, area: Area, pinned: Set<string>): void {
  if (standoffStore.isEmpty()) return;
  const world = buildWorld(editor, area, new Set());
  const plain = new Map<string, StandoffBox>(
    [...world.boxes].map(([id, b]) => [id, { x: b.x, y: b.y, w: b.w, h: b.h }]),
  );
  const disp = solveStandoffs(plain, standoffStore.all(), pinned, { forceLock: true });
  for (const [id, d] of disp) translatePushed(editor, area, id, d.dx, d.dy);
}
