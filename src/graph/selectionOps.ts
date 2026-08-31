// Align / distribute / batch collapse over the selection. Uses the process.ts
// singletons rather than Canvas-local refs, so it is callable from anywhere.

import type { View } from "./view";
import { GroupNode } from "./rete-nodes";
import { repositionDockedNodes, unselectAllNodes, selectNode } from "./canvasCommands";
import { getActiveEditor as getEditor, getActiveView as getView } from "./activeGraph";
import { standoffStore, standoffClusters, settleStandoffs } from "./standoffs";
import { collapseStore } from "./collapseStore";
import { scheduleAutosave } from "./persistence";
import { measuredBox, type NodeBox } from "./nodeSize";
import type { Schemes } from "./schemes";
import type { NodeEditor } from "rete";

type Editor = NodeEditor<Schemes>;
type Box = NodeBox;

function selectedNodeIds(editor: Editor): string[] {
  return editor.getNodes()
    .filter((n) => (n as { selected?: boolean }).selected === true)
    .map((n) => n.id);
}

function boxOf(view: View, id: string): Box | null {
  return measuredBox(view, id, getEditor() ?? undefined);
}

// A seed carries its group members and its whole standoff cluster, so moving one end
// of a standoffed pair can't wrench it away from the bar.
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

/** Translates every physical node EXACTLY ONCE: a node carried by two seeds follows the
 *  FIRST only, since deltas come from boxes captured up front and would drift. */
async function applyMoves(editor: Editor, view: View, moves: Move[]): Promise<void> {
  const delta = new Map<string, { dx: number; dy: number }>();
  for (const { seedId, dx, dy } of moves) {
    if (dx === 0 && dy === 0) continue;
    for (const id of expandMoveSet(editor, [seedId])) {
      if (!delta.has(id)) delta.set(id, { dx, dy });
    }
  }
  // Translating a SELECTED node triggers rete's multi-drag group-follow, which compounds
  // across per-node placement and corrupts the result — so drop the selection meanwhile.
  const restore = editor.getNodes()
    .filter((n) => (n as { selected?: boolean }).selected === true)
    .map((n) => n.id);
  if (restore.length > 0) unselectAllNodes();
  try {
    for (const [id, { dx, dy }] of delta) {
      const p = view.position(id);
      if (!p) continue;
      await view.moveNode(id, { x: p.x + dx, y: p.y + dy });
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

// Minimum gap distribute guarantees between adjacent edges. Matches Tidy's ELK node
// spacing (`elk.spacing.nodeNode` ~38) so distribute and auto-arrange feel alike.
export const DISTRIBUTE_GAP = 40;

/** Pure geometry: per-node deltas to space boxes EVENLY (equal edge gaps) along one
 *  axis, guaranteeing no overlap plus at least DISTRIBUTE_GAP between neighbors.
 *  - If the leftmost→rightmost span already fits every box + a DISTRIBUTE_GAP gap,
 *    keep BOTH ends fixed and even out the interior (gap ≥ DISTRIBUTE_GAP).
 *  - Otherwise the boxes are too close/stacked to fit: anchor the leftmost and push
 *    each subsequent box out at exactly DISTRIBUTE_GAP, EXPANDING the run (the
 *    rightmost moves right) so nothing overlaps.
 *  Returns [] for fewer than 3 boxes. Exported for tests. */
export function distributeDeltas(items: Placed[], axis: "h" | "v"): Move[] {
  if (items.length < 3) return [];
  const n = items.length;
  const start = (b: Box) => (axis === "h" ? b.x : b.y);
  const size = (b: Box) => (axis === "h" ? b.w : b.h);
  const sorted = [...items].sort((a, b) => start(a.box) - start(b.box));
  const firstStart = start(sorted[0].box);
  const lastEnd = start(sorted[n - 1].box) + size(sorted[n - 1].box);
  const totalSize = sorted.reduce((s, it) => s + size(it.box), 0);

  const span = lastEnd - firstStart;
  const required = totalSize + DISTRIBUTE_GAP * (n - 1);
  const fits = span >= required;
  // Fit: even gap (≥ DISTRIBUTE_GAP) and the last box lands back on lastEnd, so
  // leave it fixed. Expand: uniform DISTRIBUTE_GAP and the last box must move too.
  const gap = fits ? (span - totalSize) / (n - 1) : DISTRIBUTE_GAP;
  const stop = fits ? n - 1 : n;

  const moves: Move[] = [];
  let cursor = firstStart + size(sorted[0].box) + gap; // leading edge of sorted[1]
  for (let i = 1; i < stop; i++) {
    const { id, box } = sorted[i];
    const d = cursor - start(box);
    moves.push({ seedId: id, dx: axis === "h" ? d : 0, dy: axis === "v" ? d : 0 });
    cursor += size(box) + gap;
  }
  return moves;
}

/** Figma/Illustrator semantics: a manual gesture, deliberately NOT overlap-free —
 *  nodes already sharing the other axis land on top of each other. */
export async function alignSelection(kind: AlignKind): Promise<void> {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return;
  const ids = selectedNodeIds(editor);
  const items = ids.map((id) => ({ id, box: boxOf(view, id) }))
    .filter((e): e is Placed => e.box != null);
  if (items.length < 2) return;
  await applyMoves(editor, view, alignDeltas(items, kind));
  await settle();
}

/** Distributes the GAPS between edges, not the centers: node heights vary so widely
 *  that equal-center spacing overlapped big nodes. Needs at least 3 nodes. */
export async function distributeSelection(axis: "h" | "v"): Promise<void> {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return;
  const ids = selectedNodeIds(editor);
  const items = ids.map((id) => ({ id, box: boxOf(view, id) }))
    .filter((e): e is Placed => e.box != null);
  if (items.length < 3) return;
  await applyMoves(editor, view, distributeDeltas(items, axis));
  await settle();
}

// `collapsible={false}` stamps `.solenoid-node--no-chevron` on the card; no registry
// exists outside the render tree, so the class is the only readable signal.
function isCollapsible(el: HTMLElement): boolean {
  const inner = el.querySelector<HTMLElement>(".solenoid-node")
    ?? (el.classList.contains("solenoid-node") ? el : null);
  return !!inner && !inner.classList.contains("solenoid-node--no-chevron");
}

/** Silently skips groups/notes/conduits and chevron-less nodes. */
export function collapseSelection(collapsed: boolean): void {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return;
  for (const id of selectedNodeIds(editor)) {
    const el = view.nodeElement(id);
    if (el && isCollapsible(el)) collapseStore.set(id, collapsed);
  }
}
