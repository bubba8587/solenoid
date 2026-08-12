// The ONE size read for layout math — never read offsetWidth directly, or a
// zero-size unpainted node collapses the bounding box.

import { collapseStore } from "./collapseStore";
import type { Schemes, AreaExtra } from "./schemes";
import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";

type Editor = NodeEditor<Schemes>;
type Area = AreaPlugin<Schemes, AreaExtra>;

export type NodeBox = { x: number; y: number; w: number; h: number };

// For a node that has never painted and never been measured; single fallback so
// every feature agrees.
export const FALLBACK_NODE_W = 180;
export const FALLBACK_NODE_H = 100;
// Only for an unpainted COLLAPSED node, whose stored height is the taller expanded one.
export const COLLAPSED_NODE_H = 52;

/** Guaranteed non-zero size; null only when the node has no area view. Tiers: live
 *  rendered size → the ResizeObserver's stored size → a default, with the fallback
 *  tiers COLLAPSE-AWARE. `editor` supplies the stored-size tier — pass it when known. */
export function measuredBox(area: Area, id: string, editor?: Editor): NodeBox | null {
  const v = area.nodeViews.get(id);
  if (!v) return null;
  const liveW = v.element?.offsetWidth || 0;
  const liveH = v.element?.offsetHeight || 0;
  // Once painted the live DOM is the truth and already includes the collapse state.
  if (liveW > 0 && liveH > 0) return { x: v.position.x, y: v.position.y, w: liveW, h: liveH };

  const node = editor?.getNode(id) as { width?: number; height?: number } | undefined;
  const w = liveW || node?.width || FALLBACK_NODE_W;
  const h = collapseStore.get(id)
    ? COLLAPSED_NODE_H
    : (liveH || node?.height || FALLBACK_NODE_H);
  return { x: v.position.x, y: v.position.y, w, h };
}
