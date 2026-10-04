// [[C52]] visibleSelection, [[C112]] noOverlapsEver, [[C89]] standoffsSolveLast

import type { View } from "./view";
import { GroupNode, ConduitNode } from "./rete-nodes";
import { bumpStackOrder } from "./graphSignals";
import { repositionDockedNodes, unselectAllNodes, selectNode } from "./canvasCommands";
import { getActiveEditor as getEditor, getActiveView as getView, getOwningView } from "./activeGraph";
import { standoffStore, standoffClusters, settleStandoffs, liveStandoffs } from "./standoffs";
import { groupCollapseStore } from "./groupCollapse";
import { collapseStore } from "./collapseStore";
import { scheduleAutosave } from "./persistence";
import { notifyGraphChanged } from "./process";
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

export function expandMoveSet(
  editor: Editor,
  seedIds: Iterable<string>,
  isHidden: (id: string) => boolean = groupCollapseStore.isNodeHidden,
): Set<string> {
  const clusterOf = new Map<string, string[]>();
  for (const c of standoffClusters(liveStandoffs(isHidden))) for (const id of c) clusterOf.set(id, c);
  const toMove = new Set<string>();
  const queue: string[] = [];
  const locked = (id: string) => { const n = editor.getNode(id); return n instanceof GroupNode && n.lockedPosition; };
  const enqueue = (id: string) => { if (!toMove.has(id) && !locked(id)) { toMove.add(id); queue.push(id); } };
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

async function applyMoves(editor: Editor, view: View, moves: Move[]): Promise<void> {
  const delta = new Map<string, { dx: number; dy: number }>();
  for (const { seedId, dx, dy } of moves) {
    if (dx === 0 && dy === 0) continue;
    for (const id of expandMoveSet(editor, [seedId])) {
      if (!delta.has(id)) delta.set(id, { dx, dy });
    }
  }
  // Drop the selection meanwhile: translating a selected node triggers the group-follow, which compounds per placement.
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

export const DISTRIBUTE_GAP = 40;

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
  const gap = fits ? (span - totalSize) / (n - 1) : DISTRIBUTE_GAP;
  const stop = fits ? n - 1 : n;

  const moves: Move[] = [];
  let cursor = firstStart + size(sorted[0].box) + gap;
  for (let i = 1; i < stop; i++) {
    const { id, box } = sorted[i];
    const d = cursor - start(box);
    moves.push({ seedId: id, dx: axis === "h" ? d : 0, dy: axis === "v" ? d : 0 });
    cursor += size(box) + gap;
  }
  return moves;
}

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

// `collapsible={false}` stamps `.solenoid-node--no-chevron`, the only signal readable outside the render tree.
function isCollapsible(el: HTMLElement): boolean {
  const inner = el.querySelector<HTMLElement>(".solenoid-node")
    ?? (el.classList.contains("solenoid-node") ? el : null);
  return !!inner && !inner.classList.contains("solenoid-node--no-chevron");
}

export function collapseSelection(collapsed: boolean): void {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return;
  let changed = false;
  for (const id of selectedNodeIds(editor)) {
    const el = view.nodeElement(id);
    if (el && isCollapsible(el) && collapseStore.get(id) !== collapsed) {
      collapseStore.set(id, collapsed);
      changed = true;
    }
  }
  if (changed) notifyGraphChanged();
}

/** A card's chevron: flips the collapse, re-renders the card, and saves and records the change. */
export function toggleNodeCollapsed(nodeId: string): void {
  collapseStore.toggle(nodeId);
  void getOwningView(nodeId)?.rerenderNode(nodeId);
  notifyGraphChanged();
}

export type StackMove = "front" | "forward" | "backward" | "back";

/** The bottom-to-top order after `move`: front and back take the selection past everything; forward and backward
 *  step each selected id past the nearest unselected one it `overlaps`, and leave it where it is when none does. */
export function restackOrder(
  order: readonly string[], selected: ReadonlySet<string>, move: StackMove, overlaps: (a: string, b: string) => boolean,
): string[] {
  const out = [...order];
  if (move === "front") return [...out.filter((id) => !selected.has(id)), ...out.filter((id) => selected.has(id))];
  if (move === "back") return [...out.filter((id) => selected.has(id)), ...out.filter((id) => !selected.has(id))];
  if (move === "forward") {
    for (let i = out.length - 1; i >= 0; i--) {
      const id = out[i];
      if (!selected.has(id)) continue;
      const j = out.findIndex((o, k) => k > i && !selected.has(o) && overlaps(id, o));
      if (j < 0) continue;
      out.splice(i, 1);
      out.splice(j, 0, id);
    }
    return out;
  }
  for (let i = 0; i < out.length; i++) {
    const id = out[i];
    if (!selected.has(id)) continue;
    let j = -1;
    for (let k = i - 1; k >= 0; k--) if (!selected.has(out[k]) && overlaps(id, out[k])) { j = k; break; }
    if (j < 0) continue;
    out.splice(i, 1);
    out.splice(j, 0, id);
  }
  return out;
}

/** Rewrites the editor's node order, which is the stacking order: RF draws cards in it and the save keeps it.
 *  rete has no reorder call and `getNodes()` returns a copy, so this writes its `nodes` array in place. */
export function reorderEditorNodes(editor: Editor, order: readonly string[]): void {
  const nodes = (editor as unknown as { nodes: Schemes["Node"][] }).nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (order.length !== nodes.length || order.some((id) => !byId.has(id))) return;
  nodes.splice(0, nodes.length, ...order.map((id) => byId.get(id)!));
}

// Groups, Conduits and cards stack in separate bands (flowModel.nodeZIndex), so only a card of the same kind is in the way.
const stackBand = (n: Schemes["Node"] | undefined) => (n instanceof GroupNode ? 2 : n instanceof ConduitNode ? 1 : 0);

/** Moves the selected cards (or `ids`) to the front, one step forward, one step back, or to the back. */
export function stackSelection(move: StackMove, ids?: readonly string[]): void {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return;
  const selected = new Set(ids ?? selectedNodeIds(editor));
  if (!selected.size) return;
  const order = editor.getNodes().map((n) => n.id);
  const boxes = new Map<string, Box | null>();
  const box = (id: string) => {
    if (!boxes.has(id)) boxes.set(id, boxOf(view, id));
    return boxes.get(id)!;
  };
  const overlaps = (a: string, b: string) => {
    if (stackBand(editor.getNode(a)) !== stackBand(editor.getNode(b))) return false;
    const p = box(a), q = box(b);
    return !!p && !!q && p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  };
  const next = restackOrder(order, selected, move, overlaps);
  if (next.every((id, i) => id === order[i])) return;
  reorderEditorNodes(editor, next);
  bumpStackOrder();
  notifyGraphChanged();
}
