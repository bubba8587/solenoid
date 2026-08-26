import { zoomAt, type ZoomSurface } from "./zoomAt";
import type { NodeEditor } from "rete";
import { getEditor, getArea } from "./process";
import { getOwningEditor, getOwningArea } from "./activeGraph";
import { groupCollapseStore } from "./groupCollapse";
import { GroupNode } from "./rete-nodes";
import type { Schemes } from "./schemes";

// A node hidden inside a COLLAPSED group has no visible element, so zoomAt would
// target a stale (~0,0) position — fly to the nearest VISIBLE ancestor instead.
function resolveVisibleTarget(editor: NodeEditor<Schemes>, nodeId: string): string {
  let targetId = nodeId;
  const seen = new Set<string>();
  while (groupCollapseStore.isNodeHidden(targetId) && !seen.has(targetId)) {
    seen.add(targetId);
    const grp = editor
      .getNodes()
      .find((n) => n instanceof GroupNode && n.members.includes(targetId));
    if (!grp) break;
    targetId = grp.id;
  }
  return targetId;
}

// A collapsed group still carries its EXPANDED width/height, which zoomAt would frame;
// pass a SIZELESS ref so it falls back to the rendered (compact) element size.
function visibleRef(editor: NodeEditor<Schemes>, nodeId: string): Schemes["Node"] | null {
  const targetId = resolveVisibleTarget(editor, nodeId);
  const node = editor.getNode(targetId);
  if (!node) return null;
  return node instanceof GroupNode && node.collapsed
    ? ({ id: targetId } as unknown as typeof node)
    : node;
}

export function flyToNode(nodeId: string): void {
  // Drill-in aware: a node inside an open composite flies the DRILL-IN camera.
  const editor = getOwningEditor(nodeId);
  const area = getOwningArea(nodeId);
  if (!editor || !area) return;
  const ref = visibleRef(editor, nodeId);
  if (!ref) return;
  void zoomAt(area as unknown as ZoomSurface, [ref]);
}

/** Fits a bounding box over every node; unknown/removed ids are skipped and an empty
 *  result is a no-op. */
export function flyToNodes(nodeIds: string[]): void {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area || nodeIds.length === 0) return;
  const refs = nodeIds
    .map((id) => visibleRef(editor, id))
    .filter((r): r is Schemes["Node"] => r !== null);
  if (refs.length === 0) return;
  void zoomAt(area as unknown as ZoomSurface, refs);
}

const FLASH_CLASS = "solenoid-node-flash";
const FLASH_MS = 1000;
const _flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Flashes the nearest VISIBLE ancestor, so a node inside a collapsed group lights up
 *  the group box rather than nothing. */
export function flashNode(nodeId: string): void {
  const editor = getOwningEditor(nodeId); // drill-in aware, like flyToNode
  const area = getOwningArea(nodeId);
  if (!editor || !area) return;
  const targetId = resolveVisibleTarget(editor, nodeId);
  const el = area.nodeViews.get(targetId)?.element;
  if (!el) return;

  el.classList.remove(FLASH_CLASS);
  void el.offsetWidth; // restart the CSS animation if re-triggered mid-flash
  el.classList.add(FLASH_CLASS);

  const prev = _flashTimers.get(targetId);
  if (prev) clearTimeout(prev);
  _flashTimers.set(targetId, setTimeout(() => {
    el.classList.remove(FLASH_CLASS);
    _flashTimers.delete(targetId);
  }, FLASH_MS));
}

export function flyToNodeAndFlash(nodeId: string): void {
  flyToNode(nodeId);
  flashNode(nodeId);
}
