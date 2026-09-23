// [[C52]] visibleSelection, [[D63]] lockedGroupIsObstacle

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

export function expandMoveSet(editor: Editor, seedIds: Iterable<string>): Set<string> {
  const clusterOf = new Map<string, string[]>();
  for (const c of standoffClusters()) for (const id of c) clusterOf.set(id, c);
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
  for (const id of selectedNodeIds(editor)) {
    const el = view.nodeElement(id);
    if (el && isCollapsible(el)) collapseStore.set(id, collapsed);
  }
}
