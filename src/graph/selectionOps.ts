// Multi-node operations over the current selection: align, distribute, batch
// collapse/expand (scope-features #57(b)). Explicitly does NOT do paste-anywhere
// or wrap-in-subgraph — both are a different gesture (bundle 09 owns the latter).
//
// Reads the selection the same way nudgeSelection (Canvas.tsx) and
// createGroupFromSelection (groupLogic.ts) do: editor.getNodes().filter(n =>
// n.selected). Uses the process.ts singletons (getEditor/getArea) rather than
// Canvas-local refs so this is callable from anywhere (the command palette).

import { GroupNode } from "./rete-nodes";
import { getEditor, getArea, repositionDockedNodes } from "./process";
import { standoffStore, standoffClusters, settleStandoffs } from "./standoffs";
import { collapseStore } from "./collapseStore";
import { scheduleAutosave } from "./persistence";
import type { Schemes, AreaExtra } from "./schemes";
import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";

type Editor = NodeEditor<Schemes>;
type Area = AreaPlugin<Schemes, AreaExtra>;
type Box = { x: number; y: number; w: number; h: number };

function selectedNodeIds(editor: Editor): string[] {
  return editor.getNodes()
    .filter((n) => (n as { selected?: boolean }).selected === true)
    .map((n) => n.id);
}

function boxOf(area: Area, id: string): Box | null {
  const v = area.nodeViews.get(id);
  if (!v) return null;
  return { x: v.position.x, y: v.position.y, w: v.element.offsetWidth, h: v.element.offsetHeight };
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

async function moveBy(editor: Editor, area: Area, seedId: string, dx: number, dy: number): Promise<void> {
  if (dx === 0 && dy === 0) return;
  for (const id of expandMoveSet(editor, [seedId])) {
    const v = area.nodeViews.get(id);
    if (!v) continue;
    await area.translate(id, { x: v.position.x + dx, y: v.position.y + dy });
    repositionDockedNodes(id);
  }
}

async function settle(): Promise<void> {
  if (!standoffStore.isEmpty()) settleStandoffs();
  scheduleAutosave();
}

export type AlignKind = "left" | "right" | "top" | "bottom" | "center-h" | "center-v";

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
    .filter((e): e is { id: string; box: Box } => e.box != null);
  if (items.length < 2) return;

  const xMin = Math.min(...items.map((e) => e.box.x));
  const xMax = Math.max(...items.map((e) => e.box.x + e.box.w));
  const yMin = Math.min(...items.map((e) => e.box.y));
  const yMax = Math.max(...items.map((e) => e.box.y + e.box.h));

  for (const { id, box } of items) {
    let nx = box.x, ny = box.y;
    switch (kind) {
      case "left": nx = xMin; break;
      case "right": nx = xMax - box.w; break;
      case "center-h": nx = (xMin + xMax) / 2 - box.w / 2; break;
      case "top": ny = yMin; break;
      case "bottom": ny = yMax - box.h; break;
      case "center-v": ny = (yMin + yMax) / 2 - box.h / 2; break;
    }
    await moveBy(editor, area, id, nx - box.x, ny - box.y);
  }
  await settle();
}

/** Evenly space the selected nodes' centers along one axis, keeping the two
 *  extreme (first/last, by center) nodes fixed — the standard "distribute"
 *  definition. Needs at least 3 to do anything (2 nodes have nothing between
 *  them to redistribute). */
export async function distributeSelection(axis: "h" | "v"): Promise<void> {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;
  const ids = selectedNodeIds(editor);
  const items = ids.map((id) => ({ id, box: boxOf(area, id) }))
    .filter((e): e is { id: string; box: Box } => e.box != null);
  if (items.length < 3) return;

  const centerOf = (b: Box) => (axis === "h" ? b.x + b.w / 2 : b.y + b.h / 2);
  items.sort((a, b) => centerOf(a.box) - centerOf(b.box));
  const first = centerOf(items[0].box);
  const last = centerOf(items[items.length - 1].box);
  const step = (last - first) / (items.length - 1);

  for (let i = 1; i < items.length - 1; i++) {
    const { id, box } = items[i];
    const delta = first + step * i - centerOf(box);
    await moveBy(editor, area, id, axis === "h" ? delta : 0, axis === "v" ? delta : 0);
  }
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
