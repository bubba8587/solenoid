// Multi-node operations over the current selection: align, distribute, batch
// collapse/expand (scope-features #57(b)). Explicitly does NOT do paste-anywhere
// or wrap-in-subgraph — both are a different gesture (bundle 09 owns the latter).
//
// Reads the selection the same way nudgeSelection (Canvas.tsx) and
// createGroupFromSelection (groupLogic.ts) do: editor.getNodes().filter(n =>
// n.selected). Uses the process.ts singletons (getEditor/getArea) rather than
// Canvas-local refs so this is callable from anywhere (the command palette).

import { GroupNode } from "./rete-nodes";
import { getEditor, getArea, repositionDockedNodes, unselectAllNodes, selectNode } from "./process";
import { standoffStore, standoffClusters, settleStandoffs } from "./standoffs";
import { collapseStore } from "./collapseStore";
import { scheduleAutosave } from "./persistence";
import { measuredBox, type NodeBox } from "./nodeSize";
import type { Schemes, AreaExtra } from "./schemes";
import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";

type Editor = NodeEditor<Schemes>;
type Area = AreaPlugin<Schemes, AreaExtra>;
type Box = NodeBox;

function selectedNodeIds(editor: Editor): string[] {
  return editor.getNodes()
    .filter((n) => (n as { selected?: boolean }).selected === true)
    .map((n) => n.id);
}

function boxOf(area: Area, id: string): Box | null {
  return measuredBox(area, id, getEditor() ?? undefined);
}

// Same expansion Canvas's arrow-key nudge uses (and now shares this copy of): a
// selected group carries its members, and touching a standoff-clustered node
// carries the whole cluster, so aligning one end of a standoffed pair doesn't
// leave it wrenched away from the bar.
export function expandMoveSet(editor: Editor, seedIds: Iterable<string>): Set<string> {
  const clusterOf = new Map<string, string[]>();
  for (const c of standoffClusters()) for (const id of c) clusterOf.set(id, c);
  const toMove = new Set<string>();
  const queue: string[] = [];
  const enqueue = (id: string) => { if (!toMove.has(id)) { toMove.add(id); queue.push(id); } };
  for (const id of seedIds) enqueue(id);
  while (queue.length) {
    const id = queue.pop()!;
    const node = editor.getNode(id);
    if (node instanceof GroupNode) for (const m of node.members) enqueue(m);
    const cl = clusterOf.get(id);
    if (cl) for (const m of cl) enqueue(m);
  }
  return toMove;
}

type Move = { seedId: string; dx: number; dy: number };

/** Apply a batch of per-seed deltas, moving each seed's rigid attachments (group
 *  members + standoff cluster) with it — but translating every physical node EXACTLY
 *  ONCE. A node carried by more than one seed (e.g. a selected group and a separately
 *  selected member of it) follows the FIRST seed only. This is the fix for the
 *  double-move bug: the old per-item loop re-expanded and re-translated from each
 *  node's LIVE position while deltas were computed from boxes captured up front, so
 *  shared members drifted by the sum of every seed's delta. */
async function applyMoves(editor: Editor, area: Area, moves: Move[]): Promise<void> {
  const delta = new Map<string, { dx: number; dy: number }>();
  for (const { seedId, dx, dy } of moves) {
    if (dx === 0 && dy === 0) continue;
    for (const id of expandMoveSet(editor, [seedId])) {
      if (!delta.has(id)) delta.set(id, { dx, dy });
    }
  }
  // Clear the selection for the duration of the moves, then restore it. A SELECTED
  // node's translate triggers the selector's group-follow (rete moves every other
  // selected node by the same delta — the multi-drag mechanism), which compounds
  // across our per-node placement and corrupts the result: nodes shift instead of
  // aligning, only some land, and distribute nets to nothing. Same guard Tidy uses
  // (Canvas arrangeFn). expandMoveSet's group/cluster carries are NOT selected, so
  // they don't trigger it — only the selected seeds do.
  const restore = editor.getNodes()
    .filter((n) => (n as { selected?: boolean }).selected === true)
    .map((n) => n.id);
  if (restore.length > 0) unselectAllNodes();
  try {
    for (const [id, { dx, dy }] of delta) {
      const v = area.nodeViews.get(id);
      if (!v) continue;
      await area.translate(id, { x: v.position.x + dx, y: v.position.y + dy });
      repositionDockedNodes(id);
    }
  } finally {
    for (const id of restore) selectNode(id, true);
  }
}

async function settle(): Promise<void> {
  if (!standoffStore.isEmpty()) settleStandoffs();
  scheduleAutosave();
}

export type AlignKind = "left" | "right" | "top" | "bottom" | "center-h" | "center-v";
export type Placed = { id: string; box: Box };

/** Pure geometry: per-node deltas to align a set of boxes to the selection's own
 *  bounding-box edge/center (Figma/Illustrator semantics). Exported for tests. */
