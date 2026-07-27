import { AreaExtensions } from "rete-area-plugin";
import type { NodeEditor } from "rete";
import { getEditor, getArea } from "./process";
import { getOwningEditor, getOwningArea } from "./activeGraph";
import { groupCollapseStore } from "./groupCollapse";
import { GroupNode } from "./rete-nodes";
import type { Schemes } from "./schemes";

// Pan/zoom the viewport to center one or more nodes — the "go to this node"
// action shared by the pins HUD, the alerts HUD, the cable inspector, and (for a
// multi-node step) the Presentation node.
//
// A node hidden inside a COLLAPSED group has no visible element, so a raw
// AreaExtensions.zoomAt(area, [node]) targets a stale (~0,0) position and the
// view jumps way off. Resolve the nearest VISIBLE ancestor instead: walk up
// through nested collapsed groups until we hit one that is itself visible (the
// collapsed box you can actually see). Shared by flyToNode/flyToNodes (pan/zoom
// target) and flashNode (which DOM element to flash).
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

// zoomAt's getNodesRect frames `node.width`/`node.height` when they're defined —
// but a COLLAPSED group still carries its EXPANDED dimensions, so it frames the
// wrong (large, offset) box and the view lands off the compact card. Pass a
// SIZELESS ref in that case so zoomAt falls back to the rendered element size
// (the compact collapsed box) — the same compact-box sizing the minimap's
// collapsedAwareNodesRect uses. Plain nodes keep the real node (unchanged).
function visibleRef(editor: NodeEditor<Schemes>, nodeId: string): Schemes["Node"] | null {
  const targetId = resolveVisibleTarget(editor, nodeId);
  const node = editor.getNode(targetId);
  if (!node) return null;
  return node instanceof GroupNode && node.collapsed
    ? ({ id: targetId } as unknown as typeof node)
    : node;
}

// Pan/zoom the viewport to center a node — the one "go to this node" action
// shared by the pins HUD, the alerts HUD, and the cable inspector.
export function flyToNode(nodeId: string): void {
  // Owning graph (drill-in aware): a "go to" targeting a node inside an open
  // composite flies the DRILL-IN camera; main ids resolve to main as before.
  const editor = getOwningEditor(nodeId);
  const area = getOwningArea(nodeId);
  if (!editor || !area) return;
  const ref = visibleRef(editor, nodeId);
  if (!ref) return;
  void AreaExtensions.zoomAt(area, [ref]);
}

/**
 * Fly to fit MULTIPLE nodes in one view — the Presentation node's per-step camera
 * (bundle 13 #51): zoomAt already fits a bounding box over every ref it's given,
 * so this is flyToNode's single-target resolution applied per id, then one
 * zoomAt call over the whole resolved set. Unknown/removed ids are skipped
 * (a step surviving a node deletion just frames what's left); an empty result
 * is a no-op (nothing to fly to).
 */
export function flyToNodes(nodeIds: string[]): void {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area || nodeIds.length === 0) return;
  const refs = nodeIds
    .map((id) => visibleRef(editor, id))
    .filter((r): r is Schemes["Node"] => r !== null);
  if (refs.length === 0) return;
  void AreaExtensions.zoomAt(area, refs);
}

const FLASH_CLASS = "solenoid-node-flash";
const FLASH_MS = 1000;
const _flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Toggle a timed CSS flash on a node's rendered element — there is no existing
 *  "jump and flash" gesture anywhere in the codebase (only jump, via flyToNode /
 *  OutlinePanel's focusNode), so this builds the flash half from scratch. Flashes
 *  the nearest VISIBLE ancestor, same resolution as flyToNode, so flashing a node
 *  hidden inside a collapsed group lights up the group box instead of nothing. */
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

/** The full jump-and-flash gesture: pan/zoom to the node, then flash it. */
export function flyToNodeAndFlash(nodeId: string): void {
  flyToNode(nodeId);
  flashNode(nodeId);
}
