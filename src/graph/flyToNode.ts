import { AreaExtensions } from "rete-area-plugin";
import type { NodeEditor } from "rete";
import { getEditor, getArea } from "./process";
import { groupCollapseStore } from "./groupCollapse";
import { GroupNode } from "./rete-nodes";
import type { Schemes } from "./schemes";

// Pan/zoom the viewport to centre one or more nodes — the "go to this node"
// action shared by the pins HUD, the alerts HUD, the cable inspector, and (for a
// multi-node step) the Presentation node.
//
// A node hidden inside a COLLAPSED group has no visible element, so a raw
// AreaExtensions.zoomAt(area, [node]) targets a stale (~0,0) position and the
// view jumps way off. Resolve the nearest VISIBLE ancestor instead: walk up
// through nested collapsed groups until we hit one that is itself visible (the
// collapsed box you can actually see), and fly there.
function visibleRef(editor: NodeEditor<Schemes>, nodeId: string): Schemes["Node"] | null {
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

  const node = editor.getNode(targetId);
  if (!node) return null;

  // zoomAt's getNodesRect frames `node.width`/`node.height` when they're defined
  // — but a COLLAPSED group still carries its EXPANDED dimensions, so it frames
  // the wrong (large, offset) box and the view lands off the compact card. Pass a
  // SIZELESS ref in that case so zoomAt falls back to the rendered element size
  // (the compact collapsed box) — the same compact-box sizing the minimap's
  // collapsedAwareNodesRect uses. Plain nodes keep the real node (unchanged).
  return node instanceof GroupNode && node.collapsed
    ? ({ id: targetId } as unknown as typeof node)
    : node;
}

export function flyToNode(nodeId: string): void {
  const editor = getEditor();
  const area = getArea();
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