export function alignDeltas(items: Placed[], kind: AlignKind): Move[] {
  const xMin = Math.min(...items.map((e) => e.box.x));
  const xMax = Math.max(...items.map((e) => e.box.x + e.box.w));
  const yMin = Math.min(...items.map((e) => e.box.y));
  const yMax = Math.max(...items.map((e) => e.box.y + e.box.h));
  return items.map(({ id, box }) => {
    let nx = box.x, ny = box.y;
    switch (kind) {
      case "left": nx = xMin; break;
      case "right": nx = xMax - box.w; break;
      case "center-h": nx = (xMin + xMax) / 2 - box.w / 2; break;
      case "top": ny = yMin; break;
      case "bottom": ny = yMax - box.h; break;
      case "center-v": ny = (yMin + yMax) / 2 - box.h / 2; break;
    }
    return { seedId: id, dx: nx - box.x, dy: ny - box.y };
  });
}

/** Pure geometry: per-node deltas to space boxes with EQUAL GAPS between edges
 *  along one axis, first/last fixed. Overlap-free by construction (unlike center
 *  spacing). Returns [] for fewer than 3 boxes. Exported for tests. */
export function distributeDeltas(items: Placed[], axis: "h" | "v"): Move[] {
  if (items.length < 3) return [];
  const start = (b: Box) => (axis === "h" ? b.x : b.y);
  const size = (b: Box) => (axis === "h" ? b.w : b.h);
  const sorted = [...items].sort((a, b) => start(a.box) - start(b.box));
  const firstStart = start(sorted[0].box);
  const lastEnd = start(sorted[sorted.length - 1].box) + size(sorted[sorted.length - 1].box);
  const totalSize = sorted.reduce((s, it) => s + size(it.box), 0);
  const gap = (lastEnd - firstStart - totalSize) / (sorted.length - 1);
  const moves: Move[] = [];
  let cursor = firstStart + size(sorted[0].box) + gap; // leading edge of sorted[1]
  for (let i = 1; i < sorted.length - 1; i++) {
    const { id, box } = sorted[i];
    const d = cursor - start(box);
    moves.push({ seedId: id, dx: axis === "h" ? d : 0, dy: axis === "v" ? d : 0 });
    cursor += size(box) + gap;
  }
  return moves;
}

/** Align the selected top-level nodes' edges (or centers) to the selection's own
 *  bounding-box edge — Figma/Illustrator semantics. A deliberate manual gesture,
 *  so (unlike an automated layout pass) it isn't guaranteed overlap-free: two
 *  selected nodes that already share the OTHER axis will land on top of each
 *  other, exactly as every other design tool's align does. */
export async function alignSelection(kind: AlignKind): Promise<void> {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;
  const ids = selectedNodeIds(editor);
  const items = ids.map((id) => ({ id, box: boxOf(area, id) }))
    .filter((e): e is Placed => e.box != null);
  if (items.length < 2) return;
  await applyMoves(editor, area, alignDeltas(items, kind));
  await settle();
}

/** Evenly space the selected nodes along one axis, keeping the two extreme
 *  (first/last, by leading edge) nodes fixed. Distributes the GAPS between edges,
 *  not the centers: with Solenoid's very different node heights (a Number vs a
 *  Frame) equal-center spacing left big nodes overlapping their neighbours while
 *  small ones got large gaps — equal-gap spacing is overlap-free by construction.
 *  Needs at least 3 (2 nodes have nothing between them to redistribute). */
export async function distributeSelection(axis: "h" | "v"): Promise<void> {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;
  const ids = selectedNodeIds(editor);
  const items = ids.map((id) => ({ id, box: boxOf(area, id) }))
    .filter((e): e is Placed => e.box != null);
  if (items.length < 3) return;
  await applyMoves(editor, area, distributeDeltas(items, axis));
  await settle();
}

// A node opts out of collapse via NodeCard's `collapsible={false}` (NumberInput,
// Gauge, Chart, Slicer, Sparkline, HeatmapCell, AngleDial, DatePicker, …), which
// stamps `.solenoid-node--no-chevron` on its rendered card — no central registry
// exists to check outside the render tree, so read that class directly (the same
// DOM-containment idiom Canvas's context-menu hit-testing uses for node lookup).
function isCollapsible(el: HTMLElement): boolean {
  const inner = el.querySelector<HTMLElement>(".solenoid-node")
    ?? (el.classList.contains("solenoid-node") ? el : null);
  return !!inner && !inner.classList.contains("solenoid-node--no-chevron");
}

/** Collapse or expand every selected node that supports it (silently skips
 *  groups/notes/conduits and chevron-less nodes — same DOM check the chevron
 *  itself is gated on). */
export function collapseSelection(collapsed: boolean): void {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;
  for (const id of selectedNodeIds(editor)) {
    const el = area.nodeViews.get(id)?.element;
    if (el && isCollapsible(el)) collapseStore.set(id, collapsed);
  }
}
