import { AreaExtensions } from "rete-area-plugin";
import { getEditor, getArea } from "./process";
import { groupCollapseStore } from "./groupCollapse";
import { GroupNode } from "./rete-nodes";

// Pan/zoom the viewport to centre a node — the one "go to this node" action
// shared by the pins HUD, the alerts HUD, and the cable inspector.
//
// A node hidden inside a COLLAPSED group has no visible element, so a raw
// AreaExtensions.zoomAt(area, [node]) targets a stale (~0,0) position and the
// view jumps way off. Resolve the nearest VISIBLE ancestor instead: walk up
// through nested collapsed groups until we hit one that is itself visible (the
// collapsed box you can actually see), and fly there.
export function flyToNode(nodeId: string): void {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;

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
  if (!node) return;

  // zoomAt's getNodesRect frames `node.width`/`node.height` when they're defined
  // — but a COLLAPSED group still carries its EXPANDED dimensions, so it frames
  // the wrong (large, offset) box and the view lands off the compact card. Pass a
  // SIZELESS ref in that case so zoomAt falls back to the rendered element size
  // (the compact collapsed box) — the same compact-box sizing the minimap's
  // collapsedAwareNodesRect uses. Plain nodes keep the real node (unchanged).
  const ref =
    node instanceof GroupNode && node.collapsed
      ? ({ id: targetId } as unknown as typeof node)
      : node;
  void AreaExtensions.zoomAt(area, [ref]);
}
